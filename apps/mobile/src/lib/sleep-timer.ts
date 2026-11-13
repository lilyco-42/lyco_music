/**
 * 移动端定时暂停。
 *
 * 与桌面端 apps/desktop/src/lib/sleep-timer.ts 同一套语义：
 * 记「截止时间戳」而不是倒计时数字 —— 后台被系统冻结后再回来，
 * 用累计减 1 的方式会少算好几分钟。到期只暂停、不切歌。
 *
 * 这里刻意不 import ../player：播放动作由调用方通过 onExpire 注入，
 * 免得 Jest 里 mock player 时把定时器一起 mock 掉。
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export const SLEEP_OPTIONS = [15, 30, 45, 60] as const

/** 剩余时间显示："14:59" / "01:00:00" */
export function fmtRemaining(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '00:00'
  const total = Math.ceil(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h ? pad(h) + ':' + pad(m) + ':' + pad(s) : pad(m) + ':' + pad(s)
}

/** 把用户传入的分钟夹到 1~240，脏数据退回 15 分钟。 */
export function normalizeSleepMinutes(minutes: number): number {
  const n = Math.round(Number(minutes))
  if (!Number.isFinite(n)) return 15
  return Math.max(1, Math.min(240, n))
}

export interface MobileSleepTimer {
  active: boolean
  label: string
  start: (minutes: number) => void
  cancel: () => void
  OPTIONS: typeof SLEEP_OPTIONS
}

export function useMobileSleepTimer(onExpire: () => void): MobileSleepTimer {
  const [deadline, setDeadline] = useState(0)
  const [label, setLabel] = useState('')
  const expire = useRef(onExpire)
  expire.current = onExpire

  useEffect(() => {
    if (!deadline) return
    const tick = (): void => {
      const left = deadline - Date.now()
      if (left <= 0) {
        setDeadline(0)
        setLabel('')
        expire.current()
        return
      }
      setLabel(fmtRemaining(left))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [deadline])

  const start = useCallback((minutes: number) => {
    const m = normalizeSleepMinutes(minutes)
    setDeadline(Date.now() + m * 60_000)
    setLabel(fmtRemaining(m * 60_000))
  }, [])

  const cancel = useCallback(() => {
    setDeadline(0)
    setLabel('')
  }, [])

  return { active: deadline > 0, label, start, cancel, OPTIONS: SLEEP_OPTIONS }
}
