/**
 * 封面去重 key。首页三张歌单卡靠它避免撞图。
 */
import { picKey } from '../src/lib/picKey'

describe('封面去重 key', () => {
  it('抹掉 wy/kg 的尺寸 query', () => {
    expect(picKey('https://p1.music.126.net/abc.jpg?param=300y300'))
      .toBe('music.126.net/abc.jpg')
    expect(picKey('https://p1.music.126.net/abc.jpg?param=130y130'))
      .toBe('music.126.net/abc.jpg')
  })

  it('抹掉 kw 路径里的尺寸段', () => {
    expect(picKey('https://img1.kuwo.cn/star/albumcover/500/s3s94/93/211513640.jpg'))
      .toBe('img1.kuwo.cn/star/albumcover/s3s94/93/211513640.jpg')
  })

  it('同一张图的不同尺寸得到同一个 key', () => {
    const a = picKey('https://img1.kuwo.cn/star/albumcover/500/s3s94/93/211513640.jpg')
    const b = picKey('https://img1.kuwo.cn/star/albumcover/120/s3s94/93/211513640.jpg')
    expect(a).toBe(b)
  })

  it('网易同一张图换 CDN 主机也要认得是同一张', () => {
    // 实测：「热门」给 p1、「华语流行」给 p2，路径一模一样，都是《罗生门》
    const p1 = picKey('http://p1.music.126.net/yN1ke1xYMJ718FiHaDWtYQ==/109951165076380471.jpg')
    const p2 = picKey('http://p2.music.126.net/yN1ke1xYMJ718FiHaDWtYQ==/109951165076380471.jpg')
    expect(p1).toBe(p2)
    expect(p1).toBe('music.126.net/yN1ke1xYMJ718FiHaDWtYQ==/109951165076380471.jpg')
  })

  it('http 与 https 不影响判定', () => {
    expect(picKey('http://p1.music.126.net/a.jpg')).toBe(picKey('https://p1.music.126.net/a.jpg'))
  })

  it('不同封面不会被误判成同一张', () => {
    const a = picKey('http://p1.music.126.net/yN1ke1xYMJ718FiHaDWtYQ==/109951165076380471.jpg')
    const b = picKey('http://p2.music.126.net/e-Uc6W3Kug-HFHJ5nvCUPg==/109951166562828988.jpg')
    expect(a).not.toBe(b)
  })
})
