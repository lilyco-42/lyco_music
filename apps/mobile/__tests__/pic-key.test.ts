/**
 * 封面去重 key。首页三张歌单卡靠它避免撞图。
 */
import { picKey } from '../src/lib/picKey'

describe('封面去重 key', () => {
  it('抹掉 wy/kg 的尺寸 query', () => {
    expect(picKey('https://p1.music.126.net/abc.jpg?param=300y300'))
      .toBe('https://p1.music.126.net/abc.jpg')
    expect(picKey('https://p1.music.126.net/abc.jpg?param=130y130'))
      .toBe('https://p1.music.126.net/abc.jpg')
  })

  it('抹掉 kw 路径里的尺寸段', () => {
    expect(picKey('https://img1.kuwo.cn/star/albumcover/500/s3s94/93/211513640.jpg'))
      .toBe('https://img1.kuwo.cn/star/albumcover/s3s94/93/211513640.jpg')
    expect(picKey('https://img1.kuwo.cn/star/albumcover/120/s3s94/93/211513640.jpg'))
      .toBe('https://img1.kuwo.cn/star/albumcover/s3s94/93/211513640.jpg')
  })

  it('同一张图的不同尺寸得到同一个 key', () => {
    const a = picKey('https://img1.kuwo.cn/star/albumcover/500/s3s94/93/211513640.jpg')
    const b = picKey('https://img1.kuwo.cn/star/albumcover/120/s3s94/93/211513640.jpg')
    expect(a).toBe(b)
  })

  it('不同封面不会被误判成同一张', () => {
    const a = picKey('https://img1.kuwo.cn/star/albumcover/500/s3s94/93/211513640.jpg')
    const b = picKey('https://img1.kuwo.cn/star/albumcover/500/s4s11/89/774616642.jpg')
    expect(a).not.toBe(b)
  })
})
