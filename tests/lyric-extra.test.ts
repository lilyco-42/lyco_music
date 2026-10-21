/**
 * 歌词的两个用户设置：繁简转换（3.4）与时间偏移（3.5）。
 *
 * 这两个都直接改「用户看到的那一行」，算错的表现是「歌词错行/高亮错句」，
 * 但界面上不会有任何报错 —— 所以必须有测试兜住。
 */
import { describe, it, expect } from 'vitest'
import { parseLyric, shiftLyric, toTraditional, toSimplified, convertLyric } from '@lxmn/core'

describe('简繁转换（3.4）', () => {
  it('简体转繁体', () => {
    expect(toTraditional('窝窝头')).toBe('窩窩頭')
    expect(toTraditional('后来')).toBe('後來')
  })

  it('繁体转简体是反向的', () => {
    expect(toSimplified('窩窩頭')).toBe('窝窝头')
    expect(toSimplified(toTraditional('爱情转移'))).toBe('爱情转移')
  })

  it('不认识的字原样保留（英文、数字、标点、生僻字）', () => {
    expect(toTraditional('abc 123 !@#')).toBe('abc 123 !@#')
    expect(toTraditional('Ω≈ç√')).toBe('Ω≈ç√')
  })

  it('空串不会变成 "undefined"', () => {
    expect(toTraditional('')).toBe('')
    expect(toSimplified('')).toBe('')
  })

  it('歌词里的时间标签不被破坏', () => {
    const lrc = '[00:12.34]后来\n[00:15.00]终于在眼泪中明白'
    const out = convertLyric(lrc, true)
    expect(out).toContain('[00:12.34]')
    expect(out).toContain('[00:15.00]')
    expect(out).toContain('後來')
    expect(out).toContain('終於在眼淚中明白')
  })

  it('关掉时原样返回', () => {
    expect(convertLyric('后来', false)).toBe('后来')
  })
})

describe('歌词偏移（3.5）', () => {
  const lrc = '[00:10.00]第一句\n[00:20.00]第二句\n[00:30.00]第三句'

  it('正数让歌词整体延后', () => {
    const p = shiftLyric(parseLyric(lrc), 2)
    expect(p.lines.map(l => l.time)).toEqual([12, 22, 32])
  })

  it('负数让歌词整体提前', () => {
    const p = shiftLyric(parseLyric(lrc), -2)
    expect(p.lines.map(l => l.time)).toEqual([8, 18, 28])
  })

  it('提前过头的时间夹到 0，不会出现负数', () => {
    const p = shiftLyric(parseLyric(lrc), -15)
    expect(p.lines[0]!.time).toBe(0)
    // 顺序仍然是递增的（同常数平移 + 夹下界，单调性不变）
    expect(p.lines.map(l => l.time)).toEqual([0, 5, 15])
  })

  it('偏移为 0 时原样返回同一个对象（省一次深拷贝）', () => {
    const parsed = parseLyric(lrc)
    expect(shiftLyric(parsed, 0)).toBe(parsed)
  })

  it('逐字时间轴一起平移，否则逐字染色会错位', () => {
    const yrc = '[10000,3000,0](10000,500,0)你(10500,500,0)好'
    const p = shiftLyric(parseLyric('[00:10.00]你好', '', '', yrc), 1)
    expect(p.lines[0]!.words?.map(w => w.time)).toEqual([11, 11.5])
  })

  it('文本不受影响', () => {
    const p = shiftLyric(parseLyric(lrc), 3)
    expect(p.lines.map(l => l.text)).toEqual(['第一句', '第二句', '第三句'])
  })

  it('非法 offset（NaN / Infinity）当作 0', () => {
    const parsed = parseLyric(lrc)
    expect(shiftLyric(parsed, Number.NaN)).toBe(parsed)
    expect(shiftLyric(parsed, Number.POSITIVE_INFINITY)).toBe(parsed)
  })
})
