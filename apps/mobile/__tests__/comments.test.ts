import { fmtCommentTime, fmtLikes, resolveCommentTarget } from '../src/lib/comments'
import type { MusicItem, MusicSource, SourceId } from '@lxmn/core'

const now = new Date(2026, 10, 13, 12, 0, 0).getTime()

describe('评论格式化', () => {
  it('点赞数：万以下原样，万以上一位小数，脏值空串', () => {
    expect(fmtLikes(999)).toBe('999')
    expect(fmtLikes(10_000)).toBe('1万')
    expect(fmtLikes(12_345)).toBe('1.2万')
    expect(fmtLikes(123_456)).toBe('12万')
    expect(fmtLikes(-1)).toBe('')
    expect(fmtLikes(undefined)).toBe('')
  })

  it('时间：今天 HH:mm / 今年 M月d日 / 跨年 YYYY/M/d', () => {
    const d = new Date(2026, 10, 13, 9, 5)
    expect(fmtCommentTime(d.getTime(), now)).toBe('09:05')
    expect(fmtCommentTime(new Date(2026, 0, 2).getTime(), now)).toBe('1月2日')
    expect(fmtCommentTime(new Date(2024, 5, 7).getTime(), now)).toBe('2024/6/7')
    expect(fmtCommentTime(0, now)).toBe('')
    expect(fmtCommentTime(NaN, now)).toBe('')
  })
})

describe('评论来源解析', () => {
  const item = { id: 'kw-1', source: 'kw', name: '晴天（Live）', singer: '周杰伦', songmid: '1' } as MusicItem
  const wyHit = { id: 'wy-1', source: 'wy', name: '晴天', singer: '周杰伦 / 编曲', songmid: '2' } as MusicItem
  const sources = new Map<SourceId, Partial<MusicSource>>()
  const getSource = ((id: SourceId) => sources.get(id) ?? {}) as (id: SourceId) => MusicSource
  const hasSource = (id: SourceId) => sources.has(id)

  it('本源有评论接口：直接用，不标借源', async () => {
    sources.set('kw', { getComments: async () => ({ list: [], total: 0, more: false, page: 1, limit: 20 }) })
    expect(await resolveCommentTarget(item, getSource, hasSource)).toEqual({ source: 'kw', item, borrowed: false })
  })

  it('本源没有评论：只在歌名与歌手都匹配时借网易云同名歌', async () => {
    sources.clear()
    sources.set('wy', { musicSearch: async () => ({ list: [wyHit], total: 1, page: 1, limit: 10 }) })
    expect(await resolveCommentTarget(item, getSource, hasSource)).toEqual({ source: 'wy', item: wyHit, borrowed: true })
    sources.set('wy', { musicSearch: async () => ({ list: [{ ...wyHit, singer: '别人' }], total: 1, page: 1, limit: 10 }) })
    expect(await resolveCommentTarget(item, getSource, hasSource)).toBeNull()
  })

  it('测试桩没有 musicSearch、wy 未注册或搜索抛错都不崩', async () => {
    sources.clear()
    sources.set('wy', {})
    expect(await resolveCommentTarget(item, getSource, hasSource)).toBeNull()
    expect(await resolveCommentTarget({ ...item, source: 'mg' }, getSource, () => false)).toBeNull()
    sources.set('wy', { musicSearch: async () => { throw new Error('offline') } })
    expect(await resolveCommentTarget(item, getSource, hasSource)).toBeNull()
    expect(await resolveCommentTarget(null, getSource, hasSource)).toBeNull()
  })
})
