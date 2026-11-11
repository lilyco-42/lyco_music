/**
 * Scheme URL 的投递时序（6.6）。
 *
 * 背景：冷启动带 `lxmusic://…` 时链接比渲染层先到 —— 主进程在
 * `whenReady` 里就 consumeArgv，那时窗口刚 createWindow()，页面还在加载、
 * Vue 还没挂载、`lxmn:scheme` 监听还不存在。原来的实现是「等 300ms 再发」，
 * 实测照样丢（真机复现：应用起来了，歌单没导入，侧栏数量不变）。
 *
 * 现在改成握手 + 队列：渲染层挂好监听后 invoke 一次 `lxmn:scheme:ready`，
 * 这之前到达的链接攒在队列里，握手时补发。这些用例锁住四件事：
 *   1. 未握手时链接不丢，握手后补发（冷启动路径）；
 *   2. 已握手时立即投递（第二实例路径，不能因为队列变慢）；
 *   3. 页面重新加载后重新排队，不会发进已经没监听的新页面（发早了就丢），
 *      但 hash 跳转 / 子框架导航不算重新加载；
 *   4. 渲染层始终没起来时队列有上限，不会无限涨。
 */
import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'

const require = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const extras = require('../apps/desktop/electron/extras.cjs') as {
  install: (ctx: Record<string, unknown>) => {
    handleSchemeUrl: (raw: string) => void
    consumeArgv: (argv: string[]) => void
    flushScheme: () => void
  }
}

/** 一个足够像 webContents 的替身：能收 send、能发 did-start-navigation */
function fakeWebContents() {
  const sent: Array<{ channel: string; payload: unknown }> = []
  const em = new EventEmitter()
  const wc = Object.assign(em, {
    send: (channel: string, payload: unknown) => { sent.push({ channel, payload }) },
  })
  return { wc, sent }
}

function setup() {
  const { wc, sent } = fakeWebContents()
  const win = { isDestroyed: () => false, webContents: wc }
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const appEvents = new EventEmitter()
  const ctx = {
    app: Object.assign(appEvents, {
      getVersion: () => '0.0.0-test',
      setAsDefaultProtocolClient: () => true,
    }),
    ipcMain: { handle: (ch: string, fn: (...a: unknown[]) => unknown) => { handlers.set(ch, fn) } },
    session: { defaultSession: {} },
    path: { resolve: (s: string) => s },
    getWin: () => win,
    showMainWindow: () => {},
    sendToRenderer: () => {},
    logCrash: () => {},
  }
  const api = extras.install(ctx)
  /** 模拟渲染层挂好监听后的握手 */
  const handshake = () => handlers.get('lxmn:scheme:ready')!({ sender: wc })
  return { api, wc, sent, handshake, handlers }
}

describe('scheme 投递', () => {
  it('冷启动：握手前的链接先排队，握手后补发', () => {
    const { api, sent, handshake } = setup()
    api.handleSchemeUrl('lxmusic://songlist/import?id=3778678')
    expect(sent).toHaveLength(0) // 渲染层还没监听，发出去就是丢
    expect(handshake()).toBe(true)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toEqual({
      channel: 'lxmn:scheme',
      payload: { kind: 'songlist', id: '3778678' },
    })
  })

  it('冷启动带多条链接时按顺序全部补发', () => {
    const { api, sent, handshake } = setup()
    api.handleSchemeUrl('lxmusic://music/search?keyword=first')
    api.handleSchemeUrl('lxmusic://player/togglePlay')
    handshake()
    expect(sent.map(s => (s.payload as { kind: string }).kind)).toEqual(['search', 'player'])
  })

  it('握手之后立即投递（第二实例不能变慢）', () => {
    const { api, sent, handshake } = setup()
    handshake()
    api.handleSchemeUrl('lxmusic://songlist/import?id=3778678')
    expect(sent).toHaveLength(1)
    expect(sent[0].payload).toEqual({ kind: 'songlist', id: '3778678' })
  })

  it('页面重新加载后重新排队，等下一次握手再发', () => {
    const { api, wc, sent, handshake } = setup()
    handshake()
    wc.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
    api.handleSchemeUrl('lxmusic://songlist/import?id=3778678')
    expect(sent).toHaveLength(0)
    handshake()
    expect(sent).toHaveLength(1)
  })

  /**
   * 这条锁住真机上踩到的坑：一开始用 did-start-loading 重置 ready，但它在页面
   * 挂载完之后还会因子资源 / 媒体加载再触发一次，把刚握好的 ready 打回 false，
   * 之后所有链接都进队列再也不发（现象：干净启动后点链接没反应）。
   */
  it('hash 跳转（Vue Router push）不算重新加载，不能把 ready 打回 false', () => {
    const { api, wc, sent, handshake } = setup()
    handshake()
    wc.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true })
    api.handleSchemeUrl('lxmusic://songlist/import?id=3778678')
    expect(sent).toHaveLength(1)
  })

  it('子框架导航不算主页面重新加载，不能把 ready 打回 false', () => {
    const { api, wc, sent, handshake } = setup()
    handshake()
    wc.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false })
    api.handleSchemeUrl('lxmusic://songlist/import?id=3778678')
    expect(sent).toHaveLength(1)
  })

  it('别的主窗口（如桌面歌词）来握手不认领队列', () => {
    const { api, sent, handlers } = setup()
    api.handleSchemeUrl('lxmusic://songlist/import?id=3778678')
    const other = fakeWebContents().wc
    expect(handlers.get('lxmn:scheme:ready')!({ sender: other })).toBe(false)
    expect(sent).toHaveLength(0)
  })

  it('渲染层始终不起来时队列有上限，不会无限涨', () => {
    const { api, sent, handshake } = setup()
    for (let i = 0; i < 40; i++) api.handleSchemeUrl(`lxmusic://music/search?keyword=k${i}`)
    handshake()
    expect(sent.length).toBe(16)
    // 保留的是最近的 16 条
    expect((sent[sent.length - 1].payload as { keyword: string }).keyword).toBe('k39')
  })

  it('不是 lxmusic:// 的参数直接忽略', () => {
    const { api, sent, handshake } = setup()
    api.consumeArgv(['/usr/bin/app', '--no-sandbox', 'https://example.com/x'])
    handshake()
    expect(sent).toHaveLength(0)
  })

  it('consumeArgv 从命令行里认出链接（Windows 冷启动路径）', () => {
    const { api, sent, handshake } = setup()
    api.consumeArgv(['C:\\app.exe', '--no-sandbox', 'lxmusic://songlist/import?id=3778678'])
    handshake()
    expect(sent).toHaveLength(1)
    expect(sent[0].payload).toEqual({ kind: 'songlist', id: '3778678' })
  })
})
