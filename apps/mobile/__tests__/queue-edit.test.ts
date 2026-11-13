import { emptyQueue, removeQueueAt } from '../src/lib/queue'

describe('移动端队列编辑纯计算', () => {
  const q = ['A', 'B', 'C', 'D']

  it('删当前曲目前面的一首：下标必须左移，避免高亮错开', () => {
    expect(removeQueueAt(q, 2, 0)).toEqual({
      queue: ['B', 'C', 'D'], index: 1, removedCurrent: false, changed: true,
    })
  })

  it('删当前曲目后面的一首：下标不动', () => {
    expect(removeQueueAt(q, 1, 3)).toEqual({
      queue: ['A', 'B', 'C'], index: 1, removedCurrent: false, changed: true,
    })
  })

  it('删当前曲目：停在补位那首；删最后一首当前曲则队列为空、下标 -1', () => {
    expect(removeQueueAt(q, 1, 1)).toEqual({
      queue: ['A', 'C', 'D'], index: 1, removedCurrent: true, changed: true,
    })
    expect(removeQueueAt(['A'], 0, 0)).toEqual({
      queue: [], index: -1, removedCurrent: true, changed: true,
    })
  })

  it('越界与小数下标不改队列；清空返回无当前曲目', () => {
    for (const n of [-1, 4, 1.5, NaN, Infinity]) {
      expect(removeQueueAt(q, 1, n)).toEqual({ queue: q, index: 1, removedCurrent: false, changed: false })
    }
    expect(emptyQueue()).toEqual({ queue: [], index: -1 })
  })
})
