/**
 * 试听片段判定（回归测试）。
 *
 * 真实反馈：「怎么只有 20 秒试听」。取流阶段看不出来 —— 接口给的是能播的地址，
 * 只是内容只有 20~30 秒。所以必须在拿到 duration 之后判定，并换源重取。
 */
import { describe, it, expect } from 'vitest'
import { intervalSeconds, isTrialClip } from '@lxmn/core'

describe('intervalSeconds', () => {
  it('解析 mm:ss', () => {
    expect(intervalSeconds('05:12')).toBe(312)
    expect(intervalSeconds('00:20')).toBe(20)
  })
  it('解析 hh:mm:ss', () => {
    expect(intervalSeconds('01:02:03')).toBe(3723)
  })
  it('非法输入返回 0', () => {
    expect(intervalSeconds('')).toBe(0)
    expect(intervalSeconds(undefined)).toBe(0)
    expect(intervalSeconds('abc')).toBe(0)
    expect(intervalSeconds('a:b')).toBe(0)
  })
})

describe('isTrialClip', () => {
  it('5:12 的歌只给 20 秒 -> 判定为试听', () => {
    expect(isTrialClip(20, 312)).toBe(true)
  })
  it('5:12 的歌给 299 秒 -> 正常完整版', () => {
    expect(isTrialClip(299, 312)).toBe(false)
  })
  it('原曲本来就短（<60s）不做判定，避免铃声/间奏被误杀', () => {
    expect(isTrialClip(20, 25)).toBe(false)
  })
  it('时长未知（0 / NaN）不判定', () => {
    expect(isTrialClip(0, 300)).toBe(false)
    expect(isTrialClip(Number.NaN, 300)).toBe(false)
  })
  it('超过 45 秒的片段不算试听（可能是短版混音）', () => {
    expect(isTrialClip(50, 300)).toBe(false)
  })
})
