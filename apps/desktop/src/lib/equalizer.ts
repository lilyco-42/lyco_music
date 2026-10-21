/**
 * 均衡器（桌面端）
 *
 * 10 段 peaking 滤波器，图本身由 `audio-graph.ts` 持有 —— 混响、环绕、频谱
 * 都要接同一张图（一个 <audio> 只能 createMediaElementSource 一次）。
 *
 * 两个必须知道的限制：
 * 1. 图一旦建立就没法「拆掉」：关闭均衡器不是断开连接，而是把增益归零。
 *    这也是图要**懒创建**的原因 —— 用户没开音效时完全不碰 Web Audio。
 * 2. 跨域媒体在某些情况下会被静音。实测我们的网易云/咪咕 CDN 都能正常出声
 *    （analyser 有能量），但换源后如果突然没声音，先关掉音效排除这一项。
 */
import { computed, ref } from 'vue'
import { bindAudioElement, ensureGraph, graphFailure, graphReady, EQ_BANDS } from './audio-graph'

export { bindAudioElement, EQ_BANDS }

/** 增益范围（dB）。±12 已经能听出明显差别，再大只会破音 */
export const EQ_GAIN_MAX = 12

export interface EqPreset {
  id: string
  name: string
  gains: readonly number[]
}

const ZERO = EQ_BANDS.map(() => 0)

export const EQ_PRESETS: readonly EqPreset[] = [
  { id: 'flat', name: '平直', gains: ZERO },
  { id: 'pop', name: '流行', gains: [-1, 0, 2, 4, 4, 2, 0, -1, -1, -2] },
  { id: 'rock', name: '摇滚', gains: [4, 3, 1, -1, -2, 0, 2, 3, 4, 4] },
  { id: 'classical', name: '古典', gains: [3, 2, 0, 0, 0, 0, -1, -2, -2, -3] },
  { id: 'jazz', name: '爵士', gains: [3, 2, 1, 2, -1, -1, 0, 1, 2, 3] },
  { id: 'bass', name: '重低音', gains: [6, 5, 4, 2, 0, -1, -2, -2, -3, -3] },
  { id: 'vocal', name: '人声', gains: [-3, -2, -1, 0, 3, 5, 4, 2, 0, -1] },
  { id: 'custom', name: '自定义', gains: ZERO },
]

const KEY = 'lxmn.equalizer.v1'

interface Stored {
  enabled: boolean
  presetId: string
  gains: number[]
}

function clampGain(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.max(-EQ_GAIN_MAX, Math.min(EQ_GAIN_MAX, Math.round(v * 2) / 2))
}

function read(): Stored {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const p = JSON.parse(raw) as Partial<Stored>
      const gains = Array.isArray(p.gains) && p.gains.length === EQ_BANDS.length
        ? p.gains.map(clampGain)
        : [...ZERO]
      return {
        enabled: p.enabled === true,
        presetId: typeof p.presetId === 'string' ? p.presetId : 'flat',
        gains,
      }
    }
  } catch {
    // 隐私模式 / 脏数据都回落到默认
  }
  return { enabled: false, presetId: 'flat', gains: [...ZERO] }
}

const initial = read()
const enabled = ref(initial.enabled)
const presetId = ref(initial.presetId)
const gains = ref<number[]>(initial.gains)

function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ enabled: enabled.value, presetId: presetId.value, gains: gains.value }))
  } catch {
    // 写不进去只影响下次启动
  }
}

/* ---------------- 增益应用 ---------------- */

function applyGains(): void {
  const g = ensureGraph()
  if (!g) return
  const now = g.ctx.currentTime
  g.filters.forEach((f, i) => {
    // 用 setTargetAtTime 平滑过渡，直接赋值在拖滑块时会「咔哒」响
    f.gain.setTargetAtTime(gains.value[i] ?? 0, now, 0.02)
  })
}

/** 图建不起来时的原因，设置界面要如实显示 */
export function equalizerFailure(): string {
  return graphFailure()
}

export function useEqualizer() {
  const currentPreset = computed(() => EQ_PRESETS.find(p => p.id === presetId.value) ?? EQ_PRESETS[0]!)
  /** 建图失败时界面必须如实说「不可用」，而不是假装开了 */
  const available = computed(() => !graphFailure())

  function setEnabled(on: boolean): void {
    enabled.value = on
    if (on) {
      if (!ensureGraph()) {
        enabled.value = false
        persist()
        return
      }
      applyGains()
    } else if (graphReady()) {
      // 关掉 = 全段归零（图拆不掉），仍然是「原声」
      gains.value = [...ZERO]
      presetId.value = 'flat'
      applyGains()
    }
    persist()
  }

  function setPreset(id: string): void {
    const p = EQ_PRESETS.find(x => x.id === id)
    if (!p) return
    presetId.value = id
    if (id !== 'custom') gains.value = [...p.gains]
    if (enabled.value) applyGains()
    persist()
  }

  function setBand(index: number, gain: number): void {
    if (index < 0 || index >= EQ_BANDS.length) return
    const next = [...gains.value]
    next[index] = clampGain(gain)
    gains.value = next
    // 手动拖任意一段就进入「自定义」，否则滑块和预设名对不上
    presetId.value = 'custom'
    if (enabled.value) applyGains()
    persist()
  }

  function reset(): void {
    gains.value = [...ZERO]
    presetId.value = 'flat'
    if (enabled.value) applyGains()
    persist()
  }

  return { enabled, presetId, gains, currentPreset, available, setEnabled, setPreset, setBand, reset, presets: EQ_PRESETS, bands: EQ_BANDS }
}
