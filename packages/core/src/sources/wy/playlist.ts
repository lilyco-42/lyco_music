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
