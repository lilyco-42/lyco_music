/**
 * 主题强调色（纯逻辑，但如果它坏了整站配色都会错）。
 */
import { ACCENT_PRESETS, colors, getAccent, setAccent, subscribeAccent } from '../src/theme'

describe('主题强调色', () => {
  it('默认是网易红', () => {
    expect(getAccent()).toBe(ACCENT_PRESETS[0]!.color)
    expect(colors.accent).toBe(ACCENT_PRESETS[0]!.color)
  })

  it('切换后 colors.accent 跟着变，并通知订阅者', () => {
    const spy = jest.fn()
    const off = subscribeAccent(spy)
    setAccent('#3F7FE0')
    expect(getAccent()).toBe('#3F7FE0')
    expect(colors.accent).toBe('#3F7FE0')
    expect(spy).toHaveBeenCalledTimes(1)
    off()

    // 退订后不再收到通知
    setAccent('#12A594')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('预设共 6 套且 id/颜色唯一', () => {
    expect(ACCENT_PRESETS).toHaveLength(6)
    expect(new Set(ACCENT_PRESETS.map(p => p.id)).size).toBe(6)
    expect(new Set(ACCENT_PRESETS.map(p => p.color)).size).toBe(6)
  })
})
