/**
 * 歌词导出（LRC）与三层歌词解析的单测
 *
 * 导出格式是「用户会拿给别的播放器用」的东西，时间戳写错就是整份文件作废，
 * 所以这里逐条钉住：时间格式、翻译/罗马音的时间戳复用、纯文本歌词不打时间轴。
 */
import { describe, it, expect } from 'vitest'
import { parseLyric } from '@lxmn/core'
import { buildLrc, lrcTime } from '../apps/desktop/src/lib/lrc-export'

describe('lrcTime', () => {
  it('补两位分钟与两位小数', () => {
    expect(lrcTime(0)).toBe('[00:00.00]')
    expect(lrcTime(65.5)).toBe('[01:05.50]')
    expect(lrcTime(9.05)).toBe('[00:09.05]')
  })

  it('超过 99 分钟不截断', () => {
    expect(lrcTime(6000)).toBe('[100:00.00]')
  })

  it('负数与非法值归零', () => {
    expect(lrcTime(-3)).toBe('[00:00.00]')
    expect(lrcTime(Number.NaN)).toBe('[00:00.00]')
  })
})

describe('buildLrc', () => {
  const lines = [
    { time: 0, text: '君の名前を呼ぶ' },
    { time: 12.34, text: '夜が明けるまで', translation: '直到天亮' },
  ]

  it('带元信息头', () => {
    const out = buildLrc({ title: 'Cry For Me', artist: 'Michita', album: 'Pureness' }, lines)
    expect(out).toContain('[ti:Cry For Me]')
    expect(out).toContain('[ar:Michita]')
    expect(out).toContain('[al:Pureness]')
    expect(out).toContain('[by:Lyco Music]')
  })

  it('翻译另起一行，但复用原文时间戳', () => {
    const out = buildLrc({}, lines)
    expect(out).toContain('[00:12.34]夜が明けるまで')
    expect(out).toContain('[00:12.34]直到天亮')
  })

  it('罗马音排在翻译之前', () => {
    const out = buildLrc({}, [{ time: 1, text: '君', romaji: 'kimi', translation: '你' }])
    const body = out.split('\n').filter(l => l.startsWith('[00:01'))
    expect(body).toEqual(['[00:01.00]君', '[00:01.00]kimi', '[00:01.00]你'])
  })

  it('纯文本歌词不打时间标签', () => {
    const out = buildLrc({}, [{ time: 0, text: '第一句' }, { time: 1, text: '第二句' }], true)
    expect(out).toContain('\n第一句\n第二句')
    expect(out).not.toMatch(/\[\d{2}:\d{2}\.\d{2}\]/)
  })
})

describe('parseLyric 三层', () => {
  const lyric = '[00:01.00]君の名前\n[00:05.00]夜が明ける'
  const tlyric = '[00:01.00]你的名字\n[00:05.00]直到天亮'
  const romalrc = '[00:01.00]kimi no namae\n[00:05.00]yoru ga akeru'

  it('同时给出原文/罗马音/翻译', () => {
    const p = parseLyric(lyric, tlyric, romalrc)
    expect(p.hasTranslation).toBe(true)
    expect(p.hasRomaji).toBe(true)
    expect(p.lines[0]).toMatchObject({ text: '君の名前', romaji: 'kimi no namae', translation: '你的名字' })
  })

  it('没有罗马音时不标记 hasRomaji', () => {
    const p = parseLyric(lyric, tlyric)
    expect(p.hasRomaji).toBe(false)
    expect(p.lines[0]?.romaji).toBeUndefined()
  })

  it('罗马音与原文时间差太多就不硬塞', () => {
    const off = '[00:03.00]kimi no namae'
    const p = parseLyric(lyric, null, off)
    expect(p.lines[0]?.romaji).toBeUndefined()
    expect(p.hasRomaji).toBe(false)
  })
})
