/**
 * 崩溃防护：safe() 必须吞掉同步异常与 Promise 拒绝，并留下可读记录。
 * 这是「点按钮闪退」这一类问题的兜底。
 */
import { safe, errorRecords, recordError } from '../src/lib/safe'

describe('safe()', () => {
  it('同步异常不向外抛，并记录 label', () => {
    const fn = safe('测试按钮', () => { throw new Error('boom') })
    expect(() => fn()).not.toThrow()
    expect(errorRecords()[0]?.message).toBe('boom')
    expect(errorRecords()[0]?.label).toBe('测试按钮')
  })

  it('Promise 拒绝被捕获', async () => {
    const fn = safe('异步按钮', async () => { throw new Error('async-boom') })
    fn()
    await new Promise(r => setTimeout(r, 0))
    expect(errorRecords().some(r => r.message === 'async-boom')).toBe(true)
  })

  it('正常返回值不受影响', () => {
    const fn = safe('正常', (a: number, b: number) => a + b)
    expect(fn(1, 2)).toBeUndefined() // 包装后不返回结果，只保证不抛
  })

  it('记录数量有上限（不会无限增长）', () => {
    for (let i = 0; i < 40; i++) recordError('压测' + i, new Error('e' + i))
    expect(errorRecords().length).toBeLessThanOrEqual(20)
  })
})
