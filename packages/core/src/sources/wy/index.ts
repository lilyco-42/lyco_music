/**
 * 网易云音源 —— 结构对应 lx-music-desktop
 *   src/renderer/utils/musicSdk/wy/index.js
 *
 * 原文件通过 `apis('wy')` 间接取 getMusicUrl（为了支持用户自定义接口）。
 * 这里改为显式的 `setMusicUrlProvider`，用户自定义音源能力因此得以保留且更清晰。
 */
import type {
  MusicSource, MusicItem, LyricInfo, PicInfo, MusicUrlInfo, Quality, SearchResult,
  CommentResult, MusicComment,
} from '../../types'
import { registerSource, setSupportQuality } from '../registry'
import { formatSingerName, qualityOrder } from '../../sign'
import { eapiRequest } from './utils'
import { eapi } from './crypto'

/** 取播放地址 —— 允许宿主注入用户自定义实现（保留 lx-music 的自定义音源能力） */
export type MusicUrlProvider = (songInfo: MusicItem, quality: Quality) => Promise<MusicUrlInfo>

let urlProvider: MusicUrlProvider | null = null

export function setMusicUrlProvider(provider: MusicUrlProvider | null): void {
  urlProvider = provider
}

const WY_SONG_URL = '/api/song/enhance/player/url/v1'

/** 搜索单曲。上游 musicSearch.js 现用此路径（老的 /api/cloudsearch/pc 也仍可用）。 */
const WY_SEARCH_URL = '/api/search/song/list/page'

/**
 * 内核的 Quality 是**跨音源统一**的命名（128k/320k/flac/...），
 * 而网易 eapi 的 level 参数用的是另一套专有词（standard/higher/exhigh/lossless/hires）。
 *
 * 直接传 Quality 会被服务端判为非法 level，返回 code:-110 + url:null —— 实测
 * 'hires' 恰好与上游同名才碰巧能用，'128k' / '320k' / 'flac' 全部失败。
 * 这里做显式映射。
 */
const WY_LEVEL: Record<Quality, string> = {
  '128k': 'standard',
  '320k': 'exhigh',
  flac: 'lossless',
  flac24bit: 'lossless',
  hires: 'hires',
  atmos: 'jyeffect',
  master: 'jymaster',
}

/** 秒 -> mm:ss，对应上游 index.js 的 formatPlayTime */
function formatPlayTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00'
  const total = Math.floor(seconds)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** 字节数 -> "12.3MB"，对应上游的 sizeFormate */
function sizeFormate(bytes?: number): string | null {
  if (!bytes || bytes <= 0) return null
  const mb = bytes / 1024 / 1024
  return mb >= 1 ? `${mb.toFixed(1)}MB` : `${Math.round(bytes / 1024)}KB`
}

/** eapi 返回的曲目可播性信息（字段名来自真实响应） */
interface WyUrlItem {
  url?: string | null
  type?: string
  size?: number
  br?: number
  fee?: number
  level?: string
  freeTrialInfo?: unknown
  freeTrialPrivilege?: { resConsumable?: boolean; userConsumable?: boolean }
}

/**
 * 按音质从高到低依次尝试。
 *
 * 实测：同一首歌不同档位的可播性并不一致 —— 高音质可能被版权方锁住而低音质
 * 仍可免费播放。所以拿不到请求档位时逐级降档再试，而不是直接报错。
 * 降档顺序基于 WY_LEVEL 的值，去重后按 qualityOrder 从高到低。
 */
function fallbackChain(quality: Quality): Quality[] {
  const start = qualityOrder.indexOf(quality)
  const wanted = start === -1 ? qualityOrder : qualityOrder.slice(start)
  // 按 level 去重：flac 与 flac24bit 都映射到 lossless 时无需重复请求
  const seen = new Set<string>()
  const out: Quality[] = []
  for (const q of wanted) {
    const lvl = WY_LEVEL[q]
    if (!lvl || seen.has(lvl)) continue
    seen.add(lvl)
    out.push(q)
  }
  return out.length ? out : ['320k']
}

/**
 * 默认实现：走 eapi 取播放地址（与原接口同路径、同参数）。
 *
 * 失败时给出**可执行**的原因，而不是笼统的 "No playable url"：
 * 实测 fee=1（VIP 专享）时服务端返回 code:200 + url:null，
 * 这既不是网络错误也不是我们的签名错误，用户需要的是「这首歌要会员」这句话。
 */
const defaultGetMusicUrl: MusicUrlProvider = async (songInfo, quality) => {
  let last: { fee?: number; trial: boolean } | null = null

  for (const q of fallbackChain(quality)) {
    const { statusCode, body } = await eapiRequest(WY_SONG_URL, {
      ids: JSON.stringify([songInfo.songmid]),
      level: WY_LEVEL[q]!,
      encodeType: 'flac',
      header: { osver: '', deviceId: '', appver: '', versioncode: '', mobilename: '', buildver: '', resolution: '', __csrf: '', os: 'pc', channel: '', requestId: String(Date.now()) },
    })
    if (statusCode !== 200) throw new Error(`[lxmn/wy] HTTP ${statusCode}`)

    const parsed = JSON.parse(body) as { code?: number; data?: WyUrlItem[] }
    const item = parsed.data?.[0]
    if (item?.url) {
      return { url: item.url, quality: q, type: item.type ?? '', size: item.size }
    }
    last = { fee: item?.fee, trial: Boolean(item?.freeTrialInfo) }
  }

  // 注意措辞：这里的「账号」指**网易云音乐账号**，不是 Lyco 的登录账号。
  // 之前写成「当前未登录账号无法播放」，用户明明已经登录了 Lyco，
  // 看到这句话只会以为登录坏了。内核不认识 UI，所以把两种可能都写清楚。
  if (last?.fee === 1) {
    throw new Error('[lxmn/wy] 网易云将该歌曲标记为 VIP 专享，需要网易云会员账号才能取流；可换其他音源搜索同一首歌')
  }
  if (last?.trial) {
    throw new Error('[lxmn/wy] 网易云仅提供试听片段，完整版需要网易云会员账号；可换其他音源搜索同一首歌')
  }
  throw new Error('[lxmn/wy] 该歌曲暂无可播放地址（可能已下架或版权受限）')
}

/**
 * 搜索结果里一条原始记录 -> 内核的 MusicItem。
 *
 * 对应上游 musicSearch.js 的 handleResult。上游用 switch 的 fall-through
 * 逐级累加音质，这里照搬语义：maxbr 决定能到哪一档，privilege.maxBrLevel
 * 为 'hires' 时额外补一档 flac24bit。
 *
 * 注意上游的 types 是**降序**（hires/flac/320k/128k），这里保持同一顺序，
 * 因为 pickBestQuality 是按 qualityOrder 从高到低找的。
 */
function handleSearchItem(raw: unknown): MusicItem | null {
  const root = raw as { baseInfo?: { simpleSongData?: Record<string, unknown> } }
  const song = root?.baseInfo?.simpleSongData
  if (!song) return null

  const privilege = (song.privilege ?? {}) as { maxbr?: number; maxBrLevel?: string }
  const al = (song.al ?? {}) as { id?: number; name?: string; picUrl?: string }
  const ar = (song.ar ?? []) as unknown[]
  const qualitys: Partial<Record<Quality, unknown>> = {}

  // 上游是 switch 且**故意不写 break**（fall-through），效果是低音质也被填上。
  // 这里等价地按 maxbr 逐档填充，可读性更好且不依赖 fall-through 的隐式行为。
  const maxbr = privilege.maxbr ?? 0
  if (privilege.maxBrLevel === 'hires') {
    qualitys.flac24bit = { size: sizeFormate((song.hr as { size?: number } | undefined)?.size) }
  }
  if (maxbr >= 999000) {
    qualitys.flac = { size: sizeFormate((song.sq as { size?: number } | undefined)?.size) }
  }
  if (maxbr >= 320000) {
    qualitys['320k'] = { size: sizeFormate((song.h as { size?: number } | undefined)?.size) }
  }
  if (maxbr >= 128000 || maxbr === 0) {
    qualitys['128k'] = { size: sizeFormate((song.l as { size?: number } | undefined)?.size) }
  }

  return {
    id: song.id as number,
    name: String(song.name ?? ''),
    singer: formatSingerName(ar),
    albumName: al.name ?? '',
    albumId: al.id,
    source: 'wy',
    interval: formatPlayTime(Number(song.dt ?? 0) / 1000),
    songmid: song.id as number,
    picUrl: al.picUrl ?? '',
    qualitys,
  }
}

export const wySource: MusicSource = {
  id: 'wy',
  name: '网易云音乐',

  async getMusicUrl(songInfo: MusicItem, quality: Quality): Promise<MusicUrlInfo> {
    const provider = urlProvider ?? defaultGetMusicUrl
    return provider(songInfo, quality)
  },

  /**
   * 搜索单曲。对应上游 musicSearch.js 的 search()。
   *
   * 上游在此处有「失败重试 3 次」的逻辑，这里保留同样的意图，但把重试
   * 交给调用方（返回明确错误而不是静默重试），避免网络差时请求放大。
   */
  async musicSearch(keyword: string, page: number, limit: number): Promise<SearchResult> {
    const { statusCode, body } = await eapiRequest(WY_SEARCH_URL, {
      keyword,
      needCorrect: '1',
      channel: 'typing',
      offset: limit * (page - 1),
      scene: 'normal',
      total: page === 1,
      limit,
    })
    if (statusCode !== 200) throw new Error(`[lxmn/wy] search HTTP ${statusCode}`)

    const parsed = JSON.parse(body) as {
      code?: number
      data?: { resources?: unknown[]; totalCount?: number }
    }
    if (parsed.code !== 200) throw new Error(`[lxmn/wy] search code ${parsed.code}`)

    const list: MusicItem[] = []
    for (const raw of parsed.data?.resources ?? []) {
      const item = handleSearchItem(raw)
      if (item) list.push(item)
    }
    const total = parsed.data?.totalCount ?? list.length
    return {
      list,
      total,
      limit,
      page,
      source: 'wy',
      allPage: limit > 0 ? Math.ceil(total / limit) : 1,
    }
  },

  /** 对应原 getLyric(songInfo.songmid) */
  async getLyric(songInfo: MusicItem): Promise<LyricInfo> {
    // lv=原文 kv=逐字 tv=翻译 rv=罗马音 yv=逐字(yrc)。
    // rv 必须显式传 -1，不传接口根本不返回 romalrc（日文歌的罗马音就是这么丢的）。
    //
    // 注意端点：`/api/song/lyric` 返回的是标准 LRC；
    // `/api/song/lyric/v1` 会把 lrc 换成 `{"t":0,"c":[{"tx":"..."}]}` 这种富文本 JSON，
    // 而且实测并不额外给 yrc —— 换成 v1 只会把歌词解析搞坏，别再试了。
    const { body } = await eapiRequest('/api/song/lyric', {
      id: songInfo.songmid,
      lv: -1,
      kv: -1,
      tv: -1,
      rv: -1,
      yv: -1,
    })
    const parsed = JSON.parse(body) as {
      lrc?: { lyric?: string }
      tlyric?: { lyric?: string }
      romalrc?: { lyric?: string }
      yrc?: { lyric?: string }
    }
    return {
      lyric: parsed.lrc?.lyric ?? '',
      tlyric: parsed.tlyric?.lyric ?? '',
      romalrc: parsed.romalrc?.lyric ?? '',
      ylyric: parsed.yrc?.lyric ?? '',
    }
  },

  /**
   * 热门 + 最新评论。
   *
   * 网易的评论接口是公开的（不需要登录），路径里带资源类型：
   * R_SO_4_ 表示「单曲」。第 1 页额外返回 hotComments，把它拼在最前面，
   * 和网易云客户端的观感一致。
   */
  async getComments(songInfo: MusicItem, page = 1, limit = 20, sort: 'hot' | 'new' = 'hot'): Promise<CommentResult> {
    const offset = Math.max(0, (page - 1) * limit)
    const { body } = await eapiRequest('/api/v1/resource/comments/R_SO_4_' + String(songInfo.songmid), {
      rid: songInfo.songmid,
      limit,
      offset,
      total: true,
      csrf_token: '',
    })
    const parsed = JSON.parse(body) as {
      code?: number
      total?: number
      more?: boolean
      hotComments?: unknown[]
      comments?: unknown[]
    }
    if (parsed.code && parsed.code !== 200) throw new Error('[lxmn/wy] 评论接口返回 ' + parsed.code)

    const map = (raw: unknown): MusicComment => {
      const c = raw as {
        commentId?: number
        content?: string
        likedCount?: number
        time?: number
        floor?: number
        replyCount?: number
        beReplied?: unknown[]
        user?: { nickname?: string; avatarUrl?: string }
      }
      return {
        id: String(c.commentId ?? ''),
        content: String(c.content ?? ''),
        userName: String(c.user?.nickname ?? ''),
        avatar: c.user?.avatarUrl ?? '',
        likedCount: Number(c.likedCount ?? 0),
        time: Number(c.time ?? 0),
        floor: c.floor,
        replyCount: Array.isArray(c.beReplied) && c.beReplied.length ? c.beReplied.length : Number(c.replyCount ?? 0),
      }
    }

    // 「最新」只看时间序：把热门混进第一页会让用户以为"最新"里出现了旧评论
    const hot = page === 1 && sort === 'hot'
      ? (parsed.hotComments ?? []).map(raw => ({ ...map(raw), hot: true }))
      : []
    const normal = (parsed.comments ?? []).map(map)
    const list = [...hot, ...normal]
    return {
      list,
      total: Number(parsed.total ?? list.length),
      more: Boolean(parsed.more),
      page,
      limit,
    }
  },

  /** 对应原 getPic：先取 musicInfo 再读 al.picUrl */
  async getPic(songInfo: MusicItem): Promise<PicInfo> {
    const { body } = await eapiRequest('/api/v3/song/detail', {
      c: JSON.stringify([{ id: songInfo.songmid, v: 0 }]),
    })
    const parsed = JSON.parse(body) as { songs?: Array<{ al?: { picUrl?: string } }> }
    return { url: parsed.songs?.[0]?.al?.picUrl ?? '' }
  },

  /** 对应原 getMusicDetailPageUrl */
  getMusicDetailPageUrl(songInfo: MusicItem): string {
    return `https://music.163.com/#/song?id=${songInfo.songmid}`
  },
}

/** 注册到全局注册表（幂等） */
export function installWySource(): void {
  registerSource('wy', wySource)
  setSupportQuality('wy', ['master', 'atmos', 'hires', 'flac24bit', 'flac', '320k', '128k'])
}

export { WY_SONG_URL, WY_SEARCH_URL, WY_LEVEL, defaultGetMusicUrl, handleSearchItem, fallbackChain }
export { eapi, linuxapi, weapi, eapiDecrypt, WY_CONSTANTS } from './crypto'
export { eapiRequest, EAPI_BATCH_URL, EAPI_UA } from './utils'
export { parsePlaylistId, fetchWyPlaylist, type WyPlaylist } from './playlist'
