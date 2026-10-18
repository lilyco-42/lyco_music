/**
 * 播放模式（顺序 / 列表循环 / 单曲循环 / 随机）。
 *
 * 这段逻辑完全在 JS 侧，和设备无关；之前只能靠人点，现在钉住它。
 */
import { cycleMode, getMode, modeLabel } from '../src/player'

describe('播放模式', () => {
  it('按 顺序 -> 列表循环 -> 单曲循环 -> 随机 循环', () => {
    // 起点默认 loop
    expect(modeLabel()).toBe('列表循环')
    expect(cycleMode()).toBe('single')
    expect(cycleMode()).toBe('shuffle')
    expect(cycleMode()).toBe('order')
    expect(cycleMode()).toBe('loop')
  })

  it('getMode 与 modeLabel 始终一致', () => {
    const pairs: Array<[string, string]> = [
      ['order', '顺序播放'],
      ['loop', '列表循环'],
      ['single', '单曲循环'],
      ['shuffle', '随机播放'],
    ]
    for (const [mode, label] of pairs) {
      while (getMode() !== mode) cycleMode()
      expect(modeLabel()).toBe(label)
    }
  })
})
