import { SLEEP_OPTIONS, fmtRemaining, normalizeSleepMinutes } from '../src/lib/sleep-timer'

describe('移动端定时暂停', () => {
  it('可选档位与桌面一致', () => {
    expect([...SLEEP_OPTIONS]).toEqual([15, 30, 45, 60])
  })

  it('剩余时间向上取整，跨小时补零', () => {
    expect(fmtRemaining(0)).toBe('00:00')
    expect(fmtRemaining(-5)).toBe('00:00')
    expect(fmtRemaining(NaN)).toBe('00:00')
    expect(fmtRemaining(14 * 60_000 + 59_000 + 1)).toBe('15:00')
    expect(fmtRemaining(60 * 60_000 + 2 * 60_000 + 3_000)).toBe('01:02:03')
  })

  it('分钟数夹到 1~240，脏值退回 15', () => {
    expect(normalizeSleepMinutes(0)).toBe(1)
    expect(normalizeSleepMinutes(999)).toBe(240)
    expect(normalizeSleepMinutes(30.4)).toBe(30)
    expect(normalizeSleepMinutes(NaN)).toBe(15)
  })
})
