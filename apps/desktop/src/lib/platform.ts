/**
 * 桌面端平台装配。
 *
 * 渲染进程没有 node:crypto / node:zlib（contextIsolation 且 nodeIntegration=false），
 * 所以这里用 @lxmn/core 的**纯 JS 平台**：
 *   - 加密：portableCrypto（MD5/SHA-1/AES/RSA 全手写，已与 node:crypto 逐字节比对通过）
 *   - 网络：优先走 preload 暴露的 lxmnNative.request（主进程 net.fetch，绕过 CORS），
 *           没有该桥时回落到标准 fetch
 *   - 存储：localStorage
 *
 * 结论：渲染进程不需要任何 Node 能力，同一份内核在 Electron 里直接跑。
 */
import {
  createPortablePlatform,
  createFetchHttp,
  createWebStorage,
  setPlatform,
  installKgSource,
  installKwSource,
  installMgSource,
  installWySource,
  hasSource,
  listSources,
  getSource,
  type HttpAdapter,
  type HttpRequestOptions,
  type HttpResponse,
  type SourceId,
  APP_VERSION,
} from '@lxmn/core'

/** preload 注入的原生桥 */
interface LxmnNative {
  request?: (options: {
    url: string
    method?: string
    headers?: Record<string, string>
    body?: string
    timeout?: number
  }) => Promise<{ statusCode: number; headers: Record<string, string>; body: string }>
}

function nativeBridge(): LxmnNative | undefined {
  return (globalThis as unknown as { lxmnNative?: LxmnNative }).lxmnNative
}

/** 优先主进程请求（无 CORS 限制），否则标准 fetch */
function createDesktopHttp(): HttpAdapter {
  const bridge = nativeBridge()
  const fallback = createFetchHttp()

  return {
    async request(o: HttpRequestOptions): Promise<HttpResponse> {
      if (bridge?.request) {
        const body = o.form
          ? Object.entries(o.form)
              .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
              .join('&')
          : typeof o.body === 'string'
            ? o.body
            : undefined
        const headers = { ...o.headers }
        if (o.form) headers['content-type'] = 'application/x-www-form-urlencoded'

        const res = await bridge.request({
          url: o.url,
          method: o.method ?? 'GET',
          headers,
          body,
          timeout: o.timeout,
        })
        const raw = new Uint8Array(0)
        return { statusCode: res.statusCode, headers: res.headers, body: res.body, raw }
      }
      return fallback.request(o)
    },
  }
}

let done = false

/** 内核里已经移植完成的音源 */
const BUILTIN: { id: SourceId; install: () => void }[] = [
  { id: 'wy', install: installWySource },
  { id: 'kw', install: installKwSource },
  { id: 'mg', install: installMgSource },
  { id: 'kg', install: installKgSource },
]

export function ensureDesktopPlatform(): void {
  if (done) return

  setPlatform(
    createPortablePlatform({
      name: 'web',
      http: createDesktopHttp(),
      storage: createWebStorage({ prefix: 'lxmn.' }),
      version: APP_VERSION,
    }),
  )

  for (const s of BUILTIN) {
    if (!hasSource(s.id)) s.install()
  }

  // 诊断入口：音源报错以前会被 player.search 静默吞掉，界面只表现为「某个源没结果」。
  // 挂一个只读句柄，方便在 DevTools 里直接 __lxmn.probe('kw','起风了') 看真实错误。
  ;(globalThis as unknown as { __lxmn?: unknown }).__lxmn = {
    sources: () => listSources(),
    probe: async (id: SourceId, keyword: string) => {
      try {
        const src = getSource(id)
        const r = await src.musicSearch?.(keyword, 1, 3)
        return { ok: true, count: r?.list.length ?? 0, first: r?.list[0]?.name ?? null }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    },
  }

  done = true
}

export { BUILTIN }
