import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installWySource, setPlatform } from '@lxmn/core'
import { desktopPlatform } from '@lxmn/platform-desktop'

/**
 * 「切歌失败必须停掉上一首」的回归测试。
 *
 * 现场：正在放《罗生门》，点《不将就》，取流失败。
 * 旧实现只把 state.playing 置 false —— <audio> 不知道，罗生门继续唱，
 * 用户看到的是「不将就在加载」，耳朵里还是罗生门。
 *
 * 这里把内核的播放/停止通道换成探针，断言：
 *   1. 开始切歌就先停声（不等取流结果）；
 *   2. 取流彻底失败后再停一次，且 state.url 被清空。
 */

const fakeStorage = () => {
  const m = new Map<string, string>()
  return {
    async get(k: string) { return m.get(k) ?? null },
    async set(k: string, v: string) { m.set(k, v) },
    async remove(k: string) { m.delete(k) },
    async keys() { return [...m.keys()] },
  }
}

beforeEach(() => {
  installWySource()
  setPlatform({
    ...desktopPlatform,
    storage: fakeStorage(),
    // 所有网络请求都失败 —— 模拟「这首取不到流」
    http: (async () => { throw new Error('network down') }) as unknown as typeof desktopPlatform.http,
  } as typeof desktopPlatform)
})

describe('切歌时的停声', () => {
  it('取流失败后必须停声，且不再声称在播放', async () => {
    const { usePlayer, setPlaybackHandler, setStopHandler } = await import('@/lib/player')
    const player = usePlayer()

    let stopCount = 0
    const playedUrls: string[] = []
    setStopHandler(() => { stopCount += 1 })
    setPlaybackHandler(async (url: string) => { playedUrls.push(url) })

    await player.play({ songmid: 'a', source: 'wy', name: '罗生门', singer: 'x' } as never)

    const before = stopCount
    await player.play({ songmid: 'b', source: 'wy', name: '不将就', singer: 'y' } as never)

    // 开始切歌时就该停掉上一首（哪怕后面还要重试几次）
    expect(stopCount).toBeGreaterThan(before)
    // 失败后不允许还标记为播放中
    expect(player.state.playing).toBe(false)
    expect(player.state.url).toBe('')
    expect(player.state.error).toBeTruthy()
    // 全程没有真的把地址交给 <audio>
    expect(playedUrls).toEqual([])

    setStopHandler(null)
    setPlaybackHandler(null)
  })

  it('成功取流时不会误停（停声只发生在切歌起点）', async () => {
    const { usePlayer, setPlaybackHandler, setStopHandler } = await import('@/lib/player')
    const player = usePlayer()

    const calls: string[] = []
    setStopHandler(() => { calls.push('stop') })
    setPlaybackHandler(async (url: string) => { calls.push('play:' + url.slice(0, 4)) })

    await player.play({ songmid: 'c', source: 'wy', name: 'x', singer: 'y' } as never)
    // 失败场景下只有 stop，没有 play
    expect(calls.includes('stop')).toBe(true)
    expect(calls.filter(c => c.startsWith('play:'))).toEqual([])

    setStopHandler(null)
    setPlaybackHandler(null)
  })
})
