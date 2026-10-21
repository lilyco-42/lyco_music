/**
 * 网易云歌单导入（9.5）
 *
 * lx 没有这个能力，但它是「99% 网易云体验」的最后一块：用户手里有几十个
 * 网易云歌单，迁移时一个个手点是不可能的。
 *
 * 只做**读取 + 匹配**，不写回网易云：拿歌单里的歌名/歌手，在我们自己的
 * 四个源里重新搜一遍。这样得到的曲目在任何源上都能播，而不是依赖网易云的
 * 播放权限。
 */
import type { MusicItem } from '../../types'
import { formatSingerName } from '../../sign'
import { eapiRequest } from './utils'

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
    result?: {
      playlistCount?: number
      playlists?: Array<{
        id?: number
        name?: string
        coverImgUrl?: string
        trackCount?: number
        playCount?: number
        creator?: { nickname?: string }
      }>
    }
  }
  if (parsed.code && parsed.code !== 200) throw new Error('网易云返回 code=' + parsed.code)
  const raw = parsed.result?.playlists ?? []
  const list: WyPlaylistBrief[] = []
  for (const item of raw) {
    if (item.id == null) continue
    list.push({
      id: String(item.id),
      name: String(item.name ?? '未命名歌单'),
      cover: String(item.coverImgUrl ?? ''),
      trackCount: Number(item.trackCount ?? 0) || 0,
      creator: String(item.creator?.nickname ?? ''),
      playCount: Number(item.playCount ?? 0) || 0,
    })
  }
  return { total: Number(parsed.result?.playlistCount ?? list.length) || list.length, list }
}
