/**
 * 会员 / 音源订阅。
 *
 * 流程：用户在 https://lain42.top/shop/ 购买「音乐会员 · 年卡」（128 元 / 年），
 * 拿到订阅链接 -> 粘进客户端 -> 一键补全全部第三方音源。
 */
import { useCallback, useEffect, useState } from 'react'
import { SubscriptionClient, SHOP_URL, ANNUAL_PRICE_CNY } from '@lxmn/core'
import type { MembershipStatus, ApplyResult } from '@lxmn/core'

/**
 * 共享的订阅客户端单例。
 *
 * sync.ts 需要读同一个订阅令牌（同步复用会员身份）。各自 new 一个虽然
 * storage key 相同、数据一致，但两个实例的 cache 互不可见，
 * 恢复时机不同就会读到空令牌。
 */
export const subscription = new SubscriptionClient()
const client = subscription

/** 激活订阅：拉取 -> 校验 -> 应用音源 */
export async function activate(link: string): Promise<{ status: MembershipStatus; applied: ApplyResult }> {
  const doc = await client.fetch(link)
  const applied = await client.apply(doc)
  return { status: await client.status(), applied }
}

/** 查询当前会员状态（离线可用） */
export async function status(): Promise<MembershipStatus> {
  return client.status()
}

/**
 * 拉取服务端最新音源清单并重新 apply。
 *
 * force=true 跳过 6 小时节流（会员页「查询」用）；常开应用的定时刷新
 * 用默认节流，避免每次进页面都打一次 /api/music/sub。
 * 失败保留旧文档：离线时照常能听歌。
 */
export async function refreshMembership(force = false): Promise<MembershipStatus> {
  await client.refresh(force ? 0 : undefined).catch(() => false)
  const st = await client.status()
  if (st.state === 'active') {
    await client.apply({ ok: true, schema: 1, plan: st.plan, sources: st.sources })
  }
  return st
}

/** 启动恢复：先用本地缓存立刻可用，再静默问一次服务端有没有换清单 */
export async function restoreMembership(): Promise<MembershipStatus> {
  const st = await client.restore()
  if (st.state === 'active') {
    await client.apply({ ok: true, schema: 1, plan: st.plan, sources: st.sources })
  }
  void refreshMembership().catch(() => undefined)
  return st
}

/** 应用常开时每 6 小时拿一次最新清单（client.refresh 自带节流） */
export const MEMBERSHIP_REFRESH_MS = 6 * 60 * 60 * 1000

/** 退出会员 / 换链接 */
export async function deactivate(): Promise<void> {
  await client.clear()
}

/**
 * 会员状态的 React 封装。
 *
 * 移动端没有全局 store，页面各自订阅同一个 SubscriptionClient 的缓存 ——
 * 所以这里只是把 client.status() 的结果搬进 useState，不在模块级存状态，
 * 避免多个页面看到不同步的会员状态。
 */
export function useMembership(): {
  status: MembershipStatus
  isActive: boolean
  loading: boolean
  refresh: () => Promise<void>
} {
  const [status, setStatus] = useState<MembershipStatus>({ state: 'none' })
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setStatus(await refreshMembership(true))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { status, isActive: status.state === 'active', loading, refresh }
}

export { SHOP_URL, ANNUAL_PRICE_CNY }
