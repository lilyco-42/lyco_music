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
          if (pic) { cache.set(key, pic); return pic }
        } catch {
          // 换下一个音源
        }
      }
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
