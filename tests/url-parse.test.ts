/**
 * URL 解析工具
 *
 * 背景：移动端（Hermes）的 `URL` 是 whatwg-url-without-unicode 的裁剪版，
 * 访问 `protocol` / `hostname` 会抛 `URL.protocol is not implemented`。
 * 而 `SyncClient` 构造函数里就要解析 base URL，`Library` 又在模块顶层
 * `new` 出来 —— 一处抛错会让整个 sync 模块加载失败，
 * 界面表现为「每个页面都报 Cannot read property 'library' of undefined」。
 *
 * 这些用例锁住三件事：
 *   1. 解析结果与 `new URL()` 在 Node 下一致（正常路径不能有偏差）；
 *   2. 非法输入返回 null 而不是抛错；
 *   3. 只用字符串运算，不碰全局 URL。
 */
import { describe, expect, it } from 'vitest'

import { parseHttpUrl, parseLooseHttpUrl } from '../packages/core/src/util/url'

describe('parseHttpUrl', () => {
  it('解析普通 https 地址', () => {
    const u = parseHttpUrl('https://lain42.top/studio/api')
    expect(u).toEqual({
      protocol: 'https:',
      hostname: 'lain42.top',
      port: '',
      origin: 'https://lain42.top',
      pathname: '/studio/api',
      href: 'https://lain42.top/studio/api',
    })
  })

  it('保留端口', () => {
    const u = parseHttpUrl('http://localhost:8080/studio')
    expect(u?.hostname).toBe('localhost')
    expect(u?.port).toBe('8080')
    expect(u?.origin).toBe('http://localhost:8080')
  })

  it('主机名大小写归一，协议也归一', () => {
    const u = parseHttpUrl('HTTPS://Lain42.TOP/Studio')
    expect(u?.protocol).toBe('https:')
    expect(u?.hostname).toBe('lain42.top')
    // 路径大小写不能动：服务端可能区分
    expect(u?.pathname).toBe('/Studio')
  })

  it('保留 query，丢掉 hash', () => {
    const u = parseHttpUrl('https://a.com/x?y=1#frag')
    expect(u?.href).toBe('https://a.com/x?y=1')
    expect(u?.pathname).toBe('/x')
  })

  it('没有路径时 pathname 为空串', () => {
    const u = parseHttpUrl('https://a.com')
    expect(u?.pathname).toBe('')
    expect(u?.href).toBe('https://a.com')
  })

  it('非 http(s) 协议返回 null', () => {
    expect(parseHttpUrl('ftp://a.com')).toBeNull()
    expect(parseHttpUrl('file:///tmp/x')).toBeNull()
    expect(parseHttpUrl('lain42.top/studio')).toBeNull()
  })

  it('空串 / 垃圾输入返回 null，不抛错', () => {
    expect(parseHttpUrl('')).toBeNull()
    expect(parseHttpUrl('   ')).toBeNull()
    expect(parseHttpUrl('https://')).toBeNull()
  })
})

describe('parseLooseHttpUrl', () => {
  it('只填域名时自动补 https', () => {
    expect(parseLooseHttpUrl('lain42.top')?.href).toBe('https://lain42.top')
    expect(parseLooseHttpUrl('lain42.top/studio')?.href).toBe('https://lain42.top/studio')
  })

  it('已经带协议就不重复补', () => {
    expect(parseLooseHttpUrl('http://127.0.0.1:9000')?.origin).toBe('http://127.0.0.1:9000')
  })

  it('空输入返回 null', () => {
    expect(parseLooseHttpUrl('')).toBeNull()
  })
})

describe('不依赖全局 URL', () => {
  it('把全局 URL 打坏之后依然可用', () => {
    const original = globalThis.URL
    // 模拟 Hermes：构造能过，但一取 protocol 就炸
    class BrokenURL {
      constructor() {
        throw new Error('URL.protocol is not implemented')
      }
    }
    ;(globalThis as unknown as { URL: unknown }).URL = BrokenURL
    try {
      expect(parseHttpUrl('https://lain42.top/studio')?.origin).toBe('https://lain42.top')
      expect(parseLooseHttpUrl('lain42.top')?.hostname).toBe('lain42.top')
    } finally {
      ;(globalThis as unknown as { URL: unknown }).URL = original
    }
  })
})

describe('SyncClient 构造不依赖全局 URL', () => {
  it('URL 被打坏时仍能构造，且 base 归一化正确', async () => {
    const { SyncClient } = await import('../packages/core/src/sync/client')
    const original = globalThis.URL
    class BrokenURL {
      constructor() {
        throw new Error('URL.protocol is not implemented')
      }
    }
    ;(globalThis as unknown as { URL: unknown }).URL = BrokenURL
    try {
      // 裸域名要补 https，并且 lain42.top 自动补 /studio
      expect(new SyncClient({ baseUrl: 'lain42.top' }).server).toBe('https://lain42.top/studio')
      // 已带 /studio 不重复加
      expect(new SyncClient({ baseUrl: 'https://lain42.top/studio' }).server).toBe('https://lain42.top/studio')
      // 自建地址原样保留
      expect(new SyncClient({ baseUrl: 'https://sync.example.com' }).server).toBe('https://sync.example.com')
      // 非法输入退回默认，不抛
      expect(new SyncClient({ baseUrl: '::::' }).server).toBe('https://lain42.top/studio')
    } finally {
      ;(globalThis as unknown as { URL: unknown }).URL = original
    }
  })

  it('http 的自建地址会被拒绝（安全约束不能因为修兼容而放松）', async () => {
    const { SyncClient } = await import('../packages/core/src/sync/client')
    expect(() => new SyncClient({ baseUrl: 'http://sync.example.com' })).toThrow(/https/)
    // 本机调试例外
    expect(new SyncClient({ baseUrl: 'http://127.0.0.1:9000' }).server).toBe('http://127.0.0.1:9000')
  })
})
