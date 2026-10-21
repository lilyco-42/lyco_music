/**
 * 「同一首歌」的判定
 *
 * 曲库里所有去重都靠这个键：收藏、试听列表、歌单条目、播放记录。
 * 单独抽出来是因为它必须**唯一** —— 只要有一处规则不同，
 * 同步合并后同一首歌就会变成两条，界面上看起来像重复添加了。
 *
 * 键里带 source 是刻意的：wy 和 kw 的同一首歌 songmid 不通用，
 * 流地址、音质、歌词都不同，合并成一条会导致换源后播不出来。
 */
import type { MusicItem } from './types'

/** 曲目唯一键，形如 `wy::001ABC` */
export function trackKey(item: { source?: string; songmid?: string | number } | null | undefined): string {
  return String(item?.source ?? '') + '::' + String(item?.songmid ?? '')
}

/** 是否同一首歌 */
export function isSameTrack(
  a: { source?: string; songmid?: string | number } | null | undefined,
  b: { source?: string; songmid?: string | number } | null | undefined,
): boolean {
  return trackKey(a) === trackKey(b)
}

/**
 * 去掉列表里的重复曲目，保留首次出现的位置。
 *
 * 用于「载入 / 同步合并」之后兜底：老数据里可能有重复，
 * 界面上出现两行一模一样的歌，用户只会觉得是 bug。
 */
export function dedupeTracks<T extends MusicItem>(list: readonly T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of list) {
    const key = trackKey(item)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}
