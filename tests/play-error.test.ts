/**
 * 播放失败分类与文案的单测（纯函数，不联网）
 *
 * 这两条规则直接决定「其他源」的可用性手感：
 * 该重试的必须重试（地址过期是酷狗/酷我的常态），
 * 不该重试的别浪费三次（网络断了、自动播放被拦）。
 */
import { describe, it, expect } from 'vitest'
import { isRetriablePlayError, describePlayError } from '../apps/desktop/src/lib/play-error'
import { pickBestMatch } from '../apps/desktop/src/lib/fallback'
import type { MusicItem } from '@lxmn/core'

function err(name: string, message: string): Error {
  const e = new Error(message)
  e.name = name
  return e
}

describe('isRetriablePlayError', () => {
  it('Chromium 的 no supported source 必须重试', () => {
    expect(isRetriablePlayError(
      err('NotSupportedError', 'Failed to load because no supported source was found.'),
    )).toBe(true)
  })

  it('地址过期/CDN 拒绝也重试', () => {
    expect(isRetriablePlayError(new Error('Failed to load'))).toBe(true)
  })

  it('取流阶段的「放不了」要换源', () => {
    expect(isRetriablePlayError(new Error('[lxmn/kg] 该歌曲暂无可播放地址（版权受限或需要付费）'))).toBe(true)
    expect(isRetriablePlayError(new Error('[lxmn/kw] 该歌曲暂无可播放地址（服务端仅返回占位音频）'))).toBe(true)
    expect(isRetriablePlayError(new Error('[lxmn/wy] 该歌曲为 VIP 专享'))).toBe(true)
  })

  it('自动播放被拦不重试', () => {
    expect(isRetriablePlayError(err('NotAllowedError', 'play() failed because the user didn\'t interact'))).toBe(false)
  })

  it('网络整体异常不重试（重试也是白等）', () => {
    expect(isRetriablePlayError(new Error('Failed to fetch'))).toBe(false)
    expect(isRetriablePlayError(new Error('[lxmn/wy] search HTTP 502'))).toBe(false)
  })
})

describe('describePlayError', () => {
  it('不把 Chromium 的英文原文抛给用户', () => {
    const msg = describePlayError(err('NotSupportedError', 'Failed to load because no supported source was found.'))
    expect(msg).not.toMatch(/no supported source/i)
    expect(msg).toMatch(/音源|地址/)
  })

  it('剥掉内部模块前缀', () => {
    expect(describePlayError(new Error('[lxmn/kg] 未知故障'))).toBe('未知故障')
  })

  it('空错误也有兜底文案', () => {
    expect(describePlayError(null)).toBe('播放失败，请重试')
  })
})

describe('pickBestMatch 的 avoid', () => {
  const want = { id: '1', name: '晴天', singer: '周杰伦', source: 'wy' } as MusicItem
  const candidates = [
    { id: '2', name: '晴天', singer: '周杰伦', source: 'kg' } as MusicItem,
    { id: '3', name: '晴天', singer: '周杰伦', source: 'mg' } as MusicItem,
  ]

  it('默认挑第一个匹配到的音源', () => {
    expect(pickBestMatch(want, candidates)?.source).toBe('kg')
  })

  it('被标记 avoid 的音源直接跳过，换下一个', () => {
    expect(pickBestMatch(want, candidates, new Set(['kg'] as const))?.source).toBe('mg')
  })

  it('全被 avoid 就返回 null（宁可没声也不要串错歌）', () => {
    expect(pickBestMatch(want, candidates, new Set(['kg', 'mg'] as const))).toBeNull()
  })
})
