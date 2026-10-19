/**
 * 「同一首歌在别的平台上是哪一条」
 *
 * 歌词、翻译、罗马音、评论这四件事都有同一个前提：**这首歌在网易云上叫什么**。
 * 酷狗/酷我/咪咕都没有可用的翻译和罗马音接口，但同一首歌在网易云上往往
 * 既有翻译也有罗马音（日文歌尤其明显）。所以先把「另一边的条目」找到并缓存，
 * 后面几处补全都复用它，避免一首歌把四家接口各搜一遍。
 *
 * 匹配规则和串源播放完全一致（标题几乎一致 + 歌手对得上）：
 * 宁可补不到，也不要把另一首歌的歌词/评论显示在这首歌上。
 */
import { getSource, hasSource, type MusicItem, type SourceId } from '@lxmn/core'
import { pickBestMatch } from './fallback'

/** 缓存 key 用「歌名 + 歌手」而不是 songmid：不同平台的 id 本来就不通用 */
function keyOf(item: MusicItem): string {
  return `${String(item.name ?? '').trim()}|${String(item.singer ?? '').trim()}`
}

/** 命中的条目；null 表示找过但没有（也要缓存，避免反复搜同一首） */
const cache = new Map<string, MusicItem | null>()

/** 正在进行的查询，避免同一首歌并发发两次搜索 */
const inflight = new Map<string, Promise<MusicItem | null>>()

/**
 * 找同一首歌在别的平台上的条目。
 *
 * @param item 当前曲目
 * @param only 只在这一个音源里找（比如只要网易云，为了拿翻译/罗马音/评论）
 */
export async function findSameSong(item: MusicItem, only?: SourceId): Promise<MusicItem | null> {
  const key = keyOf(item) + '|' + (only ?? 'any')
  if (cache.has(key)) return cache.get(key) ?? null
  const running = inflight.get(key)
  if (running) return running

  const task = (async (): Promise<MusicItem | null> => {
    const ids: SourceId[] = only
      ? [only]
      : (['wy', 'mg', 'kw', 'kg'] as SourceId[])
    const keyword = (String(item.name ?? '') + ' ' + String(item.singer ?? '')).trim()
    if (!keyword) return null

    for (const id of ids) {
      if (id === item.source) continue
      if (!hasSource(id)) continue
      const source = getSource(id)
      if (!source.musicSearch) continue
      try {
        const found = await source.musicSearch(keyword, 1, 10)
        const match = pickBestMatch(item, found.list)
        if (match) return match
      } catch {
        // 这个源搜不动，继续下一个
      }
    }
    return null
  })()

  inflight.set(key, task)
  try {
    const result = await task
    cache.set(key, result)
    return result
  } finally {
    inflight.delete(key)
  }
}

/** 仅供测试/切歌时清理（缓存本身很小，正常不需要主动清） */
export function clearSameSongCache(): void {
  cache.clear()
  inflight.clear()
}
