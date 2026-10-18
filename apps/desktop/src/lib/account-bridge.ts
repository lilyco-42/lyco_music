/**
 * 账号 -> 会员身份的桥接
 *
 * 之前登录网站账号和「音乐会员」是两套完全独立的东西：
 * 用户买了年卡、也登录了，会员页还是让他去复制订阅链接手动粘贴。
 * 这不是设计取舍，是漏接 —— 服务端 /api/me 早就把 license_key 返回了，
 * 订阅文档地址就是 https://lain42.top/studio/api/music/sub/<license_key>。
 *
 * 所以这里做三件事：
 *   1. 登录后从 entitlements 里找出有效的 music_* 权益，自动激活订阅；
 *   2. 会员身份同时就是同步身份、好友身份（订阅令牌 = license_key）；
 *   3. 账号退出或权益消失时，把自动接上的东西一起撤掉，
 *      但**不碰**用户自己粘贴的订阅链接 —— 那是用户手动配的，不该被代管。
 */
import type { AccountEntitlement } from './auth'
import { subscription as client } from './subscription'

/** 服务端订阅文档的固定前缀，与 app.py 的 MUSIC_SUB_BASE 保持一致 */
const SUB_BASE = 'https://lain42.top/studio/api/music/sub/'

/** 记住哪些订阅是账号自动接上的，退出时只撤这些 */
const AUTO_KEY = 'lxmn.sub.auto'

export interface AutoBindResult {
  bound: boolean
  licenseKey: string
  product: string
}

function isLive(e: AccountEntitlement, now = Date.now()): boolean {
  if (e.status !== 'active') return false
  if (!e.expires_at) return true
  const t = Date.parse(e.expires_at)
  return Number.isFinite(t) && t > now
}

/** 从权益里挑出仍然有效、且到期最晚的那个音乐会员 */
export function pickMusicEntitlement(ents: AccountEntitlement[] | undefined): AccountEntitlement | null {
  const live = (ents ?? []).filter(e => e.product?.startsWith('music_') && isLive(e))
  if (!live.length) return null
  return live.sort((a, b) => {
    const ta = a.expires_at ? Date.parse(a.expires_at) : Number.POSITIVE_INFINITY
    const tb = b.expires_at ? Date.parse(b.expires_at) : Number.POSITIVE_INFINITY
    return tb - ta
  })[0]!
}

function readAuto(): string {
  try { return localStorage.getItem(AUTO_KEY) ?? '' } catch { return '' }
}

function writeAuto(key: string): void {
  try {
    if (key) localStorage.setItem(AUTO_KEY, key)
    else localStorage.removeItem(AUTO_KEY)
  } catch { /* 隐私模式下忽略 */ }
}

/**
 * 登录后调用：把账号的会员权益接到订阅上。
 *
 * 权益由调用方传入而不是自己读 —— auth 需要调用这里，
 * 这里若再 import auth 就成了循环依赖，ESM 下容易取到 undefined。
 *
 * 已经手动配过订阅的用户不会被覆盖 —— 除非当前订阅正是上一次自动接上的那个
 * （说明是账号自己接的，跟着账号走）。
 */
export async function syncMembershipFromAccount(
  entitlements: AccountEntitlement[] | undefined,
): Promise<AutoBindResult> {
  const ent = pickMusicEntitlement(entitlements)
  const auto = readAuto()

  if (!ent) {
    // 账号没有有效会员：只回收自己接上的那份
    if (auto) {
      const current = await client.token().catch(() => '')
      if (current === auto) await client.clear().catch(() => undefined)
      writeAuto('')
    }
    return { bound: false, licenseKey: '', product: '' }
  }

  const key = String(ent.license_key ?? '')
  if (!key) return { bound: false, licenseKey: '', product: ent.product }
  const current = await client.token().catch(() => '')
  // 用户手动配了别的订阅，尊重用户的选择
  if (current && current !== key && current !== auto) {
    return { bound: false, licenseKey: key, product: ent.product }
  }
  if (current === key) {
    writeAuto(key)
    return { bound: true, licenseKey: key, product: ent.product }
  }

  try {
    const doc = await client.fetch(SUB_BASE + key)
    await client.apply(doc)
    writeAuto(key)
    return { bound: true, licenseKey: key, product: ent.product }
  } catch {
    // 服务端暂时不可达：不阻断登录，下次启动会再试
    return { bound: false, licenseKey: key, product: ent.product }
  }
}

/** 退出登录时调用：只回收账号自动接上的订阅 */
export async function unbindMembershipFromAccount(): Promise<void> {
  const auto = readAuto()
  writeAuto('')
  if (!auto) return
  const current = await client.token().catch(() => '')
  if (current === auto) await client.clear().catch(() => undefined)
}

/** 订阅文档地址（给界面展示用） */
export function subscriptionUrl(licenseKey: string): string {
  return SUB_BASE + licenseKey
}
