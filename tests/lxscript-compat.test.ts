/**
 * lx 脚本运行时兼容性 —— 回归测试
 *
 * 背景：野花（flower）等脚本从 globalThis.lx 解构 API，且会用数组风格 headers、
 * 甚至把数组 JSON.stringify 后塞进 header 值。这些真实脚本行为曾在沙箱里全部炸掉，
 * 导致「会员还是听不了歌」。这里把三个坑钉死。
 */
import { describe, it, expect } from 'vitest'
import { setPlatform, LxScript } from '@lxmn/core'
import { desktopPlatform } from '@lxmn/platform-desktop'
import type { PlatformAdapter } from '@lxmn/core'

/** globalThis.lx 解构 + 数组 headers + 带 \n 的 header 值，一次全踩 */
const SCRIPT = `
;(function () {
  const { EVENT_NAMES, request, on, send, utils } = globalThis.lx
  on(EVENT_NAMES.request, (args) => {
    return new Promise((resolve) => {
      request('http://127.0.0.1:9/v1/url/' + args.source + '/' + args.info.musicInfo.songmid + '/' + args.info.type, {
        method: 'GET',
        headers: [['User-Agent', 'lx-music/desktop'], ['tag', JSON.stringify(args.info.qualitys)]],
      }, (err, resp) => {
        if (err) return resolve('')
        resolve(resp.body && resp.body.url ? resp.body.url : '')
      })
    })
  })
  send(EVENT_NAMES.inited, { status: true, sources: { wy: { type: 'music', actions: ['musicUrl'], qualitys: ['128k'] } }, name: 'test', version: '1' })
})()
`

describe('LxScript 兼容性', () => {
  it('从 globalThis.lx 解构 API 并完成初始化', async () => {
    setPlatform(desktopPlatform)
    const s = new LxScript('t-global', SCRIPT)
    const ok = await s.load(8000)
    expect(ok).toBe(true)
    expect(s.state).toBe('ready')
    expect(s.supports('wy')).toBe(true)
  })

  it('数组风格 headers 与含换行的 header 值不再炸掉请求', async () => {
    const calls: unknown[] = []
    const fake: PlatformAdapter = {
      ...desktopPlatform,
      http: {
        ...desktopPlatform.http,
        async request(o) {
          calls.push(o)
          return { statusCode: 200, headers: {}, body: JSON.stringify({ url: 'http://x/y.mp3' }), raw: new Uint8Array() }
        },
      },
    } as PlatformAdapter
    setPlatform(fake)
    const s = new LxScript('t-headers', SCRIPT)
    await s.load(8000)
    const url = await s.getMusicUrl('wy', { songmid: '123', name: 'x' }, '128k')
    expect(url).toBe('http://x/y.mp3')
    expect(calls.length).toBeGreaterThan(0)
  })
})
