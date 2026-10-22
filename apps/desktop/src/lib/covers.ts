/**
 * 首页封面取图。
 *
 * 首页之前是纯静态：9 个歌单共用同一张 playlist-default.jpg，看起来就像
 * 「图片没加载出来」。这里用真实的搜索接口按关键词取第一首的封面 ——
 * 每张卡片各不相同，而且点进去搜到的也是同一批歌。
 *
 * 走内存缓存 + 并发上限，避免首页一进去就同时打十几个请求。
 */
import { getSource, hasSource, listSources } from '@lxmn/core'

const cache = new Map<string, string>()
const pending = new Map<string, Promise<string>>()

/**
 * 持久化缓存：首页封面就是「关键词 -> 某首歌的封面 URL」，一天之内基本不变。
 *
 * 只放内存的话，每次启动都要重新搜 16 个关键词，首页会先空一两秒再一张张
 * 冒出来；写进 localStorage 后，第二次启动**首帧就有图**。TTL 取 24 小时：
 * 再长会让换过的封面一直不更新，再短就失去意义。
 */
const STORE_KEY = 'lxmn.covers.v1'
const TTL = 24 * 60 * 60 * 1000

function loadStore(): void {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as Record<string, { url?: unknown; ts?: unknown }>
    const now = Date.now()
    for (const [key, item] of Object.entries(parsed)) {
      if (!item || typeof item.url !== 'string' || !item.url) continue
      if (typeof item.ts !== 'number' || now - item.ts > TTL) continue
      cache.set(key, item.url)
    }
  } catch {
    // 存储坏了就当没有缓存，不影响首页
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null
function persist(): void {
  // 十几个关键词会连着写入，攒 200ms 合并成一次，避免反复序列化整张表
  if (persistTimer) return
  persistTimer = setTimeout(() => {
    persistTimer = null
    try {
      const now = Date.now()
      const out: Record<string, { url: string; ts: number }> = {}
      for (const [key, url] of cache) {
        if (url) out[key] = { url, ts: now }
      }
      localStorage.setItem(STORE_KEY, JSON.stringify(out))
    } catch {
      // 配额满了就只保留内存缓存
    }
  }, 200)
}

loadStore()

/** 同时只跑 3 个搜索，其余排队 */
let running = 0
const queue: Array<() => void> = []
async function acquire(): Promise<void> {
  if (running < 3) { running++; return }
  await new Promise<void>(resolve => queue.push(resolve))
  running++
}
function release(): void {
  running--
  const next = queue.shift()
  if (next) next()
}

export async function coverFor(keyword: string): Promise<string> {
  const key = keyword.trim()
  if (!key) return ''
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  const inflight = pending.get(key)
  if (inflight) return inflight

  const task = (async () => {
    await acquire()
    try {
      const ids = listSources().filter(id => hasSource(id) && Boolean(getSource(id).musicSearch))
      for (const id of ids) {
        try {
          const r = await getSource(id).musicSearch!(key, 1, 1)
          const pic = r.list[0]?.picUrl
          if (pic) {
            cache.set(key, pic)
            persist()
            return pic
          }
        } catch {
          // 换下一个音源
        }
      }
      // 空结果不持久化：可能只是这次接口抽风，下次启动应该重试
      cache.set(key, '')
      return ''
    } finally {
      release()
      pending.delete(key)
    }
  })()

  pending.set(key, task)
  return task
}
