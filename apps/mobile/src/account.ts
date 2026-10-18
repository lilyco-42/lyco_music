/**
 * lain42.top 账号授权（OAuth 2.0 设备码流程，RFC 8628）。
 *
 * 为什么移动端不用桌面端那套授权码 + loopback：
 * 手机上起一个 127.0.0.1 回调服务在 iOS/Android 上不可靠，
 * 自定义 scheme（lycomusic://）又需要改 Info.plist / AndroidManifest，
 * 而且协议处理器谁先注册谁生效，可能被别的 App 抢注后截获授权码。
 *
 * 设备码把「确认」这一步放回浏览器：App 只负责显示 8 位码并轮询，
 * 用户在任意一台已登录 lain42.top 的设备上点一下确认即可。
 * App 全程接触不到密码。
 */
import AsyncStorage from '@react-native-async-storage/async-storage'

const API = 'https://lain42.top/studio/api'
const CLIENT_ID = 'lyco-music-mobile'
const SCOPE = 'profile entitlements offline_access'

const STORAGE_KEY = 'lyco.oauth.session'

export interface AccountEntitlement {
  product: string
  status: string
  expires_at?: string | null
}

export interface AccountProfile {
  username: string
  account_id: number
  founder: boolean
  entitlements: AccountEntitlement[]
}

export interface DeviceCode {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete: string
  expires_in: number
  interval: number
}

interface Session {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

/** 正在进行的设备码授权；取消时置 true 让轮询退出 */
let cancelled = false

async function postForm(path: string, data: Record<string, string>): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(data).toString(),
  })
  let body: Record<string, unknown> = {}
  try { body = (await res.json()) as Record<string, unknown> } catch { /* 非 JSON 响应按失败处理 */ }
  return { status: res.status, body }
}

async function readSession(): Promise<Session | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Session
    return typeof parsed?.accessToken === 'string' ? parsed : null
  } catch { return null }
}

async function writeSession(session: Session | null): Promise<void> {
  if (!session) { await AsyncStorage.removeItem(STORAGE_KEY); return }
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(session))
}

/** 用 refresh token 换新的 access token（服务端会轮换 refresh） */
async function refreshSession(session: Session): Promise<Session | null> {
  if (!session.refreshToken) return null
  const { status, body } = await postForm('/oauth/token', {
    grant_type: 'refresh_token',
    refresh_token: session.refreshToken,
    client_id: CLIENT_ID,
  })
  if (status !== 200 || typeof body.access_token !== 'string') return null
  const next: Session = {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : session.refreshToken,
    expiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000,
  }
  await writeSession(next)
  return next
}

/** 取一个当前可用的 access token，过期就先刷新 */
export async function accessToken(): Promise<string | null> {
  let session = await readSession()
  if (!session) return null
  if (session.expiresAt && session.expiresAt - 60_000 < Date.now()) {
    session = await refreshSession(session)
    if (!session) { await writeSession(null); return null }
  }
  return session.accessToken
}

export async function profile(): Promise<AccountProfile | null> {
  const token = await accessToken()
  if (!token) return null
  const res = await fetch(API + '/oauth/userinfo', {
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
  })
  if (!res.ok) return null
  const body = (await res.json()) as Record<string, unknown>
  return {
    username: String(body.preferred_username ?? ''),
    account_id: Number(body.account_id ?? 0),
    founder: !!body.founder,
    entitlements: Array.isArray(body.entitlements) ? (body.entitlements as AccountEntitlement[]) : [],
  }
}

/** 第一步：向服务端申请一组设备码 */
export async function requestDeviceCode(): Promise<DeviceCode> {
  const { status, body } = await postForm('/oauth/device_authorization', {
    client_id: CLIENT_ID,
    scope: SCOPE,
  })
  if (status !== 200 || typeof body.device_code !== 'string') {
    throw new Error('无法获取设备码，请检查网络后重试')
  }
  return body as unknown as DeviceCode
}

/**
 * 第二步：按服务端给的 interval 轮询，直到用户确认、拒绝或超时。
 * onPending 用来刷新界面上的倒计时/提示。
 */
export async function pollDeviceToken(
  device: DeviceCode,
  onPending?: (secondsLeft: number) => void,
): Promise<AccountProfile> {
  cancelled = false
  const deadline = Date.now() + (device.expires_in || 600) * 1000
  let interval = (device.interval || 5) * 1000

  while (Date.now() < deadline) {
    if (cancelled) throw new Error('已取消授权')
    await new Promise<void>((r) => setTimeout(r, interval))
    if (cancelled) throw new Error('已取消授权')

    const { status, body } = await postForm('/oauth/token', {
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: device.device_code,
      client_id: CLIENT_ID,
    })

    if (status === 200 && typeof body.access_token === 'string') {
      const session: Session = {
        accessToken: body.access_token,
        refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : '',
        expiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000,
      }
      await writeSession(session)
      const me = await profile()
      if (!me) throw new Error('授权成功但读取账号信息失败')
      return me
    }

    const error = String(body.error ?? '')
    if (error === 'authorization_pending') {
      onPending?.(Math.max(0, Math.round((deadline - Date.now()) / 1000)))
      continue
    }
    // 服务端要求放慢：按 RFC 8628 每次多等 5 秒
    if (error === 'slow_down') { interval += 5000; continue }
    if (error === 'access_denied') throw new Error('授权已被拒绝')
    if (error === 'expired_token') throw new Error('设备码已过期，请重新获取')
    throw new Error('授权失败，请重试')
  }
  throw new Error('授权超时，请重新获取设备码')
}

export function cancelPolling(): void {
  cancelled = true
}

/** 退出登录：先撤销令牌，再清本地（撤销失败也照清，本地不留凭证） */
export async function signOut(): Promise<void> {
  cancelled = true
  const session = await readSession()
  await writeSession(null)
  if (session?.refreshToken) {
    try {
      await postForm('/oauth/revoke', { token: session.refreshToken })
    } catch { /* 离线时忽略 */ }
  }
}

export const VERIFICATION_URI = 'https://lain42.top/studio/api/oauth/device'
