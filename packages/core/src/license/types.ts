/**
 * 会员与音源订阅的数据模型
 *
 * 商业模式：用户在 https://lain42.top/shop/ 用积分购买「音乐会员」，
 * 得到一条订阅链接；把链接填进客户端，即可自动补全所有第三方音源。
 *
 * 这里只描述数据结构，不含任何业务实现 —— 桌面端 / 移动端 / 未来的
 * Web 端共用同一套解析逻辑。
 */
import type { SourceId } from '../types'

export type MembershipPlanId = 'music_annual' | 'music_monthly' | 'music_trial'

export interface MembershipPlan {
  id: MembershipPlanId | string
  name: string
  /** ISO8601 到期时间 */
  expiresAt: string
  /** 是否仍在有效期内（由服务端判定，客户端只做兜底） */
  active?: boolean
}

/** 订阅里描述的一个音源 */
export interface SubscribedSource {
  /** 音源标识 */
  id: SourceId | string
  /** 展示名 */
  name: string
  /**
   * builtin  —— 内核已内置，直接用
   * manifest —— 声明式定义（安全，推荐）
   * script   —— 远程脚本（需 sha256 校验，默认不启用）
   */
  type: 'builtin' | 'manifest' | 'script'
  /** manifest / script 的下载地址 */
  url?: string
  /** script 类型必须提供，用于完整性校验 */
  sha256?: string
  version?: string
  /** 该音源支持的音质 */
  qualitys?: string[]
  /**
   * 服务端声称客户端内核是否已内置该音源的真实实现。
   *
   * 仅作展示与交叉校验用 —— 判定「能不能用」的**权威依据**始终是客户端的
   * hasSource()：服务端的声明可能滞后于客户端版本，反之亦然。
   */
  implemented?: boolean
  /** 服务端给的尝试顺序：曲库全的排前面，串源兜底时优先用它 */
  order?: number
  /** 服务端可远程关掉某个音源，客户端应尊重 */
  enabled?: boolean
  /** 备注 / 说明 */
  note?: string
}

/** 服务端返回的订阅内容 */
export interface SubscriptionDocument {
  ok: boolean
  schema: number
  plan: MembershipPlan
  sources: SubscribedSource[]
  /** 服务端签名，客户端可校验来源可信 */
  signature?: string
  issuedAt?: string
}

export type MembershipStatus =
  | { state: 'none' }
  | { state: 'active'; plan: MembershipPlan; sources: SubscribedSource[] }
  | { state: 'expired'; plan: MembershipPlan }
  | { state: 'invalid'; reason: string }

export interface SubscriptionClientOptions {
  /**
   * 服务端根地址，默认 https://lain42.top/studio
   *
   * 注意只有 **API** 在 /studio 前缀下：pingap 只把 `/studio/api/*` 反代到
   * billing 服务，裸域名的 /api/* 会命中前端 SPA（返回 HTML）。
   * 静态站点（/shop/、/account/、/downloads/）仍在域名根目录，
   * 所以 SHOP_URL 是 https://lain42.top/shop/，不带 /studio。
   * 详见 client.ts 的 DEFAULT_BASE。
   */
  baseUrl?: string
  /** 本地缓存键名 */
  storageKey?: string
  /** 允许执行远程脚本音源（默认 false，需用户显式同意） */
  allowRemoteScripts?: boolean
  /** 订阅文档签名校验公钥（可选） */
  publicKeyPem?: string
}

/** 购买入口（用于「一键购买会员」按钮） */
export const SHOP_URL = 'https://lain42.top/shop/'
/** 会员价格展示 */
export const ANNUAL_PRICE_CNY = 88