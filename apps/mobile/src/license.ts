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
      setStatus(await client.status())
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
