/**
 * 定时暂停（睡眠定时器）
 *
 * 睡前听歌的刚需：设 30 分钟，到点自动暂停，不会整夜放着耗电。
 * 为什么不用 setTimeout 一次到底：用户要看「还剩 12 分钟」，而且系统休眠
 * 回来之后 setTimeout 可能已经漂了。这里存的是**截止时间戳**，每秒用
 * 当前时间重算一次，休眠唤醒后也能算对。
 */
import { computed, ref } from 'vue'
import { usePlayer } from './player'
import { toast } from './toast'

const MINUTE = 60_000
const OPTIONS = [15, 30, 45, 60] as const

/** 截止时间戳，0 表示没开 */
const deadline = ref(0)
/** 每秒刷新的「现在」，只为了让 remaining 这个 computed 有依赖 */
const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | undefined

function stopTicker(): void {
  if (ticker !== undefined) {
    clearInterval(ticker)
    ticker = undefined
  }
}

function fire(): void {
  stopTicker()
  deadline.value = 0
  // 只暂停、不切歌：用户睡前可能还想接着听这首
  const player = usePlayer()
  if (player.state.playing) player.toggle()
  toast('定时暂停：已暂停播放')
}

function tick(): void {
  now.value = Date.now()
  if (deadline.value && now.value >= deadline.value) fire()
}

export function useSleepTimer() {
  const remainingMs = computed(() => (deadline.value ? Math.max(0, deadline.value - now.value) : 0))
  const active = computed(() => deadline.value > 0)
  /** 12:34 这样的倒计时文本 */
  const label = computed(() => {
    const total = Math.round(remainingMs.value / 1000)
    if (!total) return ''
    const m = Math.floor(total / 60)
    const s = total % 60
    return `${m}:${String(s).padStart(2, '0')}`
  })

  function start(minutes: number): void {
    stopTicker()
    const m = Math.max(1, Math.min(240, Math.round(minutes)))
    deadline.value = Date.now() + m * MINUTE
    now.value = Date.now()
    ticker = setInterval(tick, 1000)
    toast(`定时暂停：${m} 分钟后暂停`)
  }

  function cancel(): void {
    stopTicker()
    deadline.value = 0
    toast('已取消定时暂停')
  }

  return { remainingMs, label, active, start, cancel, OPTIONS }
}
