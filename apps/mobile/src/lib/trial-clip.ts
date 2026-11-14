/**
 * 移动端试听片段判定（纯函数，不碰 TrackPlayer）。
 *
 * 内核的 isTrialClip 只回答「这段时长像不像试听」；这里补两件播放链路的事：
 *   1. 串源后实际播放的曲目可能没有 interval，要回落到队列里原曲的时长；
 *   2. 原生每秒发一次进度事件，必须有「本曲只重取一次」的防抖。
 */
import { intervalSeconds, isTrialClip, type MusicItem } from '@lxmn/core'

/** 原曲时长：取「实际播放条目」与「队列条目」里更长的那个有效值 */
export function expectedDuration(played: MusicItem | null, queued: MusicItem | null): number {
  return Math.max(intervalSeconds(played?.interval), intervalSeconds(queued?.interval))
}

/** 这一帧 duration 是否值得触发一次换源重取 */
export function shouldRetryTrialClip(duration: number, expected: number, retried: boolean): boolean {
  if (retried) return false
  if (!Number.isFinite(expected) || expected < 60) return false
  if (!Number.isFinite(duration) || duration <= 0) return false
  return isTrialClip(duration, expected)
}
