/**
 * 极简 HTTP(S) URL 解析 —— 不用全局 `URL`。
 *
 * 为什么不用 `URL`：React Native 的 Hermes 里 `URL` 是
 * `whatwg-url-without-unicode` 的 polyfill，**没有实现 protocol / hostname
 * 这些 getter**，一访问就抛 `URL.protocol is not implemented`。
 *
 * 后果不是「这一个函数失败」而是连锁的：`SyncClient` 构造函数里调它，
 * `Library` 构造函数里 new `SyncClient`，而 `Library` 是在模块顶层
 * `new Library()` 的 —— 于是整个 sync 模块加载失败，任何
 * `import { library } from '../sync'` 拿到的都是 undefined，
 * 界面报 `Cannot read property 'library' of undefined`。
 * 在 Android 上表现为「首页空、点其他页直接出错」。
 *
 * 所以这里只解析我们自己会遇到的形状：http(s) + host[:port] + path。
 * 不处理 userinfo / IPv6 字面量 —— 同步服务器和订阅链接都用不到。
 */

export interface ParsedHttpUrl {
  /** 'http:' 或 'https:'（带冒号，与 `URL#protocol` 一致） */
  protocol: string
  /** 小写主机名，不含端口 */
  hostname: string
  /** 端口字符串，没写时为空串 */
  port: string
  /** protocol + '//' + host[:port] */
  origin: string
  /** 以 / 开头的路径，可能为空串 */
  pathname: string
  /** 去掉 hash 的完整地址 */
  href: string
}

const URL_RE = /^(https?):\/\/([^/?#]+)(\/[^?#]*)?(\?[^#]*)?/i

/** 解析失败返回 null（调用方决定是回退还是报错），不抛异常 */
export function parseHttpUrl(input: string): ParsedHttpUrl | null {
  const m = URL_RE.exec(String(input ?? '').trim())
  if (!m) return null

  const protocol = m[1]!.toLowerCase() + ':'
  const hostPart = m[2]!
  // 端口只在最后一段是纯数字时才算端口（避免把 IPv6 里的冒号当端口）
  const portMatch = /:(\d+)$/.exec(hostPart)
  const port = portMatch ? portMatch[1]! : ''
  const hostname = (portMatch ? hostPart.slice(0, portMatch.index) : hostPart).toLowerCase()
  // 主机名只接受域名 / IPv4 字面量。不校验的话 `::::` 这类输入会被当成
  // 「合法的空主机」，拼出一个永远连不上的地址，报错信息还看不出原因。
  if (!hostname || !/^[a-z0-9.-]+$/.test(hostname)) return null

  const pathname = m[3] ?? ''
  const search = m[4] ?? ''
  const origin = protocol + '//' + hostPart

  return { protocol, hostname, port, origin, pathname, href: origin + pathname + search }
}

/** 补上 https:// 再解析：允许用户只填域名 */
export function parseLooseHttpUrl(input: string): ParsedHttpUrl | null {
  const raw = String(input ?? '').trim()
  if (!raw) return null
  return parseHttpUrl(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw)
}
