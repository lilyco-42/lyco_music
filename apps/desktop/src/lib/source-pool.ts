/**
 * 把订阅里的第三方音源脚本喂给音源池。
 *
 * 订阅文档里 type === 'script' 的条目就是 lx-music 音源脚本。
 * 这类脚本默认不启用（需要用户显式同意），因为它在沙箱里执行第三方代码。
 *
 * 订阅刷新是静默的（见 SubscriptionClient.refresh），所以这里的 sync 也必须
 * 静默：用户不该看到「音源已更新」的提示，他只需要下次点播放时还能出声。
 */

import { sourcePool, type PoolEntry } from '@lxmn/core'
import { subscription } from './subscription'
import { userSourceEntries } from './user-sources'

// 让 fallback.ts 也能直接用同一个池实例
export { sourcePool }

/** 脚本源码缓存：避免每次播放都重新下载脚本 */
const CACHE_KEY = 'lxmn.lxscripts.v1'

interface CachedScript {
  url: string
  code: string
  fetchedAt: number
}

/** 脚本多久重新下载一次（作者更新频繁，但没必要每次播放都拉） */
const REFRESH_MS = 12 * 60 * 60 * 1000

async function readCache(): Promise<Record<string, CachedScript>> {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? (JSON.parse(raw) as Record<string, CachedScript>) : {}
  } catch {
    return {}
  }
}

async function writeCache(data: Record<string, CachedScript>): Promise<void> {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data))
  } catch {
    // 配额满了就算了，不影响播放
  }
}

/**
 * 下载脚本源码。
 *
 * 带 sha256 校验的会先验一遍再落缓存 —— 订阅里给了哈希就说明作者在意完整性，
 * 我们要么验通过、要么拒绝执行，不能「验不过也照跑」。
 */
async function fetchScript(url: string, sha256?: string): Promise<string | null> {
  try {
    const res = await fetch(url, { cache: 'no-cache' })
    if (!res.ok) return null
    const code = await res.text()
    if (code.length < 200 || code.length > 2_000_000) return null

    if (sha256) {
      const digest = await sha256Hex(code)
      if (digest !== sha256.toLowerCase()) {
        console.warn('[lxmn] 音源脚本校验失败，已拒绝执行', url)
        return null
      }
    }
    return code
  } catch {
    return null
  }
}

async function sha256Hex(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text)
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * 从订阅同步脚本音源到池里。
 *
 * 返回实际装载的脚本数（供设置页展示）。失败不抛错：
 * 订阅本身还有效，只是脚本源暂时拿不到，内置源照样能播。
 */
export async function syncScriptSources(): Promise<number> {
  const entries: PoolEntry[] = []

  let status
  try {
    status = await subscription.status()
  } catch {
    // 订阅拿不到不影响用户自己导入的脚本
    status = null
  }

  const scripts =
    status && status.state === 'active'
      ? status.sources.filter((s) => s.type === 'script' && s.url && s.enabled !== false)
      : []

  const cache = await readCache()

  for (const s of scripts) {
    const url = String(s.url)
    const cached = cache[url]
    let code: string | undefined

    if (cached && Date.now() - cached.fetchedAt < REFRESH_MS) {
      code = cached.code
    } else {
      const fresh = await fetchScript(url, s.sha256)
      if (fresh) {
        code = fresh
        cache[url] = { url, code: fresh, fetchedAt: Date.now() }
      } else if (cached) {
        // 拉不到就继续用旧的：总比没有强
        code = cached.code
      }
    }
    if (!code) continue

    entries.push({
      id: String(s.id || url),
      name: s.name || String(s.id || '音源'),
      code,
      order: s.order,
      enabled: s.enabled,
    })
  }

  // 用户自己导入的脚本排在订阅之后（order 900+），不依赖会员状态
  for (const e of userSourceEntries()) entries.push(e)

  await writeCache(cache)
  sourcePool.sync(entries)
  return entries.length
}
