/**
 * 同步载荷的合并
 *
 * 策略是「并集优先、按时间戳决胜负」：
 *   - 收藏 / 播放记录：按 (source, songmid) 去重，保留较新的那份字段，
 *     播放次数取两边最大值（不是相加 —— 两台机器离线各听 3 次，
 *     合并成 6 次会虚高；取 max 更接近「至少听过这么多」）
 *   - 歌单：按 id 合并，updatedAt 新的一方整体胜出（歌单是有序的，
 *     逐条并集会把顺序搅乱），但两边都有、且另一边更新的条目仍会被并进来
 *   - 设置：整体取更新的那一边（字段少且互相耦合，逐字段合并没意义）
 *
 * 这里没有任何网络/存储调用，纯函数 —— 所以能被测试穷举验证。
 */
import type {
  SyncFavorite,
  SyncHistoryEntry,
  SyncPayload,
  SyncPlaylist,
  SyncSettings,
} from './types'

/** 判定「同一首歌」的键。跨音源的同一首歌算两条 —— 它们的 songmid 不通用。 */
export function trackKey(item: { source?: string; songmid?: string | number }): string {
  return String(item.source ?? '') + '::' + String(item.songmid ?? '')
}

/** 收藏合并：去重取并集，重复时保留较新的字段 */
export function mergeFavorites(a: SyncFavorite[], b: SyncFavorite[]): SyncFavorite[] {
  const map = new Map<string, SyncFavorite>()
  for (const item of [...a, ...b]) {
    const key = trackKey(item)
    const prev = map.get(key)
    if (!prev) {
      map.set(key, { ...item, addedAt: Number(item.addedAt) || 0 })
      continue
    }
    // 较新的那份作为字段来源，addedAt 取更早的（首次收藏时间更真实）
    const newer = (Number(item.addedAt) || 0) >= (Number(prev.addedAt) || 0) ? item : prev
    map.set(key, {
      ...newer,
      addedAt: Math.min(Number(prev.addedAt) || 0, Number(item.addedAt) || 0),
    })
  }
  return [...map.values()].sort((x, y) => y.addedAt - x.addedAt)
}

/** 播放记录合并：按最近播放时间排序，次数取最大 */
export function mergeHistory(a: SyncHistoryEntry[], b: SyncHistoryEntry[]): SyncHistoryEntry[] {
  const map = new Map<string, SyncHistoryEntry>()
  for (const item of [...a, ...b]) {
    const key = trackKey(item)
    const prev = map.get(key)
    if (!prev) {
      map.set(key, {
        ...item,
        playedAt: Number(item.playedAt) || 0,
        playCount: Number(item.playCount) || 0,
      })
      continue
    }
    const newer = (Number(item.playedAt) || 0) >= (Number(prev.playedAt) || 0) ? item : prev
    map.set(key, {
      ...newer,
      playedAt: Math.max(Number(prev.playedAt) || 0, Number(item.playedAt) || 0),
      playCount: Math.max(Number(prev.playCount) || 0, Number(item.playCount) || 0),
    })
  }
  return [...map.values()].sort((x, y) => y.playedAt - x.playedAt)
}

/** 歌单合并：同名同 id 按 updatedAt 取新，条目做并集且保持原有相对顺序 */
export function mergePlaylists(a: SyncPlaylist[], b: SyncPlaylist[]): SyncPlaylist[] {
  const map = new Map<string, SyncPlaylist>()
  const push = (pl: SyncPlaylist) => {
    const prev = map.get(pl.id)
    if (!prev) {
      map.set(pl.id, {
        ...pl,
        createdAt: Number(pl.createdAt) || 0,
        updatedAt: Number(pl.updatedAt) || 0,
        items: [...(pl.items ?? [])],
      })
      return
    }
    const prevAt = Number(prev.updatedAt) || 0
    const nextAt = Number(pl.updatedAt) || 0
    const newer = nextAt >= prevAt ? pl : prev
    const older = nextAt >= prevAt ? prev : pl

    // 条目并集：先放新的一方的顺序，再把旧一方独有的追加到末尾。
    // 不重排成「全局时间序」—— 歌单顺序是用户手排的，不能动。
    const seen = new Set<string>()
    const items = []
    for (const it of [...(newer.items ?? []), ...(older.items ?? [])]) {
      const key = trackKey(it)
      if (seen.has(key)) continue
      seen.add(key)
      items.push(it)
    }
    map.set(pl.id, {
      ...newer,
      createdAt: Math.min(Number(prev.createdAt) || 0, Number(pl.createdAt) || 0),
      updatedAt: Math.max(prevAt, nextAt),
      items,
    })
  }
  for (const pl of a) push(pl)
  for (const pl of b) push(pl)
  return [...map.values()].sort((x, y) => y.updatedAt - x.updatedAt)
}

/**
 * 设置合并：谁的 settingsUpdatedAt 更新，整份取胜。
 *
 * 不逐字段合并 —— 逐字段就变成「后者覆盖前者」，而设置没有逐字段
 * 时间戳，merge(a,b) 与 merge(b,a) 会给出不同结果。那样两台设备会
 * 反复覆盖对方的音质/音量，用户看到设置自己跳来跳去。
 * 时间戳相同时偏向 a（调用方约定 a 是本地），保证结果确定。
 */
export function mergeSettings(a: SyncSettings, b: SyncSettings, aAt = 0, bAt = 0): SyncSettings {
  if (bAt > aAt) return { ...b }
  return { ...a }
}

/**
 * 合并两份同步载荷。
 *
 * 交换律成立（merge(a,b) 与 merge(b,a) 结果一致），这让「谁先同步」
 * 不影响最终状态 —— 否则两台设备会来回覆盖对方，永远收敛不了。
 */
export function mergePayload(local: SyncPayload, remote: SyncPayload): SyncPayload {
  const localAt = Number(local.settingsUpdatedAt) || 0
  const remoteAt = Number(remote.settingsUpdatedAt) || 0
  return {
    settings: mergeSettings(local.settings ?? {}, remote.settings ?? {}, localAt, remoteAt),
    settingsUpdatedAt: Math.max(localAt, remoteAt),
    favorites: mergeFavorites(local.favorites ?? [], remote.favorites ?? []),
    playlists: mergePlaylists(local.playlists ?? [], remote.playlists ?? []),
    history: mergeHistory(local.history ?? [], remote.history ?? []),
    dislikes: mergeDislikes(local.dislikes ?? [], remote.dislikes ?? []),
  }
}

/**
 * 「不喜欢」规则合并：取并集，保留本地顺序。
 *
 * 两边各屏蔽了一些歌，合并后应该都保留 —— 与收藏同策略。
 * 逐条归一化去重，避免 `晴天@周杰伦` 和 ` 晴天@周杰伦 ` 变成两条。
 */
export function mergeDislikes(a: string[], b: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const line of [...a, ...b]) {
    const rule = String(line ?? '').trim()
    if (!rule || seen.has(rule)) continue
    seen.add(rule)
    out.push(rule)
  }
  return out
}

/** 载荷是否有实质内容（决定首次同步要不要真的写一次服务端） */
export function isEmptyPayload(p: SyncPayload): boolean {
  return (
    !p.favorites?.length &&
    !p.playlists?.length &&
    !p.history?.length &&
    !p.dislikes?.length &&
    !Object.keys(p.settings ?? {}).length
  )
}

/** 粗略估算载荷大小，用于拒绝异常大的提交 */
export function payloadSize(p: SyncPayload): number {
  try {
    return JSON.stringify(p).length
  } catch {
    return 0
  }
}
