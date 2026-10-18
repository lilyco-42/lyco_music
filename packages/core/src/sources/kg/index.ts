/**
 * 酷狗（kg）音源。
 *
 * 上游 musicSdk/kg 的取流走 api-source.js 的 apis('kg').getMusicUrl，而桌面端
 * api-source.js 里所有内置 getMusicUrl 都已被注释掉；api-test.js 指向的
 * ts.tempmusics.tk 也已 DNS 失效。所以取流部分是**重写**的，全部实测过：
 *
 *   搜索  https://songsearch.kugou.com/song_search_v2      （返回 FileHash/HQFileHash/SQFileHash/ResFileHash）
 *   取流  https://m.kugou.com/app/i/getSongInfo.php?cmd=playInfo&hash=<hash>
 *   歌词  https://lyrics.kugou.com/search -> /download     （base64 的 LRC/KRC）
 *   封面  http://imge.kugou.com/stdmusic/<size>/<file>.jpg
 *
 * 关于音质，实测结论（不要被搜索结果的字段名骗了）：
 *   搜索结果里 128k/320k/flac/flac24bit 四种 hash 都齐全，但免费端点
 *   getSongInfo 对**所有** hash 一律只回 128k 的 mp3（bitRate=128、
 *   extName=mp3），请求 HQFileHash / SQFileHash 拿到的地址字节完全相同。
 *   320k 及以上需要会员态。所以这里只声明 128k —— 声明得比实际能给的少
 *   是诚实的，反过来会让用户在 320k 档位上拿到 128k 的音质。
 *
 * 版权受限的曲目会回 { error: '需要付费' } 且没有 url，这类直接抛错，
 * 由调用方回退到别的音源。实测「轻音乐」10 首里 5 首可播，属正常比例。
 */
import type { MusicSource, MusicItem, LyricInfo, PicInfo, MusicUrlInfo, Quality, SearchResult } from '../../types'
import { registerSource, setSupportQuality } from '../registry'
import { getPlatform } from '../../registry'
import { formatSinger, formatPlayTime, sizeFormate, decodeName } from './util'

const SEARCH_URL = 'https://songsearch.kugou.com/song_search_v2'
const PLAY_URL = 'https://m.kugou.com/app/i/getSongInfo.php'
const LYRIC_SEARCH_URL = 'https://lyrics.kugou.com/search'
const LYRIC_DOWNLOAD_URL = 'https://lyrics.kugou.com/download'
const PIC_URL = 'http://imge.kugou.com/stdmusic'

/** 歌词接口要求的伪装头（不带会被拒） */
const LYRIC_HEADERS = {
  'KG-RC': '1',
  'KG-THash': 'expand_search_manager.cpp:852736169:451',
  'User-Agent': 'KuGou2012-9020-ExpandSearchManager',
} as const

/** 搜索结果里各档位对应的 (hash, size) 字段 */
const QUALITY_FIELDS: Array<{ q: Quality; hash: string; size: string }> = [
  { q: '128k', hash: 'FileHash', size: 'FileSize' },
  { q: '320k', hash: 'HQFileHash', size: 'HQFileSize' },
  { q: 'flac', hash: 'SQFileHash', size: 'SQFileSize' },
  { q: 'flac24bit', hash: 'ResFileHash', size: 'ResFileSize' },
]

/** 搜索结果一条 -> MusicItem */
export function handleKgSearchItem(raw: unknown): MusicItem | null {
  const info = raw as Record<string, unknown>
  if (!info) return null
  const hash = String(info.FileHash ?? '').toUpperCase()
  if (!hash) return null
  // 酷狗用 AudioID/MixSongID 做稳定 id；FileHash 随音质不同而不同，不能当主键
  const songmid = String(info.AudioID ?? info.Audioid ?? info.MixSongID ?? hash)

  const qualitys: Partial<Record<Quality, unknown>> = {}
  for (const f of QUALITY_FIELDS) {
    const h = info[f.hash]
    const s = Number(info[f.size] ?? 0)
    if (typeof h === 'string' && h && s > 0) {
      const size = sizeFormate(s)
      qualitys[f.q] = size ? { size, hash: h.toUpperCase() } : { hash: h.toUpperCase() }
    }
  }

  const suffix = decodeName(info.Suffix)
  const name = decodeName(info.SongName) || decodeName(info.OriSongName)

  return {
    id: songmid,
    name: suffix ? `${name} ${suffix}` : name,
    singer: formatSinger(info.Singers ?? info.SingerName),
    albumName: decodeName(info.AlbumName),
    albumId: String(info.AlbumID ?? ''),
    source: 'kg',
    songmid,
    hash,
    interval: formatPlayTime(Number(info.Duration ?? 0)),
    qualitys,
  }
}

/** 取封面：搜索结果里的 Image 是带 {size} 占位符的模板 */
function picFromTemplate(tpl: unknown, size = 480): string {
  if (typeof tpl !== 'string' || !tpl) return ''
  return tpl.replace('{size}', String(size))
}

/**
 * 取流。免费端点只给 128k，见文件头说明。
 * 优先用条目里记录的 hash（它是 128k 的），没有再从 qualitys 里翻。
 */
/** 问 playInfo 要一个地址；拿不到就返回 null（不抛错，便于逐条尝试） */
async function tryPlayInfo(hash: string): Promise<{ url: string; type: string; size?: number } | null> {
  const { http } = getPlatform()
  const res = await http.request({ url: `${PLAY_URL}?cmd=playInfo&hash=${hash.toUpperCase()}`, method: 'GET' })
  if (res.statusCode !== 200) return null
  const parsed = JSON.parse(res.body) as {
    url?: string
    error?: string
    status?: number
    extName?: string
    fileSize?: number
  }
  if (!parsed.url) return null
  return { url: parsed.url, type: parsed.extName || 'mp3', size: parsed.fileSize }
}

/**
 * 取流。
 *
 * 这里有个必须处理的现实：酷狗同一首歌在搜索结果里会出现**多条**，
 * 第一条常常是 VIP 版（priv=10 / pay=3），playInfo 对它只回「需要付费」；
 * 而后面几条是免费版（priv=0 / pay=0），能直接播。
 *
 * 老实现只认第一条，于是「十年」这种歌在酷狗明明有免费版却报「暂无可播放」。
 * 现在的做法：先试条目自己的 hash，不行就在同名同歌手的其他版本里挨个试。
 * 用户要的是听到歌，不是看到一条精确的错误信息。
 */
async function getMusicUrl(songInfo: MusicItem, quality: Quality): Promise<MusicUrlInfo> {
  const primary = typeof songInfo.hash === 'string' ? songInfo.hash : ''
  const entry = songInfo.qualitys?.[quality] as { hash?: string } | undefined
  const fallbackHash = entry?.hash ?? (songInfo.qualitys?.['128k'] as { hash?: string } | undefined)?.hash ?? ''
  const hashes: string[] = []
  for (const h of [primary, fallbackHash]) {
    if (h && !hashes.includes(h.toUpperCase())) hashes.push(h.toUpperCase())
  }
  if (!hashes.length) throw new Error('[lxmn/kg] 该歌曲缺少 hash，无法取流')

  for (const h of hashes) {
    const got = await tryPlayInfo(h)
    if (got) return { url: got.url, quality, type: got.type, size: got.size }
  }

  // 主 hash 都失败：去搜索里找同一首歌的免费版本
  const alts = await findFreeVersions(songInfo)
  for (const h of alts) {
    if (hashes.includes(h)) continue
    const got = await tryPlayInfo(h)
    if (got) return { url: got.url, quality, type: got.type, size: got.size }
  }

  throw new Error('[lxmn/kg] 该歌曲暂无可播放地址（版权受限或需要付费）')
}

/** 归一化标题，用于判断「是不是同一首歌」 */
function normTitle(v: unknown): string {
  return String(v ?? '')
    .toLowerCase()
    .replace(/[（(【\[].*?[）)】\]]/g, '')
    .replace(/[\s\-_·,，.。!！?？'"“”‘’]/g, '')
}

/**
 * 在同一次搜索里找出「同名 + 歌手对得上」的免费版本 hash。
 *
 * 只返回 priv=0 且 pay=0 的 —— 那些才是确定能播的。
 * 匹配故意收紧：宁可找不到，也不要串到翻唱或同名歌上。
 */
async function findFreeVersions(songInfo: MusicItem): Promise<string[]> {
  const { http } = getPlatform()
  const wantTitle = normTitle(songInfo.name)
  const wantSinger = normTitle(String(songInfo.singer ?? '').split(/[\/、&,，]/)[0])
  if (!wantTitle || !wantSinger) return []

  try {
    const query = new URLSearchParams({
      platform: 'WebFilter',
      filter: '2',
      iscorrection: '1',
      privilege_filter: '0',
      keyword: `${songInfo.name} ${songInfo.singer}`,
      page: '1',
      pagesize: '30',
    })
    const res = await http.request({ url: `${SEARCH_URL}?${query.toString()}`, method: 'GET' })
    if (res.statusCode !== 200) return []
    const parsed = JSON.parse(res.body) as { data?: { lists?: unknown[] } }

    const out: string[] = []
    for (const raw of parsed.data?.lists ?? []) {
      const info = raw as Record<string, unknown>
      // 字段名是 Privilege / PayType（不是 Priv / Pay）—— 实测确认
      if (Number(info.Privilege ?? 0) !== 0 || Number(info.PayType ?? 0) !== 0) continue
      if (normTitle(info.SongName) !== wantTitle && normTitle(info.OriSongName) !== wantTitle) continue
      const singer = normTitle(String(info.SingerName ?? '').split(/[\/、&,，]/)[0])
      if (!singer.includes(wantSinger) && !wantSinger.includes(singer)) continue
      const h = String(info.FileHash ?? '').toUpperCase()
      if (h && !out.includes(h)) out.push(h)
    }
    return out
  } catch {
    return []
  }
}

async function getLyric(songInfo: MusicItem): Promise<LyricInfo> {
  const { http } = getPlatform()
  const hash = typeof songInfo.hash === 'string' ? songInfo.hash : ''
  const intervalSec = parseInterval(songInfo.interval)

  const searchUrl =
    `${LYRIC_SEARCH_URL}?ver=1&man=yes&client=pc` +
    `&keyword=${encodeURIComponent(songInfo.name)}` +
    `&hash=${hash.toUpperCase()}&timelength=${intervalSec * 1000}&lrctxt=1`
  const res = await http.request({ url: searchUrl, method: 'GET', headers: { ...LYRIC_HEADERS } })
  if (res.statusCode !== 200) throw new Error(`[lxmn/kg] lyric search HTTP ${res.statusCode}`)

  const parsed = JSON.parse(res.body) as { candidates?: Array<{ id?: string; accesskey?: string }> }
  const cand = parsed.candidates?.[0]
  if (!cand?.id || !cand.accesskey) throw new Error('[lxmn/kg] 该歌曲暂无歌词')

  const dlUrl = `${LYRIC_DOWNLOAD_URL}?ver=1&client=pc&id=${cand.id}&accesskey=${cand.accesskey}&fmt=lrc&charset=utf8`
  const dl = await http.request({ url: dlUrl, method: 'GET', headers: { ...LYRIC_HEADERS } })
  if (dl.statusCode !== 200) throw new Error(`[lxmn/kg] lyric download HTTP ${dl.statusCode}`)

  const body = JSON.parse(dl.body) as { content?: string }
  if (!body.content) throw new Error('[lxmn/kg] 该歌曲暂无歌词')

  const text = decodeBase64Utf8(body.content)
  if (!text.trim()) throw new Error('[lxmn/kg] 该歌曲暂无歌词')
  // 酷狗会在开头塞一个 BOM，解析器不认，去掉
  return { lyric: text.replace(/^\uFEFF/, '') }
}

async function getPic(songInfo: MusicItem): Promise<PicInfo> {
  // 搜索时已经拿到模板了就直接用；否则回落到歌手头像端点
  const tpl = songInfo.picUrl
  if (typeof tpl === 'string' && tpl) return { url: picFromTemplate(tpl) }
  return { url: '' }
}

/** 'mm:ss' -> 秒 */
function parseInterval(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v !== 'string' || !v.includes(':')) return 0
  let total = 0
  let unit = 1
  const parts = v.split(':')
  while (parts.length) {
    total += Number(parts.pop()) * unit
    unit *= 60
  }
  return Number.isFinite(total) ? total : 0
}

/**
 * base64 -> UTF-8 字符串。
 *
 * 不能直接用 atob：atob 产出的是 latin1，中文会乱码（实测 'é›¨' 这种）。
 * Hermes 上也没有 TextDecoder，所以手写一遍字节 -> 码点。
 */
function decodeBase64Utf8(b64: string): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const bytes: number[] = []
  let buf = 0
  let bits = 0
  for (let i = 0; i < b64.length; i++) {
    const c = b64[i]
    if (c === undefined || c === '=') break
    const v = chars.indexOf(c)
    if (v < 0) continue
    buf = (buf << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((buf >> bits) & 0xff)
    }
  }
  let out = ''
  for (let i = 0; i < bytes.length; ) {
    const b0 = bytes[i] ?? 0
    if (b0 < 0x80) {
      out += String.fromCharCode(b0)
      i += 1
    } else if (b0 < 0xe0) {
      const b1 = bytes[i + 1] ?? 0
      out += String.fromCharCode(((b0 & 0x1f) << 6) | (b1 & 0x3f))
      i += 2
    } else if (b0 < 0xf0) {
      const b1 = bytes[i + 1] ?? 0
      const b2 = bytes[i + 2] ?? 0
      out += String.fromCharCode(((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f))
      i += 3
    } else {
      const b1 = bytes[i + 1] ?? 0
      const b2 = bytes[i + 2] ?? 0
      const b3 = bytes[i + 3] ?? 0
      const cp = ((b0 & 0x07) << 18) | ((b1 & 0x3f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f)
      const v = cp - 0x10000
      out += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff))
      i += 4
    }
  }
  return out
}

export const kgSource: MusicSource = {
  id: 'kg',
  name: '酷狗音乐',
  getMusicUrl,
  getLyric,
  getPic,

  async musicSearch(keyword: string, page: number, limit: number): Promise<SearchResult> {
    const { http } = getPlatform()
    const query = new URLSearchParams({
      platform: 'WebFilter',
      filter: '2',
      iscorrection: '1',
      privilege_filter: '0',
      keyword,
      page: String(page),
      pagesize: String(limit),
    })
    const res = await http.request({ url: `${SEARCH_URL}?${query.toString()}`, method: 'GET' })
    if (res.statusCode !== 200) throw new Error(`[lxmn/kg] search HTTP ${res.statusCode}`)

    const parsed = JSON.parse(res.body) as {
      data?: { total?: number; lists?: unknown[] }
    }
    const list: MusicItem[] = []
    for (const raw of parsed.data?.lists ?? []) {
      const item = handleKgSearchItem(raw)
      if (!item) continue
      // 把封面模板挂到条目上，getPic 直接取用。
      // 酷狗返回的是模板串（.../stdmusic/{size}/...），直接把模板塞给 <img>
      // 会得到一张必然 404 的图 —— 这里就地替换成实际尺寸。
      const tpl = (raw as Record<string, unknown>).Image
      if (typeof tpl === 'string' && tpl) item.picUrl = tpl.replace(/\{size\}/g, '480')
      list.push(item)
    }
    const total = Number(parsed.data?.total ?? 0) || list.length
    return {
      list,
      total,
      limit,
      page,
      source: 'kg',
      allPage: limit > 0 ? Math.ceil(total / limit) : 1,
    }
  },
}

export function installKgSource(): void {
  registerSource('kg', kgSource)
  // 只声明 128k：免费端点对 320k/flac 的 hash 也一律只回 128k，见文件头
  setSupportQuality('kg', ['128k'])
}

export { SEARCH_URL as KG_SEARCH_URL, PLAY_URL as KG_PLAY_URL, decodeBase64Utf8 }
