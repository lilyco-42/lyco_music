/**
 * 会员 / 音源订阅（桌面端）
 *
 * 流程：用户在 https://lain42.top/shop/ 用积分购买「音乐会员 · 年卡」，
 * 在「我的账户」复制订阅链接，粘进客户端即可补全全部第三方音源。
 *
 * 这是响应式的薄封装：SubscriptionClient 负责协议与缓存，这里只把它接到 Vue。
 */
import { computed, ref } from 'vue'
import { SHOP_URL, ANNUAL_PRICE_CNY } from '@lxmn/core'
import type { MembershipStatus, ApplyResult } from '@lxmn/core'
import { library } from './sync'
import { subscription as client } from './subscription'
import { syncScriptSources } from './source-pool'
const status = ref<MembershipStatus>({ state: 'none' })
const busy = ref(false)
const error = ref('')

/** 上次 apply() 的结果：可用 / 未实现 / 跳过 */
const applyResult = ref<ApplyResult>({ applied: [], unavailable: [], skipped: [] })

/**
 * 把订阅客户端里的最新状态回写到界面。
 *
 * 存在的理由：账号自动接通会员时（见 account-bridge），订阅是绕过本模块
 * 直接写进 SubscriptionClient 的 —— 顶栏的 VIP 徽标来自账号权益，立刻显示
 * 「已开通」，而会员页 / 云同步页读的是这里的 status ref，还停在 none。
 * 同一屏里两个说法，用户看到的就是「VIP 掉了」。
 *
 * 启动时序也会踩到：main.ts 先 restore()，那一刻若本地还没有缓存就是 none，
 * 随后账号才把订阅接上 —— 没有这个回写，界面会一直停在 none。
 */
export async function reloadMembershipStatus(): Promise<void> {
  status.value = await client.status()
  if (status.value.state === 'active') {
    applyResult.value = await client.apply({
      ok: true, schema: 1, plan: status.value.plan, sources: status.value.sources,
    })
    void syncScriptSources().catch(() => undefined)
  } else {
    applyResult.value = { applied: [], unavailable: [], skipped: [] }
  }
}

export function useMembership() {
  const isActive = computed(() => status.value.state === 'active')
  const plan = computed(() => (status.value.state === 'active' ? status.value.plan : null))
  const sources = computed(() => (status.value.state === 'active' ? status.value.sources : []))

  /** 启动时从本地缓存恢复（离线可用） */
  async function restore(): Promise<void> {
    status.value = await client.restore()
    if (status.value.state === 'active') {
      applyResult.value = await client.apply({ ok: true, schema: 1, plan: status.value.plan, sources: status.value.sources })
      // 静默刷新：音源接口会失效、服务端也会调清单，但用户不该为此重新粘链接。
      // 不 await，不弹任何提示 —— 成功了用户感觉不到，失败了继续用旧文档。
      // 把订阅里的脚本音源装进池子。同样静默：用户不该知道背后有几个源。
      void syncScriptSources().catch(() => undefined)
      void client.refresh().then(async (changed) => {
        if (!changed) return
        status.value = await client.status()
        if (status.value.state === 'active') {
          applyResult.value = await client.apply({ ok: true, schema: 1, plan: status.value.plan, sources: status.value.sources })
          void syncScriptSources().catch(() => undefined)
        }
      }).catch(() => undefined)
    }
  }

  /** 激活订阅链接 */
  async function activate(link: string): Promise<void> {
    busy.value = true
    error.value = ''
    try {
      const doc = await client.fetch(link.trim())
      applyResult.value = await client.apply(doc)
      status.value = { state: 'active', plan: doc.plan, sources: doc.sources }
      // 会员身份即同步身份：激活的同时把云同步一起开通，
      // 不额外要求用户去注册/再填一次令牌。
      const token = await client.token()
      if (token) await library.configureSync(token)
      // 立刻把脚本源装好，用户下一次点播放就能用上
      void syncScriptSources().catch(() => undefined)
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      busy.value = false
    }
  }

  /** 刷新状态 */
  async function refresh(): Promise<void> {
    busy.value = true
    error.value = ''
    try {
      status.value = await client.status()
    } finally {
      busy.value = false
    }
  }

  /** 退出会员 */
  async function clear(): Promise<void> {
    await client.clear()
    await library.disableSync()
    applyResult.value = { applied: [], unavailable: [], skipped: [] }
    status.value = { state: 'none' }
    error.value = ''
  }

  /** 打开购买页（Electron 下由主进程交给系统浏览器） */
  function openShop(): void {
    const bridge = (window as unknown as { lxmnNative?: { openExternal?: (u: string) => void } }).lxmnNative
    if (bridge?.openExternal) bridge.openExternal(SHOP_URL)
    else window.open(SHOP_URL, '_blank', 'noopener')
  }

  return {
    status, busy, error, applyResult, isActive, plan, sources,
    restore, activate, refresh, clear, openShop,
    SHOP_URL, ANNUAL_PRICE_CNY,
  }}
