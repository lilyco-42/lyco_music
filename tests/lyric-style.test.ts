import { describe, it, expect } from 'vitest'
import {
  DEFAULT_LYRIC_STYLE,
  LYRIC_FONTS,
  LYRIC_FONT_MAX,
  LYRIC_FONT_MIN,
  LYRIC_LINE_PIN,
  lyricScrollDelta,
  normalizeLyricStyle,
  strokePaint,
} from '../apps/desktop/src/lib/lyric-style'

/**
 * 桌面歌词样式的归一化。
 *
 * 这些值会直接写进内联 style。一旦是 NaN / 空串 / 非法颜色，
 * 表现是「歌词看不见了」而控制台什么都不报 —— 所以每个入口都必须过归一化。
 */
describe('歌词样式归一化', () => {
  it('空输入退回默认值', () => {
    expect(normalizeLyricStyle(null)).toEqual(DEFAULT_LYRIC_STYLE)
    expect(normalizeLyricStyle(undefined)).toEqual(DEFAULT_LYRIC_STYLE)
    expect(normalizeLyricStyle({})).toEqual(DEFAULT_LYRIC_STYLE)
  })

  it('字号夹在范围内，NaN / 字符串数字都能吃', () => {
    expect(normalizeLyricStyle({ fontSize: 5 }).fontSize).toBe(LYRIC_FONT_MIN)
    expect(normalizeLyricStyle({ fontSize: 999 }).fontSize).toBe(LYRIC_FONT_MAX)
    expect(normalizeLyricStyle({ fontSize: Number.NaN }).fontSize).toBe(DEFAULT_LYRIC_STYLE.fontSize)
    expect(normalizeLyricStyle({ fontSize: '40' as unknown as number }).fontSize).toBe(40)
    // 小数要取整：34.6px 这种字号会让行高计算出现半像素
    expect(normalizeLyricStyle({ fontSize: 34.6 }).fontSize).toBe(35)
  })

  it('非法颜色不生效，回退到默认而不是变成透明', () => {
    expect(normalizeLyricStyle({ playedColor: 'red' }).playedColor).toBe(DEFAULT_LYRIC_STYLE.playedColor)
    expect(normalizeLyricStyle({ playedColor: '#FFF' }).playedColor).toBe(DEFAULT_LYRIC_STYLE.playedColor)
    expect(normalizeLyricStyle({ playedColor: '#ABCDEF' }).playedColor).toBe('#abcdef')
  })

  it('旧版本只有一个 color 字段时，两行颜色都继承它', () => {
    const s = normalizeLyricStyle({ color: '#ffec90' })
    expect(s.playedColor).toBe('#ffec90')
    expect(s.unplayedColor).toBe('#ffec90')
  })

  it('未知字体栈被拒绝（填错字体名的表现是「看起来没生效」）', () => {
    const kai = LYRIC_FONTS.find(f => f.id === 'kai')!
    expect(normalizeLyricStyle({ fontFamily: kai.stack }).fontFamily).toBe(kai.stack)
    expect(normalizeLyricStyle({ fontFamily: 'Comic Sans' }).fontFamily).toBe('')
  })

  it('描边 0~3，行数只能是 1 或 2', () => {
    expect(normalizeLyricStyle({ stroke: -1 }).stroke).toBe(0)
    expect(normalizeLyricStyle({ stroke: 9 }).stroke).toBe(3)
    expect(normalizeLyricStyle({ lines: 1 }).lines).toBe(1)
    expect(normalizeLyricStyle({ lines: 2 }).lines).toBe(2)
    expect(normalizeLyricStyle({ lines: 3 }).lines).toBe(2)
  })

  it('以 base 为兜底：只改一个字段时其余保持不变', () => {
    const base = normalizeLyricStyle({ fontSize: 48, stroke: 3, lines: 1 })
    const next = normalizeLyricStyle({ stroke: 0 }, base)
    expect(next).toMatchObject({ fontSize: 48, stroke: 0, lines: 1 })
  })
})

describe('描边', () => {
  it('0 档只有柔和阴影，不加描边', () => {
    const p = strokePaint(0)
    expect(p.textShadow).toBe('0 2px 10px rgba(0,0,0,.85)')
    expect(p.webkitTextStroke).toBeUndefined()
  })

  it('1~3 档用 text-stroke，宽度是档位的两倍（居中描边靠 paint-order 盖掉内侧）', () => {
    expect(strokePaint(1).webkitTextStroke).toBe('2px rgba(0,0,0,.9)')
    expect(strokePaint(2).webkitTextStroke).toBe('4px rgba(0,0,0,.9)')
    expect(strokePaint(3).webkitTextStroke).toBe('6px rgba(0,0,0,.9)')
    // 没有 paint-order 的话填充会被描边盖住，字会变细一圈
    expect(strokePaint(2).paintOrder).toBe('stroke fill')
  })

  it('不再用多方向 text-shadow 拼描边（8 方向会露出锯齿）', () => {
    expect(strokePaint(3).textShadow).toBe('0 2px 10px rgba(0,0,0,.85)')
  })

  it('越界档位被夹住', () => {
    expect(strokePaint(99)).toEqual(strokePaint(3))
    expect(strokePaint(-5)).toEqual(strokePaint(0))
  })
})

describe('歌词滚动偏移', () => {
  const box = { boxHeight: 300, lineTop: 400, lineHeight: 30 }

  it('居中模式：当前行落在可视区正中', () => {
    // 400 - 300/2 + 30/2 = 265 → 滚动后行顶到 135，行中 150 = 300/2
    expect(lyricScrollDelta('center', box)).toBe(265)
  })

  it('逐行模式：当前行钉在顶部留白处', () => {
    expect(lyricScrollDelta('line', box)).toBe(400 - LYRIC_LINE_PIN)
  })

  it('两种模式在第一行时偏移方向不同（逐行会先往上滚一点）', () => {
    const first = { boxHeight: 300, lineTop: 0, lineHeight: 30 }
    expect(lyricScrollDelta('center', first)).toBe(-135)
    expect(lyricScrollDelta('line', first)).toBe(-LYRIC_LINE_PIN)
  })
})
