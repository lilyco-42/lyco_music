/**
 * 网易云歌单导入（9.5）
 *
 * lx 没有这个能力，但它是「99% 网易云体验」的最后一块：用户手里有几十个
 * 网易云歌单，迁移时一个个手点是不可能的。
 *
 * 只做**读取**，不写回网易云：把歌单里的曲目连同歌名/歌手/专辑/封面原样
 * 存进本地曲库。**刻意不做逐首跨源搜索** —— 播放链路本来就有三层静默兜底
 * （内置源 → 脚本源 → 跨源匹配），导入时再搜一遍既慢，又容易把「搜到了但
 * 不是这首」写进歌单。导入要秒级完成，换源交给播放时处理。
 */
import type { MusicItem } from '../../types'
import { formatSingerName } from '../../sign'
import { getPlatform } from '../../registry'
import { EAPI_UA, eapiRequest } from './utils'

/** 秒 -> mm:ss（与 wy 源内部的 formatPlayTime 一致） */
function formatPlayTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '00:00'
  const t = Math.floor(seconds)
  const m = Math.floor(t / 60)
  const s = t % 60
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')
}

export interface WyPlaylist {
  id: string
  name: string
  cover: string
  /** 歌单里实际有多少首（trackIds 的长度，可能大于 tracks） */
  total: number
  tracks: MusicItem[]
}

/**
 * 从各种粘贴形式里抠出歌单 id。
 *
 * 用户可能粘的是：
 *   https://music.163.com/playlist?id=123456
 *   https://y.music.163.com/m/playlist?app_version=8.9&id=123456
 *   https://music.163.com/#/playlist?id=123456
 *   「分享歌单《xxx》 https://music.163.com/playlist?id=123456 (来自@网易云音乐)」
 *   或者干脆只粘了 123456
 */
export function parsePlaylistId(text: string): string {
  const raw = String(text || '').trim()
  if (!raw) return ''
  const m = /[?&#]id=(\d+)/.exec(raw) || /playlist\/(\d+)/.exec(raw)
  if (m && m[1]) return m[1]
  if (/^\d{4,}$/.test(raw)) return raw
  return ''
}

/* ---------------- 短链（163cn.tv / 163cn.link） ---------------- */

/** 网易云客户端「分享」给出的短链域名 */
const SHORT_LINK_HOSTS = ['163cn.tv', '163cn.link']

/**
 * 判断这段文本里是否含网易云短链，并取出它的短码。
 *
 * 客户端的分享文案长这样：
 *   「分享单曲《xxx》 https://163cn.tv/zoIxm3 (@网易云音乐)」
 * 短码是大小写敏感的 base62，所以不能像歌单 id 那样只认数字。
 */
function parseShortLinkCode(text: string): string {
  const m = /https?:\/\/([a-z0-9.-]*163cn\.(?:tv|link))\/([A-Za-z0-9_-]+)/i.exec(String(text || ''))
  if (!m) return ''
  const host = (m[1] || '').toLowerCase()
  if (!SHORT_LINK_HOSTS.some(h => host === h || host.endsWith('.' + h))) return ''
  return m[2] || ''
}

/** 从落地页 HTML 里取 og: / canonical 的值（属性顺序两种都试） */
function metaContent(html: string, attr: 'property' | 'rel', key: string): string {
  const tail = attr + '="' + key + '"'
  const patterns = [
    new RegExp('<meta[^>]*' + tail + '[^>]*content="([^"]*)"', 'i'),
    new RegExp('<meta[^>]*content="([^"]*)"[^>]*' + tail, 'i'),
    new RegExp('<link[^>]*' + tail + '[^>]*href="([^"]*)"', 'i'),
    new RegExp('<link[^>]*href="([^"]*)"[^>]*' + tail, 'i'),
  ]
  for (const re of patterns) {
    const m = re.exec(html)
    if (m && m[1]) return m[1]
  }
  return ''
}

/**
 * 把短链解析成歌单 id。
 *
 * 短链本身只回 302，`location` 头里就带着 `id=`；但平台层的 http 适配器
 * 会自动跟随重定向且不回传最终 URL（desktop 的 createFetchHttp 只回
 * statusCode/headers/body），所以拿不到 location。于是改成读落地页里的
 * 元信息 —— 网易云的歌单页一定会给出 canonical 与 og:url，两者都带 id。
 *
 * 三种落地页形态都已实测（PC / 移动 UA 结果一致）：
 *   歌单： canonical=…/playlist?id=…
 *   单曲： og:type=music.song，canonical=…/song?id=…（没有 playlist 段）
 *   失效： og:type=website，canonical=https://music.163.com/（没有 id）
 */
async function resolveShortLink(code: string): Promise<string> {
  const res = await getPlatform().http.request({
    url: 'https://163cn.tv/' + encodeURIComponent(code),
    method: 'GET',
    headers: { 'User-Agent': EAPI_UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
  })
  const html = String(res.body ?? '')
  if (!html) throw new Error('短链打不开：网易云没有返回内容，请检查网络后重试')

  if (metaContent(html, 'property', 'og:type') === 'music.song') {
    throw new Error('这是单曲短链，不是歌单。请在网易云里打开歌单再分享，或直接粘歌单链接')
  }

  // canonical 最稳，og:url 兜底
  for (const page of [metaContent(html, 'rel', 'canonical'), metaContent(html, 'property', 'og:url')]) {
    const id = parsePlaylistId(page)
    if (id) return id
  }
  throw new Error('短链无效或已过期：请在网易云里重新复制歌单链接')
}

/**
 * 从用户粘贴的任意文本里解析出歌单 id，必要时展开 163cn.tv 短链。
 *
 * 为什么单独开一个 async 版本：短链必须发一次请求才知道指向哪个歌单，
 * 而 parsePlaylistId 是同步的（调用方常常只关心纯链接）。保留同步快路径，
 * 只有识别出短链才走网络，两个入口都在，调用方按需选。
 */
export async function resolvePlaylistId(text: string): Promise<string> {
  const direct = parsePlaylistId(text)
  if (direct) return direct
  const code = parseShortLinkCode(text)
  if (!code) throw new Error('没找到歌单 id：请粘歌单链接，或直接粘那串数字')
  return resolveShortLink(code)
}

function toItem(song: Record<string, unknown>): MusicItem | null {
  const id = song.id
  if (id == null) return null
  const al = (song.al ?? {}) as { id?: number; name?: string; picUrl?: string }
  const ar = (song.ar ?? []) as unknown[]
  const dt = Number(song.dt ?? 0)
  return {
    id: id as number,
    name: String(song.name ?? ''),
    singer: formatSingerName(ar),
    albumName: al.name ?? '',
    albumId: al.id,
    source: 'wy',
    interval: formatPlayTime(dt / 1000),
    songmid: id as number,
    picUrl: al.picUrl ?? '',
  }
}

/**
 * 取歌单详情。
 *
 * `/api/v6/playlist/detail` 的 tracks 只给前若干首（大歌单会被截断），
 * 完整的 id 列表在 trackIds 里。缺的部分用 `/api/v3/song/detail` 批量补齐，
 * 每批 100 个 id —— 端点有长度限制，一次传 1000 个会被拒。
 */
export async function fetchWyPlaylist(id: string): Promise<WyPlaylist> {
  const pid = String(id || '').trim()
  if (!/^\d+$/.test(pid)) throw new Error('歌单 id 不合法')
  const { body } = await eapiRequest('/api/v6/playlist/detail', { id: pid, n: 1000, s: 8 })
  const parsed = JSON.parse(body) as {
    code?: number
    playlist?: {
      id?: number
      name?: string
      coverImgUrl?: string
      tracks?: Record<string, unknown>[]
      trackIds?: { id?: number }[]
    }
  }
  if (parsed.code && parsed.code !== 200) throw new Error('网易云返回 code=' + parsed.code)
  const pl = parsed.playlist
  if (!pl) throw new Error('歌单不存在或已设为私密')

  const tracks = (pl.tracks ?? []).map(toItem).filter((x): x is MusicItem => Boolean(x))
  const ids = (pl.trackIds ?? []).map(t => t.id).filter((x): x is number => typeof x === 'number')
  const have = new Set(tracks.map(t => String(t.songmid)))
  const missing = ids.filter(x => !have.has(String(x)))

  for (let i = 0; i < missing.length; i += 100) {
    const batch = missing.slice(i, i + 100)
    const res = await eapiRequest('/api/v3/song/detail', {
      c: JSON.stringify(batch.map(x => ({ id: x, v: 0 }))),
    })
    const songs = (JSON.parse(res.body) as { songs?: Record<string, unknown>[] }).songs ?? []
    for (const s of songs) {
      const item = toItem(s)
      if (item) tracks.push(item)
    }
  }

  return {
    id: pid,
    name: String(pl.name ?? '网易云歌单'),
    cover: String(pl.coverImgUrl ?? ''),
    total: ids.length || tracks.length,
    tracks,
  }
}

/* ---------------- 排行榜（1.9） ---------------- */

/**
 * 网易云的官方榜。
 *
 * 为什么写死这张表而不是调 `/weapi/toplist`：那个端点要 weapi 加密
 * （lx 也是这么处理的），而且返回的榜单 id 常年不变。写死换来的是
 * 「打开就能点」，代价是新增榜单要发一次版 —— 对一张几十项的静态表来说值得。
 *
 * id 就是歌单 id，取详情走 fetchWyPlaylist（同一套逻辑，不重复实现）。
 */
export interface WyBoard {
  /** 歌单 id（榜单本质上就是一个歌单） */
  id: string
  name: string
  /** 一句话说明，卡片上用 */
  desc: string
}

export const WY_BOARDS: readonly WyBoard[] = [
  { id: '3778678', name: '热歌榜', desc: '此刻最多人在听' },
  { id: '19723756', name: '飙升榜', desc: '24 小时播放涨幅' },
  { id: '3779629', name: '新歌榜', desc: '最新上架' },
  { id: '2884035', name: '原创榜', desc: '独立音乐人' },
  { id: '991319590', name: '说唱榜', desc: '中文说唱' },
  { id: '5059642708', name: '国风榜', desc: '国风新声' },
  { id: '71385702', name: 'ACG 榜', desc: '动画游戏音乐' },
  { id: '1978921795', name: '电音榜', desc: '电子舞曲' },
  { id: '71384707', name: '古典榜', desc: '古典与跨界' },
  { id: '745956260', name: '韩语榜', desc: 'K-POP' },
  { id: '5059644681', name: '日语榜', desc: 'J-POP' },
  { id: '2809513713', name: '欧美热歌榜', desc: '欧美流行' },
  { id: '60198', name: '美国 Billboard 榜', desc: 'Billboard Hot 100' },
  { id: '180106', name: 'UK 排行榜周榜', desc: '英国单曲榜' },
  { id: '60131', name: '日本 Oricon 榜', desc: 'Oricon 周榜' },
  { id: '5059633707', name: '摇滚榜', desc: '摇滚与另类' },
  { id: '5059661515', name: '民谣榜', desc: '民谣与弹唱' },
  { id: '6723173524', name: '网络热歌榜', desc: '短视频热歌' },
]

/* ---------------- 歌单搜索（1.8） ---------------- */

/**
 * 这条结果为什么会出现在搜索里。
 *
 * 网易云 type=1000 会同时模糊匹配「歌单名」和「创建者昵称」，还会塞一些
 * 相关推荐；返回里没有任何「命中原因」字段。用户搜一个作者名时看到一堆
 * 作者根本不叫这个名字的歌单，就是这么来的。这里在本地按关键词归类，
 * 让界面能把三类结果分开标、分开筛。
 */
export type WyPlaylistMatch = 'name' | 'creator' | 'other'

export interface WyPlaylistBrief {
  id: string
  name: string
  cover: string
  /** 曲目数 */
  trackCount: number
  /** 创建者昵称 */
  creator: string
  /** 播放量（原始数字，界面上自己换算成万/亿） */
  playCount: number
  /** 相对本次关键词的命中位置；老数据/外部构造可能没有，界面按 other 兜底 */
  match?: WyPlaylistMatch
  /** 创建者 uid（按创建者精确搜歌单时带上） */
  creatorId?: number
}

/** 大小写、全半角空白都不影响命中判断 */
function normalizeMatchText(v: unknown): string {
  return String(v ?? '').toLowerCase().replace(/[\s\u3000]+/g, '')
}

export function classifyPlaylistMatch(
  keyword: string,
  item: Pick<WyPlaylistBrief, 'name' | 'creator'>,
): WyPlaylistMatch {
  const q = normalizeMatchText(keyword)
  if (!q) return 'other'
  if (normalizeMatchText(item.name).includes(q)) return 'name'
  if (normalizeMatchText(item.creator).includes(q)) return 'creator'
  return 'other'
}

/**
 * 按关键词搜歌单（不是搜单曲）。
 *
 * 走 `/api/cloudsearch/pc` 的 `type=1000`：单曲是 1、专辑 10、歌手 100，
 * 歌单是 1000。这个端点不需要登录态，返回里 `result.playlists` 是列表。
 */
interface RawWyPlaylist {
  id?: number
  name?: string
  coverImgUrl?: string
  trackCount?: number
  playCount?: number
  creator?: { nickname?: string; userId?: number }
  userId?: number
  specialType?: number
}

function toBrief(
  item: RawWyPlaylist,
  keyword: string,
  match?: WyPlaylistMatch,
  creatorId?: number,
): WyPlaylistBrief | null {
  if (item.id == null) return null
  const name = String(item.name ?? '未命名歌单')
  const creator = String(item.creator?.nickname ?? '')
  const brief: WyPlaylistBrief = {
    id: String(item.id),
    name,
    cover: String(item.coverImgUrl ?? ''),
    trackCount: Number(item.trackCount ?? 0) || 0,
    creator,
    playCount: Number(item.playCount ?? 0) || 0,
    match: match ?? classifyPlaylistMatch(keyword, { name, creator }),
  }
  if (creatorId) brief.creatorId = creatorId
  return brief
}

/**
 * 按关键词搜歌单（不是搜单曲）。
 *
 * 走 `/api/cloudsearch/pc` 的 `type=1000`：单曲是 1、专辑 10、歌手 100，
 * 歌单是 1000。这个端点不需要登录态，返回里 `result.playlists` 是列表。
 */
export async function searchWyPlaylists(
  keyword: string,
  page = 1,
  limit = 24,
): Promise<{ total: number; list: WyPlaylistBrief[] }> {
  const text = String(keyword ?? '').trim()
  if (!text) return { total: 0, list: [] }
  const p = Math.max(1, Math.floor(page))
  const n = Math.min(50, Math.max(1, Math.floor(limit)))
  const { body } = await eapiRequest('/api/cloudsearch/pc', {
    s: text,
    type: 1000,
    limit: n,
    total: p === 1,
    offset: n * (p - 1),
  })
  const parsed = JSON.parse(body) as {
    code?: number
    result?: { playlistCount?: number; playlists?: RawWyPlaylist[] }
  }
  if (parsed.code && parsed.code !== 200) throw new Error('网易云返回 code=' + parsed.code)
  const raw = parsed.result?.playlists ?? []
  const list: WyPlaylistBrief[] = []
  for (const item of raw) {
    const brief = toBrief(item, text)
    if (brief) list.push(brief)
  }
  return { total: Number(parsed.result?.playlistCount ?? list.length) || list.length, list }
}

export interface WyCreatorPlaylists {
  /** 实际命中的用户昵称（可能和输入的大小写不同） */
  creator: string
  creatorId: number
  /** 该用户创建的公开歌单数 */
  total: number
  list: WyPlaylistBrief[]
}

/**
 * 「只看这个创建者的歌单」。
 *
 * 不能拿 type=1000 的结果在本地过滤：实测搜 lilyco42 时，用户有 14 张
 * 自建歌单，搜索结果里却只出现 12 张（其余被歌单名命中挤掉了）。正确做法：
 *   1. type=1002 搜用户，优先取昵称完全相等的那个；
 *   2. /api/user/playlist 拉该用户主页歌单；
 *   3. 过滤掉他收藏的别人歌单（这个接口会把收藏混在一起返回）。
 * 三步都不需要登录态。
 */
export async function searchWyPlaylistsByCreator(
  keyword: string,
  limit = 200,
): Promise<WyCreatorPlaylists> {
  const text = String(keyword ?? '').trim()
  if (!text) return { creator: '', creatorId: 0, total: 0, list: [] }
  const { body } = await eapiRequest('/api/cloudsearch/pc', {
    s: text,
    type: 1002,
    limit: 10,
    total: true,
    offset: 0,
  })
  const u = JSON.parse(body) as {
    code?: number
    result?: { userprofiles?: Array<{ nickname?: string; userId?: number }> }
  }
  if (u.code && u.code !== 200) throw new Error('网易云返回 code=' + u.code)
  const profiles = u.result?.userprofiles ?? []
  const wanted = normalizeMatchText(text)
  const profile = profiles.find(x => normalizeMatchText(x.nickname) === wanted) ?? profiles[0]
  const uid = Number(profile?.userId ?? 0)
  if (!uid) return { creator: '', creatorId: 0, total: 0, list: [] }

  const { body: userBody } = await eapiRequest('/api/user/playlist', {
    uid,
    limit: 1000,
    offset: 0,
    includeVideo: true,
  })
  const r = JSON.parse(userBody) as {
    code?: number
    more?: boolean
    playlist?: RawWyPlaylist[]
  }
  if (r.code && r.code !== 200) throw new Error('网易云返回 code=' + r.code)
  const own = (r.playlist ?? []).filter(
    p => Number(p.userId ?? p.creator?.userId ?? 0) === uid,
  )
  const n = Math.min(200, Math.max(1, Math.floor(limit)))
  const list: WyPlaylistBrief[] = []
  for (const p of own.slice(0, n)) {
    const brief = toBrief(p, text, 'creator', uid)
    if (brief) list.push(brief)
  }
  return { creator: String(profile?.nickname ?? ''), creatorId: uid, total: own.length, list }
}
