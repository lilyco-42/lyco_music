/**
 * 歌词解析回归测试。
 *
 * 真实事故：网易云对部分曲目（播客/翻唱）只回一段没有时间标签的纯文本，
 * parseLrc 解析出 0 行，播放页就一直停在「歌词解析中…」。
 */
import { describe, it, expect } from 'vitest'
import { parseLrc, parseLyric, findLineIndex } from '@lxmn/core'

describe('parseLrc', () => {
  it('解析标准 LRC', () => {
    const r = parseLrc('[00:01.00]第一行\n[00:05.50]第二行')
    expect(r.lines).toHaveLength(2)
    expect(r.lines[0]?.time).toBe(1)
    expect(r.lines[1]?.text).toBe('第二行')
    expect(r.plain).toBeFalsy()
  })

  it('纯文本歌词不再解析成 0 行（会显示出来而不是永远「解析中」）', () => {
    const plain = '作词 : jun\n作曲 : jun\n编曲 : jun\nwu'
    const r = parseLrc(plain)
    expect(r.lines.length).toBe(4)
    expect(r.plain).toBe(true)
    expect(r.lines[3]?.text).toBe('wu')
  })

  it('纯文本歌词不会去合并翻译（时间轴是造出来的，合并只会错位）', () => {
    const r = parseLyric('作词 : jun\n作曲 : jun', '[00:00.00]lyrics by jun')
    expect(r.plain).toBe(true)
    expect(r.lines.every(l => l.translation === undefined)).toBe(true)
  })

  it('有时间的歌词不会被当成纯文本', () => {
    const r = parseLrc('[00:00.00] 演唱 : 某某\n[00:19.62]天涯的尽头是风沙')
    expect(r.plain).toBeFalsy()
    expect(r.lines).toHaveLength(2)
  })

  it('空歌词返回空行且不标 plain', () => {
    expect(parseLrc('').lines).toHaveLength(0)
    expect(parseLrc(null).lines).toHaveLength(0)
  })

  it('findLineIndex 对造出来的纯文本行不会越界', () => {
    const r = parseLrc('a\nb\nc')
    expect(findLineIndex(r.lines, 0)).toBe(0)
    expect(findLineIndex(r.lines, 99)).toBe(2)
  })
})
