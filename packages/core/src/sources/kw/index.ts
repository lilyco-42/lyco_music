/**
 * 酷我（kw）音源。
 *
 * 移植自 lx-music 上游 musicSdk/kw，但**取流部分重写了**：
 * 上游 api-temp.js 指向 http://tm.tempmusics.tk/url/kw/...，该域名已 DNS 失效，
 * 桌面端 api-source.js 里内置 getMusicUrl 也早已被注释掉 —— 也就是说上游
 * 本身已经不能播酷我了。这里改用酷我自家仍在服务的公开端点：
 *
 *   搜索  http://search.kuwo.cn/r.s?...
 *   取流  http://antiserver.kuwo.cn/anti.s?type=convert_url3&rid=MUSIC_<id>&format=mp3|aac&response=url
 *   歌词  http://m.kuwo.cn/newh5/singles/songinfoandlrc?musicId=<id>
 *   封面  http://artistpicserver.kuwo.cn/pic.web?...&rid=<id>
 *
 * 全部为实测可用（mp3/aac 返回的地址能真的下载到 MPEG/ID3 字节）。
 */
import type { MusicSource, MusicItem, LyricInfo, PicInfo, MusicUrlInfo, Quality, SearchResult } from '../../types'
import { registerSource, setSupportQuality } from '../registry'
import { getPlatform } from '../../registry'
import { formatSinger, formatPlayTime } from './util'

const SEARCH_URL = 'http://search.kuwo.cn/r.s'
const URL_API = 'http://antiserver.kuwo.cn/anti.s'
const LYRIC_API = 'http://m.kuwo.cn/newh5/singles/songinfoandlrc'
const PIC_API = 'http://artistpicserver.kuwo.cn/pic.web'

/** 酷我搜索固定参数（取自上游，去掉会被判定为非法请求） */
const SEARCH_PARAMS = {
  client: 'kt',
  uid: '794762570',
  ver: 'kwplayer_ar_9.2.2.1',
  vipver: '1',
  show_copyright_off: '1',
  newver: '1',
  ft: 'music',
  cluster: '0',
  strategy: '2012',
  encoding: 'utf8',
  rformat: 'json',
  vermerge: '1',
  mobi: '1',
  issubtitle: '1',
} as const

/** N_MINFO 里每一段形如 level:ff,bitrate:2000,format:flac,size:26.3Mb */
const MINFO_RE = /level:(\w+),bitrate:(\d+),format:(\w+),size:([\w.]+)/

/**
 * 音质映射：N_MINFO 里 bitrate 是 kbps。
 *
 * 上游只认 4000/2000/320/128 四个魔数，但实测真实返回里 320 与 128 之外的
 * 档位（ogg/aac/flac）也会出现，所以这里按 bitrate 区间判断，兼容性更好。
 */
function mapQuality(bitrate: number, format: string): Quality | null {
  if (format === 'flac' || format === 'mflac') {
    return bitrate >= 2000 ? 'flac24bit' : 'flac'
  }
  if (bitrate >= 320) return '320k'
  if (bitrate >= 128) return '128k'
  return null
}

/** 解析 N_MINFO / MINFO，得出该曲目可用的音质表 */
function parseQualitys(raw: string | undefined): Partial<Record<Quality, unknown>> {
  const out: Partial<Record<Quality, unknown>> = {}
  if (!raw) return out
  for (const part of raw.split(';')) {
    const m = part.match(MINFO_RE)
    if (!m) continue
    const bitrate = Number(m[2])
    const format = m[3] ?? ''
    const q = mapQuality(bitrate, format)
    // 同一档位出现多次时保留先出现的（上游 types.reverse() 后取第一个，效果相同）
    if (q && !out[q]) out[q] = { size: String(m[4]).toUpperCase() }
  }
  return out
}

/** 搜索结果一条 -> MusicItem */
export function handleKwSearchItem(raw: unknown): MusicItem | null {
  const info = raw as Record<string, unknown>
  if (!info) return null
  const rid = String(info.MUSICRID ?? '')
  const songmid = rid.replace('MUSIC_', '')
  if (!songmid) return null

  const qualitys = parseQualitys(
    typeof info.N_MINFO === 'string' ? info.N_MINFO : typeof info.MINFO === 'string' ? info.MINFO : undefined,
  )
  const interval = parseInt(String(info.DURATION ?? ''), 10)

  return {
    id: songmid,
    name: String(info.SONGNAME ?? ''),
    singer: formatSinger(String(info.ARTIST ?? '')),
    albumName: String(info.ALBUM ?? ''),
    albumId: String(info.ALBUMID ?? ''),
    source: 'kw',
    songmid,
    interval: Number.isNaN(interval) ? '00:00' : formatPlayTime(interval),
    qualitys,
  }
}

/**
 * antiserver 的「占位陷阱」。
 *
 * 实测（本地与服务器两处都复现）：convert_url3 对**不存在或没版权的 rid**
 * 并不返回错误，而是回同一个固定的 mp3 地址 —— rid 80403 / 6468891 / 98804 /
 * 228908 拿到的都是 .../nf/resource/n1/69/32/588957081.mp3。
 * 它确实是真音频（audio/mpeg、206 可 Range），所以「能播」但**放的是别的歌**。
 *
 * 这比报错更糟：用户点了 A 歌，听到 B 歌。所以必须识别出来。
 * 判断依据是那个固定文件名 —— 它是服务端写死的兜底资源，不是任何真实歌曲。
 */
const PLACEHOLDER_MARKERS = ['588957081']

function isPlaceholderUrl(url: string): boolean {
  return PLACEHOLDER_MARKERS.some(m => url.includes(m))
}

/**
 * 取流。
 *
 * flac 实测 code=-1（无权限），所以无损档位直接降级到 mp3 请求。
 * 拿到占位地址时抛错而不是返回 —— 上层会去试别的音源，用户最终听到的是对的歌。
 */
async function getMusicUrl(songInfo: MusicItem, quality: Quality): Promise<MusicUrlInfo> {
  const { http } = getPlatform()
  const format = quality === 'flac' || quality === 'flac24bit' ? 'mp3' : quality === '128k' ? 'aac' : 'mp3'
  const url = `${URL_API}?type=convert_url3&rid=MUSIC_${songInfo.songmid}&format=${format}&response=url`
  const res = await http.request({ url, method: 'GET' })
  if (res.statusCode !== 200) throw new Error(`[lxmn/kw] HTTP ${res.statusCode}`)

  const parsed = JSON.parse(res.body) as { code?: number; url?: string; msg?: string }
  if (!parsed.url) {
    throw new Error(`[lxmn/kw] 该歌曲暂无可播放地址（${parsed.msg || '版权受限或已下架'}）`)
  }
  if (isPlaceholderUrl(parsed.url)) {
    throw new Error('[lxmn/kw] 该歌曲暂无可播放地址（服务端仅返回占位音频）')
  }
  // 服务端给的地址带时效签名；实际拿到的格式以请求的为准
  return { url: parsed.url, quality, type: format }
}

async function getLyric(songInfo: MusicItem): Promise<LyricInfo> {
  const { http } = getPlatform()
  const res = await http.request({ url: `${LYRIC_API}?musicId=${songInfo.songmid}`, method: 'GET' })
  if (res.statusCode !== 200) throw new Error(`[lxmn/kw] lyric HTTP ${res.statusCode}`)

  const parsed = JSON.parse(res.body) as {
    data?: { lrclist?: Array<{ lineLyric?: string; time?: string }> }
  }
  const list = parsed.data?.lrclist
  if (!list?.length) throw new Error('[lxmn/kw] 该歌曲暂无歌词')

  // 上游 sortLrcArr 把同一时间点的重复行挪到上一行；这里保持简单：原样按时间输出
  const lines = list.map(l => {
    const t = Number(l.time ?? 0)
    const m = Math.floor(t / 60)
    const s = (t % 60).toFixed(2).padStart(5, '0')
    return `[${String(m).padStart(2, '0')}:${s}]${l.lineLyric ?? ''}`
  })
  return { lyric: lines.join('\n') }
}

async function getPic(songInfo: MusicItem): Promise<PicInfo> {
  const { http } = getPlatform()
  const url = `${PIC_API}?corp=kuwo&type=rid_pic&pictype=500&size=500&rid=${songInfo.songmid}`
  const res = await http.request({ url, method: 'GET' })
  // 这个端点直接返回图片地址纯文本，不是 JSON
  const body = res.body.trim()
  return { url: /^https?:\/\//.test(body) ? body : '' }
}

export const kwSource: MusicSource = {
  id: 'kw',
  name: '酷我音乐',
  getMusicUrl,
  getLyric,
  getPic,

  async musicSearch(keyword: string, page: number, limit: number): Promise<SearchResult> {
    const { http } = getPlatform()
    const query = new URLSearchParams({
      ...SEARCH_PARAMS,
      all: keyword,
      pn: String(page - 1),
      rn: String(limit),
    })
    const res = await http.request({ url: `${SEARCH_URL}?${query.toString()}`, method: 'GET' })
    if (res.statusCode !== 200) throw new Error(`[lxmn/kw] search HTTP ${res.statusCode}`)

    const parsed = JSON.parse(res.body) as {
      TOTAL?: string
      abslist?: unknown[]
    }
    const list: MusicItem[] = []
    for (const raw of parsed.abslist ?? []) {
      const item = handleKwSearchItem(raw)
      if (item) list.push(item)
    }
    const total = parseInt(parsed.TOTAL ?? '0', 10) || list.length
    return {
      list,
      total,
      limit,
      page,
      source: 'kw',
      allPage: limit > 0 ? Math.ceil(total / limit) : 1,
    }
  },
}

export function installKwSource(): void {
  registerSource('kw', kwSource)
  setSupportQuality('kw', ['flac24bit', 'flac', '320k', '128k'])
}

export { SEARCH_URL as KW_SEARCH_URL, URL_API as KW_URL_API, parseQualitys }