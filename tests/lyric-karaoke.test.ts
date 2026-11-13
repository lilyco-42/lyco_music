import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { canKaraoke, karaokeSpans } from '../apps/desktop/src/lib/lyric-karaoke'

const root = fileURLToPath(new URL('..', import.meta.url))

const words = [
  { time: 1, duration: 0.3, text: '晴' },
  { time: 1.4, duration: 0.3, text: '天' },
  { time: 2.2, duration: 0.3, text: '呀' },
]

describe('歌词逐字高亮', () => {
  it('默认关闭：绝不按字数猜唱到第几个字', () => {
    expect(karaokeSpans('晴天呀', words, 1.5, false)).toBeNull()
    expect(canKaraoke(words, false)).toBe(false)
  })

  it('打开但没有真实逐字时间轴：退回整行高亮', () => {
    expect(karaokeSpans('晴天呀', null, 1.5, true)).toBeNull()
    expect(karaokeSpans('晴天呀', [], 1.5, true)).toBeNull()
    expect(karaokeSpans('晴天呀', [{ time: 1, text: '' }], 1.5, true)).toBeNull()
  })

  it('只有真实时间轴才按 word.time 上色', () => {
    expect(karaokeSpans('晴天呀', words, 0.5, true)).toEqual([
      { text: '晴', sung: false }, { text: '天', sung: false }, { text: '呀', sung: false },
    ])
    expect(karaokeSpans('晴天呀', words, 1.2, true)).toEqual([
      { text: '晴', sung: true }, { text: '天', sung: false }, { text: '呀', sung: false },
    ])
    expect(karaokeSpans('晴天呀', words, 3, true)?.every(w => w.sung)).toBe(true)
    expect(canKaraoke(words, true)).toBe(true)
  })

  it('播放器源码不再有均分伪逐字，且评论正文是实色', () => {
    const player = readFileSync(resolve(root, 'apps/desktop/src/views/Player.vue'), 'utf8')
    expect(player).not.toMatch(/litChars|wordSung/)
    expect(player).toMatch(/currentKaraoke\(\)/)
    expect(player).toMatch(/text-ncmd-fg[^/]*leading-\[24px\]|leading-\[24px\] text-ncmd-fg/)
    expect(player).not.toMatch(/text-ncmd-fg\/90/)
  })
})
