/**
 * 频谱数据泵（PARITY 3.20）。
 *
 * 数据流：主窗口的 AnalyserNode → 这里取 24 根柱 → IPC → 主进程转发 →
 * 歌词窗口的 canvas。绕这一圈是必须的：歌词窗口是独立渲染进程，
 * 碰不到主窗口的 Web Audio 上下文。
 *
 * 三个刻意的地方：
 *   1. **只在需要时才跑**。每 1.5 秒问一次「歌词窗口开着吗、开了频谱吗」，
 *      两个都成立才建图 + 启动 rAF。没人看的时候一点 CPU 都不花。
 *   2. **20 帧/秒**。60 帧推 IPC 只是让歌词窗口的合成器白忙，
 *      视觉上和 20 帧看不出区别（柱子本来就在平滑衰减）。
 *   3. **只传 24 个数**（0–255 取整）。传 Float32Array 会让结构化克隆
 *      每次多分配一块内存，而柱状图根本不需要这个精度。
 */
import { ensureGraph, getAnalyser } from './audio-graph'

/** 柱数：桌面歌词窗口通常很宽，24 根刚好不糊也不稀 */
export const SPECTRUM_BARS = 24

let timer: ReturnType<typeof setInterval> | undefined
let raf = 0
let running = false

/** 把频域数据压成 24 根柱（对数分组，低频不会被挤成一坨） */
function sample(analyser: AnalyserNode): number[] {
  const data = new Uint8Array(analyser.frequencyBinCount)
  analyser.getByteFrequencyData(data)
  const out: number[] = []
  const usable = Math.floor(data.length * 0.72) // 高频段基本是空的，丢掉
  for (let i = 0; i < SPECTRUM_BARS; i++) {
    // 对数刻度：人耳对低频的分辨率远高于高频
    const from = Math.floor(Math.pow(usable, i / SPECTRUM_BARS))
    const to = Math.max(from + 1, Math.floor(Math.pow(usable, (i + 1) / SPECTRUM_BARS)))
    let sum = 0
    for (let j = from; j < to && j < data.length; j++) sum += data[j] ?? 0
    const avg = sum / Math.max(1, to - from)
    out.push(Math.max(0, Math.min(255, Math.round(avg))))
  }
  return out
}

function start(): void {
  if (running) return
  const analyser = getAnalyser()
  if (!analyser) return
  running = true
  let last = 0
  const tick = (now: number): void => {
    if (!running) return
    raf = requestAnimationFrame(tick)
    if (now - last < 50) return
    last = now
    try {
      window.lxmnNative?.lyric?.pushSpectrum(sample(analyser))
    } catch {
      // 窗口正在关：下一轮轮询会把它停掉
    }
  }
  raf = requestAnimationFrame(tick)
}

function stop(): void {
  running = false
  if (raf) cancelAnimationFrame(raf)
  raf = 0
}

export function installSpectrumBridge(): void {
  if (typeof window === 'undefined') return
  const api = window.lxmnNative?.lyric
  if (!api?.pushSpectrum) return
  // 歌词窗口自己也跑 main.ts，它没有音频图，别在那儿空转
  if (window.location.hash.includes('lyric-window')) return
  if (timer) return

  const check = async (): Promise<void> => {
    try {
      const open = await api.isOpen()
      if (!open) { stop(); return }
      const style = await api.getStyle()
      if (!style.showSpectrum) { stop(); return }
      if (!ensureGraph()) return
      start()
    } catch {
      stop()
    }
  }
  void check()
  timer = setInterval(() => { void check() }, 1500)
}
