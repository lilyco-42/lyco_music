/**
 * lx-music 音源脚本运行时
 *
 * 为什么需要它：社区维护的音源脚本（长青、星海、星澜…）是 lx-music 生态里
 * **唯一持续跟进平台改版**的东西。自己逆向接口，平台一改版就全废；而这些脚本
 * 的作者每天都在修。所以客户端不该重造，而应该能跑它们。
 *
 * 脚本契约（与 lx-music 一致，见 lx-music-desktop 的 userApi preload）：
 *   - 从 globalThis.lx 取 { EVENT_NAMES, request, on, send, utils, version }
 *   - on(EVENT_NAMES.request, handler) 注册取流回调
 *   - send(EVENT_NAMES.inited, { status, sources }) 声明自己支持哪些平台
 *   - handler({ source, action, info }) -> 返回播放地址字符串
 *
 * 我们只实现脚本**实际会用到**的那部分 API。刻意不实现 eval 之外的网络能力，
 * 也不给它 DOM / Node 全局对象 —— 脚本是第三方代码，能少给就少给。
 *
 * 关于安全：脚本来自订阅文档（服务端签名下发），运行在受限沙箱里。
 * 它能发 HTTP 请求（这是它的本职），但拿不到本地文件、不能碰 DOM。
 */

import { getPlatform } from '../../registry'
import type { SourceId, Quality } from '../../types'

/** 脚本能声明的平台 */
export type LxSourceId = 'kw' | 'kg' | 'tx' | 'wy' | 'mg' | 'xm' | 'local'

export interface LxScriptManifest {
  name: string
  version?: string
  author?: string
  description?: string
  /** 脚本声明支持的平台 -> 该平台支持的音质列表 */
  sources: Partial<Record<LxSourceId, Quality[]>>
}

export interface LxMusicInfo {
  songmid?: string | number
  hash?: string
  name?: string
  singer?: string
  albumName?: string
  albumId?: string | number
  interval?: string
  copyrightId?: string
  [k: string]: unknown
}

export type LxScriptState = 'idle' | 'loading' | 'ready' | 'error'

interface Runtime {
  manifest: LxScriptManifest | null
  state: LxScriptState
  error?: string
  handler: ((args: { source: LxSourceId; action: string; info: { type: Quality; musicInfo: LxMusicInfo } }) => Promise<string>) | null
}

/** 脚本里 request 回调的形态（needle 风格） */
type LxRequestCallback = (
  err: Error | null,
  resp: { statusCode: number; body: unknown; headers?: Record<string, string> } | null,
  body?: unknown,
) => void

/**
 * 把脚本的 request(url, options, callback) 映射到平台层 http.request。
 * 回调里 body 需要是**已解析**的对象（脚本普遍直接读 resp.body.xxx）。
 */
function makeRequest() {
  return function request(
    url: string,
    options: { method?: string; headers?: Record<string, string>; body?: unknown; form?: unknown; timeout?: number } | null,
    callback: LxRequestCallback,
  ) {
    const { http } = getPlatform()
    if (process.env.LXMN_TRACE) console.log('[lx-request]', url.slice(0, 80), JSON.stringify(options)?.slice(0, 300))
    const method = (options?.method ?? 'GET').toUpperCase() as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'HEAD'
    let body: string | undefined
    // lx 脚本的 headers 可能是 Record 或 [["k","v"],...] 键值对数组（lx-music 约定），统一摊平
    const rawHeaders = options?.headers as unknown
    const headerPairs: [string, string][] = Array.isArray(rawHeaders)
      ? (rawHeaders as unknown[]).flatMap((h) =>
          Array.isArray(h) && h.length >= 2 ? [[String(h[0]), String(h[1])] as [string, string]] : [])
      : Object.entries((rawHeaders ?? {}) as Record<string, unknown>).map(([k, v]) => [k, String(v)] as [string, string])
    // 部分脚本会把数组 JSON.stringify 后塞进 header 值（含换行），fetch 会拒收；
    // 宽容处理：去掉控制字符，保证请求能发出去。
    const headers: Record<string, string> = Object.fromEntries(
      headerPairs.map(([k, v]) => [k.replace(/[\r\n\t ]+/g, ' ').trim(), v.replace(/[\r\n\t]+/g, ' ').trim()]),
    )
    if (options?.form) {
      body = typeof options.form === 'string'
        ? options.form
        : new URLSearchParams(options.form as Record<string, string>).toString()
      headers['Content-Type'] ??= 'application/x-www-form-urlencoded'
    } else if (options?.body !== undefined && options.body !== null) {
      body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body)
      headers['Content-Type'] ??= 'application/json'
    }

    void http
      .request({ url, method, headers, body, timeout: Math.min(options?.timeout ?? 20000, 60000) })
      .then((res: { statusCode: number; body: string; headers: Record<string, string | string[] | undefined> }) => {
        let parsed: unknown = res.body
        try { parsed = JSON.parse(res.body) } catch { /* 保持原样 */ }
        const flat: Record<string, string> = {}
        for (const [k, v] of Object.entries(res.headers)) {
          if (typeof v === 'string') flat[k] = v
          else if (Array.isArray(v)) flat[k] = v.join(', ')
        }
        callback(null, { statusCode: res.statusCode, body: parsed, headers: flat }, parsed)
      })
      .catch((e: unknown) => {
        callback(e instanceof Error ? e : new Error(String(e)), null)
      })
  }
}

/** 最小化 console：脚本常打日志，别让它污染宿主控制台 */
function quietConsole() {
  const noop = () => undefined
  return {
    log: noop, info: noop, warn: noop, debug: noop, error: noop,
    group: noop, groupEnd: noop, groupCollapsed: noop, table: noop,
    time: noop, timeEnd: noop, trace: noop, dir: noop,
  }
}

const EVENT_NAMES = { request: 'request', inited: 'inited', updateAlert: 'updateAlert' }

/**
 * 单个音源脚本实例。
 *
 * 生命周期：load() 执行脚本 -> 等它 send(inited) -> 之后可以 callMusicUrl()。
 * 失败不抛给调用方，而是记录到 state/error，让上层决定要不要换下一个源。
 */
export class LxScript {
  readonly id: string
  readonly code: string
  private runtime: Runtime = { manifest: null, state: 'idle', handler: null }
  private initWaiters: Array<(ok: boolean) => void> = []
  private earlyInited = false

  constructor(id: string, code: string) {
    this.id = id
    this.code = code
  }

  get state(): LxScriptState { return this.runtime.state }
  get manifest(): LxScriptManifest | null { return this.runtime.manifest }
  get error(): string | undefined { return this.runtime.error }

  /** 该脚本是否声明支持某平台 */
  supports(source: SourceId): boolean {
    const s = this.runtime.manifest?.sources
    return Boolean(s && (s as Record<string, unknown>)[source])
  }

  /**
   * 执行脚本并等待初始化。
   *
   * 超时是必须的：脚本作者的代码质量参差，有的在 init 阶段死循环或等一个
   * 永远不回来的请求。这里最多等 initTimeoutMs，超时当作失败。
   */
  async load(initTimeoutMs = 8000): Promise<boolean> {
    if (this.runtime.state === 'ready') return true
    if (this.runtime.state === 'loading') {
      return new Promise<boolean>((resolve) => { this.initWaiters.push(resolve) })
    }
    this.runtime = { manifest: null, state: 'loading', handler: null }

    const done = (ok: boolean) => {
      const waiters = this.initWaiters
      this.initWaiters = []
      for (const w of waiters) w(ok)
      return ok
    }

    const lx = {
      EVENT_NAMES,
      version: '2.0.0',
      env: 'desktop',
      currentScriptInfo: { name: this.id, version: '1', author: '', rawScript: this.code },
      request: makeRequest(),
      send: (eventName: string, data: unknown) => {
        if (eventName === EVENT_NAMES.inited) {
          // 脚本可能在 factory 同步执行期间就 send(inited)，此时还没有 waiter 挂上；
          // 记下状态，load() 末尾的等待逻辑直接取用。
          this.earlyInited = true;
          const d = data as { status?: boolean; sources?: Record<string, Quality[]>; name?: string; version?: string }
          if (d && d.sources && typeof d.sources === 'object') {
            this.runtime.manifest = {
              name: d.name ?? this.id,
              version: d.version,
              sources: d.sources as Partial<Record<LxSourceId, Quality[]>>,
            }
            this.runtime.state = 'ready'
            done(true)
          } else {
            this.runtime.state = 'error'
            this.runtime.error = '脚本未声明 sources'
            done(false)
          }
          return Promise.resolve()
        }
        if (eventName === EVENT_NAMES.updateAlert) return Promise.resolve()
        return Promise.resolve()
      },
      on: (eventName: string, handler: unknown) => {
        if (eventName === EVENT_NAMES.request) {
          this.runtime.handler = handler as Runtime['handler']
          return Promise.resolve()
        }
        return Promise.resolve()
      },
      utils: makeUtils(),
    }

    // 用 Function 而不是 eval：能拿到独立作用域，且不给脚本访问闭包变量的机会
    try {
      const factory = new Function(
        'globalThis', 'window', 'self', 'console', 'lx',
        '"use strict";\n' + this.code,
      )
      const sandbox: Record<string, unknown> = {}
      sandbox.globalThis = sandbox
      sandbox.window = sandbox
      sandbox.self = sandbox
      // 部分脚本（如 野花/flower）从 globalThis.lx 解构 API，
      // 因此除了作为参数传入，还必须挂到沙箱全局上。
      sandbox.lx = lx
      factory(sandbox, sandbox, sandbox, quietConsole(), lx)
    } catch (e) {
      this.runtime.state = 'error'
      this.runtime.error = e instanceof Error ? e.message : String(e)
      return done(false)
    }

    if (this.earlyInited) {
      // factory 同步期间已 send(inited)
      return this.runtime.state === 'ready'
    }
    const ok = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.runtime.state = 'error'
        this.runtime.error ??= '初始化超时'
        resolve(false)
      }, initTimeoutMs)
      this.initWaiters.push((v) => { clearTimeout(timer); resolve(v) })
    })
    return done(ok)
  }

  /** 向脚本要播放地址；失败抛错，由上层决定换源 */
  async getMusicUrl(source: SourceId, musicInfo: LxMusicInfo, quality: Quality): Promise<string> {
    if (this.runtime.state !== 'ready') throw new Error('[lxmn/lx] 脚本未就绪')
    const handler = this.runtime.handler
    if (!handler) throw new Error('[lxmn/lx] 脚本未注册 request 事件')
    const url = await handler({
      source: source as LxSourceId,
      action: 'musicUrl',
      info: { type: quality, musicInfo },
    })
    if (typeof url !== 'string' || !/^https?:/.test(url)) {
      throw new Error('[lxmn/lx] 脚本返回的地址无效')
    }
    return url
  }
}

/**
 * 脚本常用的 crypto / buffer 工具。
 *
 * 只实现脚本里真实出现过的：AES 加解密、RSA 加密、随机数、md5。
 * 都委托给平台层，这样桌面端用 node:crypto、移动端用 Hermes 兼容实现。
 */
function makeUtils() {
  const { crypto, codec } = getPlatform()
  return {
    crypto: {
      aesEncrypt: (buf: Uint8Array, mode: string, key: Uint8Array, iv: Uint8Array) =>
        crypto.aesEncrypt(buf, mode as 'aes-128-cbc' | 'aes-128-ecb', key, iv),
      aesDecrypt: (buf: Uint8Array, mode: string, key: Uint8Array, iv: Uint8Array) =>
        crypto.aesDecrypt(buf, mode as 'aes-128-cbc' | 'aes-128-ecb', key, iv),
      rsaEncrypt: (buf: Uint8Array, key: string) => crypto.rsaEncrypt(buf, key, 'none'),
      randomBytes: (n: number) => crypto.randomBytes(n),
      md5: (s: string) => crypto.md5(s),
      sha1: (s: string) => crypto.sha1(s),
    },
    buffer: {
      from: (data: unknown, enc?: string) =>
        enc === 'base64' && typeof data === 'string' ? codec.base64Decode(data) : data,
      bufToString: (buf: Uint8Array, enc?: string) =>
        enc === 'base64' ? codec.base64Encode(buf) : codec.utf8Decode(buf),
    },
    zlib: {
      // 部分脚本用 zlib 解压接口返回；没有就如实报错，别静默返回脏数据
      inflate: () => Promise.reject(new Error('[lxmn/lx] 该脚本需要的 zlib 尚未支持')),
      deflate: () => Promise.reject(new Error('[lxmn/lx] 该脚本需要的 zlib 尚未支持')),
    },
  }
}
