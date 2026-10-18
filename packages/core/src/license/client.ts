/**
 * 订阅客户端：把「一条链接」变成「可用的音源集合」
 *
 * 对应 lx-music 原版的「导入自定义源」，但做成了订阅制：
 *   1. 用户在商城购买会员 → 得到 https://lain42.top/studio/api/music/sub/<token>
 *   2. 客户端填入该链接
 *   3. 拉取订阅文档 → 校验 → 注册音源
 *   4. 到期自动失效
 */
import { getPlatform } from '../registry'
import type { SourceId, Quality } from '../types'
import { registerSource, setSupportQuality, hasSource } from '../sources/registry'
import type {
  MembershipPlan,
  MembershipStatus,
  SubscribedSource,
  SubscriptionClientOptions,
  SubscriptionDocument,
} from './types'

/**
 * 服务端根地址。
 *
 * 必须带 /studio 前缀：pingap 只把 https://lain42.top/studio/api/* 反代到
 * billing 服务；裸域名的 /api/* 会命中前端 SPA 并返回 HTML。
 */
const DEFAULT_BASE = 'https://lain42.top/studio'
const DEFAULT_KEY = 'lxmn.subscription'

interface CacheEntry {
  url: string
  fetchedAt: number
  doc: SubscriptionDocument
}

function normalizeUrl(input: string, baseUrl: string): string {
  const raw = input.trim()
  if (!raw) throw new Error('[lxmn/license] 订阅链接为空')
  // 允许用户只粘贴 token
  if (/^[A-Za-z0-9_-]{8,}$/.test(raw)) {
    return `${baseUrl.replace(/\/$/, '')}/api/music/sub/${raw}`
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('[lxmn/license] 订阅链接格式不正确')
  }
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
    throw new Error('[lxmn/license] 订阅链接必须使用 https')
  }
  return url.toString()
}

/** 解析服务端返回的订阅文档 */
export function parseSubscriptionDocument(input: unknown): SubscriptionDocument {
  if (!input || typeof input !== 'object') {
    throw new Error('[lxmn/license] 订阅内容不是合法的 JSON 对象')
  }
  const d = input as Record<string, unknown>
  if (d.ok !== true) {
    throw new Error(`[lxmn/license] 订阅无效：${String(d.error ?? d.message ?? '服务端拒绝了该链接')}`)
  }
  const plan = d.plan as Record<string, unknown> | undefined
  if (!plan || typeof plan !== 'object') {
    throw new Error('[lxmn/license] 订阅缺少会员信息')
  }
  const expiresAt = String(plan.expires_at ?? plan.expiresAt ?? '')
  if (!expiresAt) throw new Error('[lxmn/license] 订阅缺少到期时间')

  const rawSources = Array.isArray(d.sources) ? d.sources : []
  const sources: SubscribedSource[] = rawSources
    .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === 'object')
    .map((s) => ({
      id: String(s.id ?? '') as SourceId,
      name: String(s.name ?? s.id ?? ''),
      type: (s.type === 'manifest' || s.type === 'script' ? s.type : 'builtin') as SubscribedSource['type'],
      url: s.url ? String(s.url) : undefined,
      sha256: s.sha256 ? String(s.sha256) : undefined,
      version: s.version ? String(s.version) : undefined,
      qualitys: Array.isArray(s.qualitys) ? s.qualitys.map(String) : undefined,
      implemented: typeof s.implemented === 'boolean' ? s.implemented : undefined,
      order: Number.isFinite(Number(s.order)) ? Number(s.order) : undefined,
      enabled: typeof s.enabled === 'boolean' ? s.enabled : undefined,
      note: s.note ? String(s.note) : undefined,
    }))
    .filter(s => s.id)

  return {
    ok: true,
    schema: Number(d.schema ?? 1),
    plan: {
      id: String(plan.id ?? 'music_annual'),
      name: String(plan.name ?? '音乐会员'),
      expiresAt,
      active: plan.active !== false,
    },
    sources,
    signature: d.signature ? String(d.signature) : undefined,
    issuedAt: d.issued_at ? String(d.issued_at) : undefined,
  }
}

export function isPlanActive(plan: MembershipPlan, now = Date.now()): boolean {
  if (plan.active === false) return false
  const t = Date.parse(plan.expiresAt)
  return Number.isFinite(t) && t > now
}

export class SubscriptionClient {
  private readonly baseUrl: string
  private readonly storageKey: string
  private readonly allowRemoteScripts: boolean
  private cache: CacheEntry | null = null

  constructor(options: SubscriptionClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE).replace(/\/$/, '')
    this.storageKey = options.storageKey ?? DEFAULT_KEY
    this.allowRemoteScripts = options.allowRemoteScripts ?? false
  }

  /** 拉取并解析订阅；结果写入本地缓存 */
  async fetch(link: string): Promise<SubscriptionDocument> {
    const url = normalizeUrl(link, this.baseUrl)
    const { http } = getPlatform()

    const res = await http.request({ url, method: 'GET', timeout: 15000 })
    if (res.statusCode === 404) throw new Error('[lxmn/license] 订阅链接不存在或已过期')
    if (res.statusCode !== 200) {
      throw new Error(`[lxmn/license] 订阅请求失败（HTTP ${res.statusCode}）`)
    }

    let json: unknown
    try {
      json = JSON.parse(res.body)
    } catch {
      throw new Error('[lxmn/license] 订阅内容不是合法 JSON')
    }

    const doc = parseSubscriptionDocument(json)
    const fetchedAt = Date.now()
    this.cache = { url, fetchedAt, doc }
    try {
      await getPlatform().storage.set(this.storageKey, JSON.stringify({ url, doc, fetchedAt }))
    } catch {
      // 缓存失败不影响主流程
    }
    return doc
  }

  /**
   * 当前订阅的令牌（从缓存里的链接反解出来）。
   *
   * 云同步直接复用这个令牌，用户不必为同步再注册一个账号 ——
   * 他已经为了音源填过一次链接了。
   */
  async token(): Promise<string> {
    if (!this.cache) await this.restore()
    if (!this.cache) return ''
    const m = /\/api\/music\/sub\/([^/?#]+)/.exec(this.cache.url)
    return m && m[1] ? decodeURIComponent(m[1]) : ''
  }

  /** 从本地缓存恢复（离线可用） */
  async restore(): Promise<MembershipStatus> {
    try {
      const raw = await getPlatform().storage.get(this.storageKey)
      if (!raw) return { state: 'none' }
      const parsed = JSON.parse(raw) as { url: string; doc: SubscriptionDocument; fetchedAt?: number }
      const doc = parseSubscriptionDocument(parsed.doc)
      /**
       * 注意这里必须用**缓存里记下的**时间，不能写 Date.now()。
       *
       * 以前写 Date.now()，等于每次启动都声称「刚拉过」，
       * 于是 refresh() 的节流永远判定为「太新，别拉」——
       * 服务端换了音源清单，客户端一辈子看不到。
       * 老缓存没有这个字段，就当作「很久以前」，让它有机会刷新一次。
       */
      this.cache = { url: parsed.url, fetchedAt: parsed.fetchedAt ?? 0, doc }
      if (!isPlanActive(doc.plan)) return { state: 'expired', plan: doc.plan }
      return { state: 'active', plan: doc.plan, sources: doc.sources }
    } catch {
      return { state: 'none' }
    }
  }

  /** 校验当前会员状态（优先走网络，失败回落缓存） */
  async status(): Promise<MembershipStatus> {
    if (!this.cache) {
      const restored = await this.restore()
      if (restored.state === 'none') return restored
    }
    if (!this.cache) return { state: 'none' }
    const { doc } = this.cache
    if (!isPlanActive(doc.plan)) return { state: 'expired', plan: doc.plan }
    return { state: 'active', plan: doc.plan, sources: doc.sources }
  }

  /**
   * 静默刷新订阅。
   *
   * 音源接口会失效、服务端也可能调整清单，但用户不该为此重新粘贴链接。
   * 这里用缓存里的 URL 重新拉一次：成功就悄悄替换本地文档，
   * 失败**保留旧文档**（离线时照常能听歌），也不抛错给界面。
   *
   * minIntervalMs 用来防止频繁调用把服务端打爆：默认 6 小时。
   * 返回是否真的更新了内容。
   */
  async refresh(minIntervalMs = 6 * 60 * 60 * 1000): Promise<boolean> {
    if (!this.cache) await this.restore()
    if (!this.cache) return false
    if (Date.now() - this.cache.fetchedAt < minIntervalMs) return false

    const url = this.cache.url
    try {
      const { http } = getPlatform()
      const res = await http.request({ url, method: 'GET', timeout: 15000 })
      if (res.statusCode !== 200) return false
      const doc = parseSubscriptionDocument(JSON.parse(res.body))
      const before = JSON.stringify(this.cache.doc.sources)
      const fetchedAt = Date.now()
      this.cache = { url, fetchedAt, doc }
      try {
        await getPlatform().storage.set(this.storageKey, JSON.stringify({ url, doc, fetchedAt }))
      } catch {
        // 缓存失败不影响主流程
      }
      return JSON.stringify(doc.sources) !== before
    } catch {
      // 网络不通 / 服务端临时故障：保留旧文档，用户照常听歌
      return false
    }
  }

  /** 清除本地订阅（退出会员 / 换链接） */
  async clear(): Promise<void> {
    this.cache = null
    try {
      await getPlatform().storage.remove(this.storageKey)
    } catch {
      // ignore
    }
  }

  /**
   * 把订阅里的音源注册进内核。
   *
   * 返回值刻意区分「真的能用了」和「订阅里写了但内核没有实现」：
   * 服务端下发的清单是**产品能力**（我们打算提供哪些音源），
   * 而客户端这边只有真正注册过的音源才可能出歌。
   *
   * 早期实现把订阅里的 builtin 全部算作「已应用」，于是界面上显示
   * 7 个音源已解锁、实际只有 wy 能搜到歌 —— 属于对用户撒谎。这里改成
   * 逐个用 hasSource() 核实，未实现的一律进 unavailable。
   */
  async apply(doc: SubscriptionDocument): Promise<ApplyResult> {
    const applied: string[] = []
    const unavailable: string[] = []
    const skipped: string[] = []

    for (const s of doc.sources) {
      if (s.type === 'script' && !this.allowRemoteScripts) {
        // 远程脚本默认不执行：需要用户显式同意
        skipped.push(s.id)
        continue
      }
      if (s.type !== 'builtin') {
        // manifest / script 需要宿主提供加载器，内核不擅自执行
        skipped.push(s.id)
        continue
      }
      if (!hasSource(s.id as SourceId)) {
        unavailable.push(s.id)
        continue
      }
      if (s.qualitys?.length) {
        setSupportQuality(s.id as SourceId, s.qualitys as Quality[])
      }
      applied.push(s.id)
    }
    return { applied, unavailable, skipped }
  }
}

/** apply() 的结果：分清「可用 / 订阅里有但未实现 / 本次跳过」 */
export interface ApplyResult {
  /** 真正注册进内核、可以出歌的音源 */
  applied: string[]
  /** 订阅里声明了、但当前客户端没有实现，因此不可用 */
  unavailable: string[]
  /** 按策略跳过（如未开启的远程脚本） */
  skipped: string[]
}

export { normalizeUrl }
export type { MembershipPlan, MembershipStatus, SubscribedSource, SubscriptionDocument, SubscriptionClientOptions }
export { registerSource }
