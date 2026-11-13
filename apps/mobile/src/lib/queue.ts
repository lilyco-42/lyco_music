/**
 * 播放队列编辑的纯计算。
 *
 * 单独抽出来是因为「删掉当前曲目前面的一首」最容易错：队列变了，
 * state.index 必须跟着左移，否则正在放的歌和 UI 高亮会错开一首。
 * 这里不碰 TrackPlayer，方便直接单测所有边界。
 */
export interface QueueEditResult<T> {
  queue: T[]
  index: number
  /** 被删的是否正是当前曲目 */
  removedCurrent: boolean
  /** 入参是否合法、是否真的发生了改动 */
  changed: boolean
}

/** 删除队列中的一项，并修正当前下标。删掉当前曲目时停在「补位」的那首上。 */
export function removeQueueAt<T>(queue: readonly T[], currentIndex: number, removeAt: number): QueueEditResult<T> {
  if (!Number.isInteger(removeAt) || removeAt < 0 || removeAt >= queue.length) {
    return { queue: [...queue], index: currentIndex, removedCurrent: false, changed: false }
  }
  const next = queue.filter((_, i) => i !== removeAt)
  const removedCurrent = removeAt === currentIndex
  let index = currentIndex
  if (removedCurrent) index = Math.min(removeAt, next.length - 1)
  else if (removeAt < currentIndex) index = Math.max(0, currentIndex - 1)
  return { queue: next, index, removedCurrent, changed: true }
}

/** 清空队列后不留任何残留下标（-1 表示无当前曲目）。 */
export function emptyQueue(): { queue: never[]; index: number } {
  return { queue: [], index: -1 }
}
