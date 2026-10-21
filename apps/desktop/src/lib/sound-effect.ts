/**
 * 环境音效（PARITY 2.4 的剩下三块）：混响 / 3D 环绕 / 升降调。
 *
 * 三项都在**同一张音频图**上（见 audio-graph.ts），和均衡器共用，
 * 否则会踩「一个 <audio> 只能 createMediaElementSource 一次」的坑。
 *
 * 关于升降调的实现，必须说清楚：
 *   真正「变速不变调 / 变调不变速」需要相位声码器（几十行 DSP + 音质损耗），
 *   lx-music 自己也没做 —— 它的 pitchShifter 就是改 `playbackRate` 并关掉
 *   `preservesPitch`，也就是**变调的同时速度会变**。这里保持一致，
 *   并且界面上写明白，不让用户以为是 bug。
 *
 * 与「播放速度」的关系：两者都落在 `playbackRate` 上，实际速率是
 * `播放速度 × 变调比`。开了变调时 preservesPitch 必须关掉，否则变调没效果。
 */
import { computed, ref } from 'vue'
import { ensureGraph, setPanner, setReverb } from './audio-graph'

const KEY = 'lxmn.sound.effect.v1'

/** 半音 -> 速率。+12 半音 = 2 倍速，-12 = 半速 */
export function semitoneRate(semitones: number): number {
  return Math.pow(2, Math.max(-12, Math.min(12, semitones)) / 12)
}

export const PITCH_OPTIONS = [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6] as const

interface Stored {
  reverb: number
  panner: number
  pannerSpeed: number
  semitones: number
}

function read(): Stored {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const p = JSON.parse(raw) as Partial<Stored>
      const num = (v: unknown, fb: number, min: number, max: number): number => {
        const n = Number(v)
        if (!Number.isFinite(n)) return fb
        return Math.min(max, Math.max(min, n))
      }
      return {
        reverb: num(p.reverb, 0, 0, 1),
        panner: num(p.panner, 0, 0, 1),
        pannerSpeed: num(p.pannerSpeed, 0.12, 0.02, 2),
        semitones: num(p.semitones, 0, -6, 6),
      }
    }
  } catch {
    // 脏数据回落到默认
  }
  return { reverb: 0, panner: 0, pannerSpeed: 0.12, semitones: 0 }
}

const initial = read()
const reverb = ref(initial.reverb)
const panner = ref(initial.panner)
const pannerSpeed = ref(initial.pannerSpeed)
const semitones = ref(initial.semitones)
/** 建图失败原因（例如浏览器不支持 Web Audio） */
const failure = ref('')

function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      reverb: reverb.value,
      panner: panner.value,
      pannerSpeed: pannerSpeed.value,
      semitones: semitones.value,
    }))
  } catch {
    // 写不进去只影响下次启动
  }
}

export function useSoundEffect() {
  /** 变调比，供 AudioHost 算最终 playbackRate */
  const pitchRate = computed(() => semitoneRate(semitones.value))
  const active = computed(() => reverb.value > 0 || panner.value > 0 || semitones.value !== 0)

  function applyReverb(): void {
    if (reverb.value <= 0) {
      setReverb(0)
      return
    }
    // setReverb 内部会 ensureGraph；建不起来就如实标记
    if (!ensureGraph()) {
      failure.value = '当前环境不支持 Web Audio'
      reverb.value = 0
      return
    }
    failure.value = ''
    setReverb(reverb.value)
  }

  function applyPanner(): void {
    if (panner.value <= 0) {
      setPanner(0, pannerSpeed.value)
      return
    }
    if (!ensureGraph()) {
      failure.value = '当前环境不支持 Web Audio'
      panner.value = 0
      return
    }
    failure.value = ''
    setPanner(panner.value, pannerSpeed.value)
  }

  function setReverbAmount(v: number): void {
    reverb.value = Math.max(0, Math.min(1, Number(v) || 0))
    applyReverb()
    persist()
  }

  function setPannerAmount(v: number): void {
    panner.value = Math.max(0, Math.min(1, Number(v) || 0))
    applyPanner()
    persist()
  }

  function setPannerSpeed(v: number): void {
    pannerSpeed.value = Math.max(0.02, Math.min(2, Number(v) || 0.12))
    if (panner.value > 0) setPanner(panner.value, pannerSpeed.value)
    persist()
  }

  function setSemitones(v: number): void {
    const n = Number(v)
    semitones.value = Number.isFinite(n) ? Math.max(-6, Math.min(6, Math.round(n))) : 0
    persist()
  }

  /** 启动时把存下来的设置应用到图上（AudioHost 挂载后调一次） */
  function restore(): void {
    if (reverb.value > 0) applyReverb()
    if (panner.value > 0) applyPanner()
  }

  function reset(): void {
    reverb.value = 0
    panner.value = 0
    pannerSpeed.value = 0.12
    semitones.value = 0
    setReverb(0)
    setPanner(0, 0.12)
    persist()
  }

  return {
    reverb, panner, pannerSpeed, semitones,
    pitchRate, active, failure,
    setReverbAmount, setPannerAmount, setPannerSpeed, setSemitones,
    restore, reset,
    PITCH_OPTIONS,
  }
}
