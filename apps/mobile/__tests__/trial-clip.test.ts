/**
 * 移动端试听重取：时长判定与防抖（纯函数，不加载 TrackPlayer）。
 */
import { expectedDuration, shouldRetryTrialClip } from '../src/lib/trial-clip'
import type { MusicItem } from '@lxmn/core'

const item = (v: unknown): MusicItem => ({ id: '1', name: '歌', singer: '人', source: 'wy', interval: v } as MusicItem)

describe('expectedDuration', () => {
  it('串源后的播放条目缺 interval 时回落到队列里的原曲时长', () => {
    expect(expectedDuration(item(undefined), item('05:12'))).toBe(312)
    expect(expectedDuration(item('03:00'), item('05:12'))).toBe(312)
    expect(expectedDuration(item(undefined), item(undefined))).toBe(0)
  })
})

describe('shouldRetryTrialClip', () => {
  it('5:12 的歌只给 20 秒触发一次换源', () => {
    expect(shouldRetryTrialClip(20, 312, false)).toBe(true)
    expect(shouldRetryTrialClip(20, 312, true)).toBe(false)
  })

  it('短曲 / 完整版 / 脏 duration 都不触发', () => {
    expect(shouldRetryTrialClip(20, 25, false)).toBe(false)
    expect(shouldRetryTrialClip(299, 312, false)).toBe(false)
    expect(shouldRetryTrialClip(50, 300, false)).toBe(false)
    expect(shouldRetryTrialClip(0, 300, false)).toBe(false)
    expect(shouldRetryTrialClip(Number.NaN, 300, false)).toBe(false)
  })
})
