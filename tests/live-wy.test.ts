
/**
 * 真实网络集成测试 —— 默认不跑（需要联网），用 LIVE=1 显式开启：
 *   LIVE=1 pnpm vitest run tests/live-wy.test.ts
 *
 * 单测里的假 HTTP 只能证明「参数拼对了」，证明不了「对面真的认」。
 * 这个文件对真实接口打一次，用来发现协议层面的漂移。
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { setPlatform, installWySource, getSource } from '@lxmn/core'
import { desktopPlatform } from '@lxmn/platform-desktop'

const live = process.env.LIVE === '1'

describe.skipIf(!live)('wy against the real NetEase API', () => {
  beforeAll(() => {
    setPlatform(desktopPlatform)
    installWySource()
  })

  it('searches and resolves a real play url', async () => {
    const r = await getSource('wy').musicSearch!('起风了', 1, 10)
    expect(r.total).toBeGreaterThan(0)
    expect(r.list.length).toBeGreaterThan(0)
    console.log('  found', r.list.length, 'of', r.total)

    // 搜索出来的字段必须够用：没有 songmid 就没法取流
    for (const s of r.list) {
      expect(s.songmid).toBeTruthy()
      expect(s.singer).toBeTruthy()
    }

    // 网易大量曲目是 VIP 专享（实测 fee=1 -> url:null），
    // 未登录账号只能播免费的。这里遍历搜索结果，只要有一首能出地址就算通过；
    // 全都被锁则跳过，而不是误报成移植缺陷。
    let ok = 0
    for (const s of r.list) {
      try {
        const u = await getSource('wy').getMusicUrl(s, '320k')
        if (u.url) {
          console.log('  playable:', s.name, '-', s.singer, '->', u.url.slice(0, 60) + '...')
          ok++
        }
      } catch (e) {
        console.log('  locked:', s.name, '-', s.singer, '->', (e as Error).message)
      }
    }
    console.log('  playable count:', ok, '/', r.list.length)
    expect(ok).toBeGreaterThan(0)
  }, 120000)

  it('fetches real lyrics', async () => {
    const r = await getSource('wy').musicSearch!('起风了', 1, 1)
    const s = r.list[0]!
    const l = await getSource('wy').getLyric(s)
    console.log('  lyric bytes:', l.lyric.length)
    expect(l.lyric.length).toBeGreaterThan(0)
    expect(l.lyric).toMatch(/\[\d{2}:\d{2}/)
  }, 60000)

  /**
   * 罗马音（日文歌）。
   *
   * 这条用例的意义：歌词接口的 rv 参数漏传时，接口不会报错，
   * 只是安静地不返回 romalrc —— 表现就是「日文歌永远没有罗马音」。
   * 只有真打一次接口才能发现这种沉默的缺失。
   */
  it('fetches romaji for a japanese song', async () => {
    const r = await getSource('wy').musicSearch!('夜に駆ける YOASOBI', 1, 5)
    expect(r.list.length).toBeGreaterThan(0)
    let roma = ''
    for (const s of r.list) {
      const l = await getSource('wy').getLyric(s)
      if (l.romalrc?.trim()) { roma = l.romalrc; break }
    }
    console.log('  romaji bytes:', roma.length)
    expect(roma.length).toBeGreaterThan(0)
    expect(roma).toMatch(/\[\d{2}:\d{2}/)
  }, 60000)
})
