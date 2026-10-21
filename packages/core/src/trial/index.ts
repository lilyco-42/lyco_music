/**
 * 试听列表（对应 lx-music 的 default 列表）
 *
 * 这是 lx 用户的心智模型：**点一首歌，它先进试听列表，然后从试听列表播**。
 * 不是「临时队列」，也不是「播放历史」—— 它是一个用户能看见、能拖顺序、
 * 能删、能整体转存到自建歌单的真实列表。没有它，从 lx 迁过来的人
 * 第一分钟就找不到自己的播放队列。
 *
 * 与「最近播放」的区别（两者经常被混淆）：
 *   - 最近播放：按时间倒序，同一首歌只留一条，记次数，用户不直接编辑
 *   - 试听列表：用户排的顺序，去重，可拖拽/删除/清空
 *
 * 这里只放**纯函数**：输入一个数组，返回一个新数组，不碰存储也不碰状态。
 * 这样规则能被测试穷举，也方便以后在 Web 端复用。
 */
import type { MusicItem } from '../types'
import { trackKey } from '../track'

/**
 * 试听列表容量上限。
 *
 * lx 不设上限，但我们的整份曲库是当一个 JSON 文档同步的 ——
 * 无上限意味着用得越久载荷越大，最后同步一次要传几 MB。
 * 2000 首 ≈ 400KB，已经远超正常「最近在听」的量。
 * 超限时丢**最早加入**的那一端（见 trialAdd 的注释）。
 */
export const TRIAL_MAX = 2000

/** 新歌加在列表头还是尾 */
export type AddLocation = 'top' | 'bottom'

/** 是否已在试听列表里 */
export function trialHas(list: readonly MusicItem[], item: MusicItem): boolean {
  const key = trackKey(item)
  return list.some(x => trackKey(x) === key)
}

/** 在试听列表里的位置，没有返回 -1 */
export function trialIndexOf(list: readonly MusicItem[], item: MusicItem): number {
  const key = trackKey(item)
  return list.findIndex(x => trackKey(x) === key)
}

/**
 * 加入试听列表。
 *
 * 已存在的跳过（不移动位置、不更新字段）—— 与 lx 的 `listMusicAdd` 一致。
 * 重复点同一首歌不该让它跳到列表头，否则用户刚排好的顺序会被自己点乱。
 *
 * 超限时按「保留新加入的」裁剪：
 *   - 加到头部（默认）→ 截掉尾部（最老的）
 *   - 加到尾部 → 截掉头部（最老的）
 * 两种插入位置下「新」的方向相反，所以裁剪方向也要跟着反。
 */
export function trialAdd(
  list: readonly MusicItem[],
  items: readonly MusicItem[],
  location: AddLocation = 'top',
): MusicItem[] {
  const seen = new Set(list.map(trackKey))
  const fresh: MusicItem[] = []
  for (const item of items) {
    const key = trackKey(item)
    if (!key || seen.has(key)) continue
    seen.add(key)
    fresh.push(item)
  }
  if (!fresh.length) return [...list]

  const next = location === 'bottom' ? [...list, ...fresh] : [...fresh, ...list]
  if (next.length <= TRIAL_MAX) return next
  return location === 'bottom' ? next.slice(next.length - TRIAL_MAX) : next.slice(0, TRIAL_MAX)
}

/** 按曲目删除 */
export function trialRemove(list: readonly MusicItem[], items: readonly MusicItem[]): MusicItem[] {
  const drop = new Set(items.map(trackKey))
  return list.filter(item => !drop.has(trackKey(item)))
}

/** 按键删除（界面拿到的往往是 id / key，而不是完整对象） */
export function trialRemoveKeys(list: readonly MusicItem[], keys: readonly string[]): MusicItem[] {
  const drop = new Set(keys)
  return list.filter(item => !drop.has(trackKey(item)))
}

/**
 * 把选中的若干首移动到 `position`（对应 lx 的 `createSortedList`）。
 *
 * 语义细节：`position` 是**剩下那些歌**里的插入下标，不是原列表的下标。
 * 例：`[A,B,C,D]` 把 `[B,C]` 移到 position 1 →
 *   剩下 `[A,D]`，在 1 处插入 → `[A,B,C,D]`（没动）
 *   position 2 → `[A,D,B,C]`
 *
 * 多选拖动时 `keys` 的顺序就是用户拖出来的顺序，必须照它排，
 * 不能按原列表顺序 —— 否则「把 C 拖到 B 前面」会被还原成 B 在前。
 */
export function trialMoveTo(
  list: readonly MusicItem[],
  position: number,
  keys: readonly string[],
): MusicItem[] {
  const byKey = new Map<string, MusicItem>()
  for (const item of list) byKey.set(trackKey(item), item)

  const moving: MusicItem[] = []
  for (const key of keys) {
    const item = byKey.get(key)
    if (!item) continue
    moving.push(item)
    byKey.delete(key)
  }
  if (!moving.length) return [...list]

  const rest = list.filter(item => byKey.has(trackKey(item)))
  const at = Math.max(0, Math.min(Math.trunc(position) || 0, rest.length))
  return [...rest.slice(0, at), ...moving, ...rest.slice(at)]
}

/** 上移 / 下移一首（界面的键盘与按钮操作，不需要拖拽也能调顺序） */
export function trialShift(list: readonly MusicItem[], key: string, delta: number): MusicItem[] {
  const at = list.findIndex(item => trackKey(item) === key)
  if (at < 0) return [...list]
  const to = at + Math.trunc(delta)
  if (to < 0 || to >= list.length) return [...list]
  const next = [...list]
  const [item] = next.splice(at, 1)
  if (item) next.splice(to, 0, item)
  return next
}

/**
 * 批量移动到另一个列表（歌单）。
 *
 * 返回 `{ moved, rest }`：`moved` 保持试听列表里的原顺序，
 * 因为用户是「把这几首整体存进歌单」，顺序应该跟着走。
 */
export function trialTakeOut(
  list: readonly MusicItem[],
  keys: readonly string[],
): { moved: MusicItem[]; rest: MusicItem[] } {
  const want = new Set(keys)
  const moved: MusicItem[] = []
  const rest: MusicItem[] = []
  for (const item of list) {
    if (want.has(trackKey(item))) moved.push(item)
    else rest.push(item)
  }
  return { moved, rest }
}
