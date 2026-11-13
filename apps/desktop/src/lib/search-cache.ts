/**
 * 搜索结果的会话内缓存。
 *
 * 痛点：搜完 -> 点开播放器模式看歌词 -> 收起，搜索结果被重搜一遍（还要等网络），
 * 甚至因为路由重建直接空了。
 *
 * 这里只缓存「最近一次」搜索：用户回来看的就是刚才那批。不做多关键词 LRU ——
 * 一个 30 行的列表存 10 份也就几百 KB，但界面只有一处在用，多份反而让人
 * 分不清「我现在看到的是哪次的」。
 *
 * 存内存不存 localStorage：搜索结果带大量封面 URL 体积不小，且过期很快，
 * 应用重启后重搜一次是合理的。
 */
import type { MusicItem } from '@lxmn/core'

export interface SearchSnapshot {
  /** 关键词（归一化后比较） */
  keyword: string
  list: MusicItem[]
  total: number
  /** 音源筛选页签：'all' 或 wy/kw/kg/mg */
  source: string
  /** 单曲 / 歌单 */
  tab: 'songs' | 'playlists'
  /** 歌单页签的总数（回到搜索页时标题要显示「共 N 个歌单」） */
  playlistTotal: number
  /** 写入时间戳，用于过期判断 */
  at: number
}

/** 多久之后算过期。五分钟足够「听一首歌再回来」，再久重搜也是应该的 */
export const SEARCH_CACHE_TTL = 5 * 60_000

let last: SearchSnapshot | null = null

function key(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().toLowerCase()
}

export function saveSearchSnapshot(input: Omit<SearchSnapshot, 'at'> & { at?: number }): SearchSnapshot | null {
  const k = key(input.keyword)
  if (!k) return null
  last = {
    keyword: k,
    list: input.list,
    total: input.total,
    source: input.source,
    tab: input.tab,
    playlistTotal: input.playlistTotal,
    at: input.at ?? Date.now(),
  }
  return last
}

/** 取缓存：关键词不同、或已过期都返回 null（调用方照常去搜） */
export function readSearchSnapshot(keyword: string, now = Date.now()): SearchSnapshot | null {
  if (!last) return null
  if (last.keyword !== key(keyword)) return null
  if (now - last.at > SEARCH_CACHE_TTL) return null
  return last
}

/** 只更新筛选页签（用户切了音源/页签后，回来应该还原成他最后看到的样子） */
export function patchSearchSnapshot(patch: Partial<Pick<SearchSnapshot, 'source' | 'tab' | 'playlistTotal'>>): void {
  if (!last) return
  last = { ...last, ...patch }
}

export function clearSearchSnapshot(): void {
  last = null
}

export function hasSearchSnapshot(): boolean {
  return last !== null
}
