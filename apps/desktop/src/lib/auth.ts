/**
 * lain42.top 账号会话（OAuth 2.0 授权码 + PKCE）。
 *
 * 之前这里是让用户把网站密码填进 App，再由渲染层 POST /login 换 JWT。
 * 现在改成 OAuth：密码只在 lain42.top 的页面里输入一次，App 只保存
 * 一张有期限、可撤销的令牌。撤销后服务端立即拒绝，不必等过期。
 *
 * 令牌的存放也收归主进程：safeStorage 用操作系统密钥库加密，
 * 渲染层拿到的是内存里的副本，落盘的文件只有主进程能解。
 */
import { computed, ref } from 'vue'
import { syncMembershipFromAccount, unbindMembershipFromAccount } from './account-bridge'

const API = 'https://lain42.top/studio/api'
const CLIENT_ID = 'lyco-music-desktop'

export interface AccountEntitlement {
  product: string
  status: string
  expires_at?: string | null
  /** 会员权益的 license_key 就是订阅令牌 —— 账号登录后靠它自动接上音源 */
  license_key?: string
  granted_at?: string | null
  meta?: Record<string, unknown>
}
export interface AccountProfile {
  username: string
  account_id: number
  founder: boolean
  /** 头像 URL（相对站点路径），没有头像时为空串 */
  avatar: string
  entitlements: AccountEntitlement[]
}
interface OAuthSession {
  accessToken: string
  refreshToken: string
  expiresAt: number
}
interface NativeBridge {
  oauth?: {
    login: () => Promise<{ accessToken: string; refreshToken: string; expiresAt: number }>
    save: (session: OAuthSession) => Promise<boolean>
    load: () => Promise<OAuthSession | null>
    clear: () => Promise<boolean>
  }
  request?: (options: {
    url: string
    method?: string
    headers?: Record<string, string>
    body?: string
  }) => Promise<{ statusCode: number; body: string }>
  openExternal?: (url: string) => Promise<boolean>
}

function native(): NativeBridge | undefined {
  return (globalThis as unknown as { lxmnNative?: NativeBridge }).lxmnNative
}

let session: OAuthSession | null = null
let initialized = false
const profile = ref<AccountProfile | null>(null)
const busy = ref(false)
const error = ref('')
const rememberOnDevice = ref(false)

/** 表单编码的 POST —— OAuth 令牌端点的标准形态 */
async function form<T>(path: string, data: Record<string, string>): Promise<T> {
  const url = API + path
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }
  const body = new URLSearchParams(data).toString()
  let code: number
  let text: string
  if (native()?.request) {
    const result = await native()!.request!({ url, method: 'POST', headers, body })
    code = result.statusCode
    text = result.body
  } else {
    const response = await fetch(url, { method: 'POST', headers, body })
    code = response.status
    text = await response.text()
  }
  let parsed: Record<string, unknown>
  try { parsed = JSON.parse(text) as Record<string, unknown> }
  catch { throw new Error('账户服务响应异常（HTTP ' + code + '）') }
  if (code < 200 || code >= 300) {
    throw new Error(typeof parsed.error === 'string' ? parsed.error : '账户请求失败（HTTP ' + code + '）')
  }
  return parsed as T
}

async function json<T>(path: string, token: string): Promise<T> {
  const url = API + path
  const headers = { Authorization: 'Bearer ' + token, Accept: 'application/json' }
  let code: number
  let text: string
  if (native()?.request) {
    const result = await native()!.request!({ url, method: 'GET', headers })
    code = result.statusCode
    text = result.body
  } else {
    const response = await fetch(url, { headers })
    code = response.status
    text = await response.text()
  }
  let parsed: Record<string, unknown>
  try { parsed = JSON.parse(text) as Record<string, unknown> }
  catch { throw new Error('账户服务响应异常（HTTP ' + code + '）') }
  if (code < 200 || code >= 300) {
    throw new Error(typeof parsed.error === 'string' ? parsed.error : '账户请求失败（HTTP ' + code + '）')
  }
  return parsed as T
}

/** 用 refresh token 换新的 access token（服务端会轮换 refresh） */
async function refresh(): Promise<boolean> {
  if (!session?.refreshToken) return false
  try {
    const data = await form<{ access_token: string; refresh_token: string; expires_in: number }>(
      '/oauth/token',
      { grant_type: 'refresh_token', refresh_token: session.refreshToken, client_id: CLIENT_ID },
    )
    session = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || session.refreshToken,
      expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
    }
    await persist()
    return true
  } catch {
    return false
  }
}

async function persist(): Promise<void> {
  if (!session) { await native()?.oauth?.clear(); rememberOnDevice.value = false; return }
  try {
    rememberOnDevice.value = (await native()?.oauth?.save(session)) === true
  } catch {
    // 系统密钥库可能被锁；此时只保留内存里的会话，不落盘明文
    rememberOnDevice.value = false
  }
}

/** 拿一个当前可用的 access token，过期就先刷新 */
async function token(): Promise<string> {
  if (!session) throw new Error('尚未登录')
  if (session.expiresAt && session.expiresAt - 60_000 < Date.now()) {
    if (!(await refresh())) throw new Error('登录已过期，请重新授权')
  }
  return session.accessToken
}

/**
 * 把服务端返回的头像地址补成绝对地址。
 *
 * 服务端存的是 /studio/api/avatar/<uid>?v=... 这样的相对路径 ——
 * 在浏览器里没问题，但在 Electron 里 <img src> 的相对路径会按页面
 * 的 file:// 位置解析，变成 file:///D:/studio/api/avatar/... 从而 404。
 * 结果就是登录了却看不到头像，而且不报错，非常难查。
 */
function absoluteUrl(path: string | null | undefined): string {
  const v = String(path ?? '').trim()
  if (!v) return ''
  if (/^https?:\/\//i.test(v)) return v
  if (v.startsWith('//')) return 'https:' + v
  // 服务端给的是 /studio/api/avatar/... —— 带 /studio 前缀的完整路径，
  // 所以这里只取站点根（协议 + 域名），不要自作聪明去减 /api。
  const origin = API.replace(/^(https?:\/\/[^/]+).*$/, '$1')
  return origin + (v.startsWith('/') ? v : '/' + v)
}

async function loadProfile(): Promise<void> {
  // /oauth/userinfo 用的是 OIDC 的标准字段名（preferred_username / picture），
  // 不是站内 /api/me 的 username —— 读错字段会得到一个空用户名。
  const me = await json<{
    preferred_username: string
    account_id: number
    founder: boolean
    entitlements: AccountEntitlement[]
    picture?: string | null
  }>('/oauth/userinfo', await token())
  profile.value = {
    username: me.preferred_username ?? '',
    account_id: me.account_id,
    founder: !!me.founder,
    avatar: absoluteUrl(me.picture),
    entitlements: me.entitlements ?? [],
  }
}

/**
 * 登录成功后的连锁动作。
 *
 * 账号和会员原本是两套身份，用户买了年卡还得手动复制订阅链接。
 * 这里把两者接起来：账号里有有效会员权益，就自动激活订阅、同步和好友。
 * 失败不阻断登录 —— 网络抖动不该让人重新授权一遍。
 */
async function afterSignIn(): Promise<void> {
  try {
    await syncMembershipFromAccount(profile.value?.entitlements)
  } catch { /* 登录本身已经成功，会员接通失败留给下次启动重试 */ }
}

async function restore(): Promise<void> {
  if (initialized) return
  initialized = true
  try {
    const stored = await native()?.oauth?.load()
    if (!stored?.accessToken) return
    session = stored
    rememberOnDevice.value = true
    await loadProfile()
    await afterSignIn()
  } catch (e) {
    // 网络故障不该删掉加密凭证；令牌失效只是表现为未登录，重新授权即可
    error.value = e instanceof Error ? e.message : '无法连接账户服务器'
    profile.value = null
  }
}

/** 打开系统浏览器完成授权，回来时主进程已经换好了令牌 */
async function signIn(): Promise<boolean> {
  const bridge = native()?.oauth
  if (!bridge) {
    error.value = '当前环境不支持网站授权，请在桌面客户端内使用'
    return false
  }
  busy.value = true
  error.value = ''
  try {
    const result = await bridge.login()
    if (!result?.accessToken) throw new Error('授权未完成')
    session = {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken || '',
      expiresAt: result.expiresAt || 0,
    }
    // 拿到令牌后必须先用它读一次用户信息，确认这张令牌真的可用
    await loadProfile()
    await persist()
    await afterSignIn()
    return true
  } catch (e) {
    error.value = e instanceof Error ? e.message : '授权失败'
    session = null
    profile.value = null
    return false
  } finally { busy.value = false }
}

async function signOut(): Promise<void> {
  // 先把账号自动接上的会员订阅撤掉，再清令牌 ——
  // 否则订阅令牌会留在本地，账号退出后会员还在生效。
  await unbindMembershipFromAccount()
  const current = session
  session = null
  profile.value = null
  rememberOnDevice.value = false
  error.value = ''
  await native()?.oauth?.clear()
  // 尽力撤销：即使失败，本地也已经不再持有凭证
  if (current?.refreshToken) {
    try {
      await form('/oauth/revoke', { token: current.refreshToken })
    } catch { /* 离线时忽略 */ }
  }
}

function openRegistration(): void {
  const url = 'https://lain42.top/account/'
  if (native()?.openExternal) void native()!.openExternal!(url)
  else window.open(url, '_blank', 'noopener,noreferrer')
}

const signedIn = computed(() => !!profile.value && !!session)
const vip = computed(() => profile.value?.entitlements?.some(e =>
  e.product === 'music_annual' && e.status === 'active' &&
  (!e.expires_at || (Number.isFinite(Date.parse(e.expires_at)) && Date.parse(e.expires_at) > Date.now()))
) ?? false)

export function useAccount() {
  return { profile, busy, error, signedIn, vip, rememberOnDevice, restore, signIn, signOut, openRegistration, token }
}
