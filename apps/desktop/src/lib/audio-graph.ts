/**
 * Web Audio 图（桌面端）—— 均衡器 / 混响 / 环绕 / 频谱共用这一张图。
 *
 *   <audio> → 10 段 peaking → ┬→ dry ────────────┬→ panner → analyser → 扬声器
 *                            └→ convolver → wet ─┘
 *
 * 为什么必须只有一个模块持有这张图：**一个 <audio> 只能
 * createMediaElementSource 一次**，第二次调用直接抛 InvalidStateError。
 * 以前只有均衡器在建图，现在混响/环绕/频谱都要接进来，谁先建谁就是唯一入口，
 * 散着写必然出现「开了均衡器就打不开环绕」。
 *
 * 图一旦建立就拆不掉（规范限制），所以：
 *   - 关掉某个效果 = 把对应节点的增益归零 / 断开那一支，而不是删节点；
 *   - 用户完全没开过任何音效时**不建图**，保持最原始的直通播放路径。
 */
import { ref } from 'vue'

export const EQ_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const

export interface AudioGraph {
  ctx: AudioContext
  source: MediaElementAudioSourceNode
  filters: BiquadFilterNode[]
  /** 均衡器之后、混响之前 */
  eqTail: GainNode
  dry: GainNode
  wet: GainNode
  /** 混响支路上的卷积器，开启混响时才创建 */
  convolver: ConvolverNode | null
  panner: StereoPannerNode
  /** 环绕的自动摆动（LFO） */
  lfo: OscillatorNode | null
  lfoDepth: GainNode | null
  analyser: AnalyserNode
}

let graph: AudioGraph | null = null
let failed = false
let boundEl: HTMLAudioElement | null = null

/** 建图失败的原因（界面上如实显示，而不是假装开着） */
const failure = ref('')

export function bindAudioElement(el: HTMLAudioElement | null): void {
  boundEl = el
}

export function graphFailure(): string {
  return failure.value
}

export function graphReady(): boolean {
  return Boolean(graph)
}

export function ensureGraph(): AudioGraph | null {
  if (graph) return graph
  if (failed || !boundEl) return null
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) throw new Error('当前环境不支持 Web Audio')
    const ctx = new Ctor()
    const source = ctx.createMediaElementSource(boundEl)

    const filters = EQ_BANDS.map((freq, i) => {
      const f = ctx.createBiquadFilter()
      f.type = 'peaking'
      f.frequency.value = freq
      // 31/62Hz 用宽一点的 Q，否则低音会「嗡嗡」；高频收窄更精确
      f.Q.value = i < 2 ? 0.7 : 1.0
      f.gain.value = 0
      return f
    })
    const eqTail = ctx.createGain()
    const dry = ctx.createGain()
    const wet = ctx.createGain()
    const panner = ctx.createStereoPanner()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    analyser.smoothingTimeConstant = 0.75

    // source → 滤波器链 → eqTail
    let chain: AudioNode = source
    for (const f of filters) {
      chain.connect(f)
      chain = f
    }
    chain.connect(eqTail)

    // eqTail → dry → panner；混响支路稍后接（convolver 懒建）
    eqTail.connect(dry)
    dry.connect(panner)
    wet.gain.value = 0
    wet.connect(panner)
    panner.connect(analyser)
    analyser.connect(ctx.destination)

    graph = { ctx, source, filters, eqTail, dry, wet, convolver: null, panner, lfo: null, lfoDepth: null, analyser }
    void ctx.resume()
    return graph
  } catch (e) {
    failed = true
    failure.value = e instanceof Error ? e.message : String(e)
    console.warn('[lxmn] 音效不可用，已回退到直通播放：', e)
    graph = null
    return null
  }
}

/** 频谱数据（3.20）。没建图时返回 null，调用方据此不画 */
export function getAnalyser(): AnalyserNode | null {
  return graph?.analyser ?? null
}

/**
 * 合成一段混响脉冲响应。
 *
 * 不打包 IR 音频文件：那要么多几百 KB 资源、要么得让用户自己找。
 * 这里用「指数衰减的白噪声 + 左右声道轻微去相关」合成，听感接近大厅混响，
 * 而且参数（时长）可以直接由强度推出来。
 */
function buildImpulse(ctx: AudioContext, seconds: number): AudioBuffer {
  const rate = ctx.sampleRate
  const length = Math.max(1, Math.floor(rate * seconds))
  const buffer = ctx.createBuffer(2, length, rate)
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch)
    for (let i = 0; i < length; i++) {
      // 衰减曲线：前 10ms 保留一点直达声感，之后指数衰减
      const t = i / length
      const decay = Math.pow(1 - t, 2.6)
      // 左右声道用不同的伪随机相位，避免听感「在正中间糊成一团」
      const jitter = ch === 0 ? 1 : 0.92
      data[i] = (Math.random() * 2 - 1) * decay * jitter
    }
  }
  return buffer
}

/** 混响强度 0..1（0 = 关闭）。开启时按强度生成 IR */
export function setReverb(amount: number): boolean {
  const g = ensureGraph()
  if (!g) return false
  const v = Math.max(0, Math.min(1, amount))
  if (v <= 0) {
    g.wet.gain.setTargetAtTime(0, g.ctx.currentTime, 0.05)
    if (g.convolver) {
      // 断开以省 CPU：卷积器即使 wet=0 也会一直算
      try { g.eqTail.disconnect(g.convolver) } catch { /* 已经断开 */ }
      g.convolver = null
    }
    g.dry.gain.setTargetAtTime(1, g.ctx.currentTime, 0.05)
    return true
  }
  if (!g.convolver) {
    const conv = g.ctx.createConvolver()
    // 强度越大，尾巴越长（0.8s ~ 3.2s）
    conv.buffer = buildImpulse(g.ctx, 0.8 + v * 2.4)
    g.eqTail.connect(conv)
    conv.connect(g.wet)
    g.convolver = conv
  }
  g.wet.gain.setTargetAtTime(v * 0.75, g.ctx.currentTime, 0.05)
  // 干声略降，避免「湿声叠上去整体变大破音」
  g.dry.gain.setTargetAtTime(1 - v * 0.25, g.ctx.currentTime, 0.05)
  return true
}

/**
 * 3D 环绕：让声音在左右之间缓慢摆动。
 *
 * 真正用 HRTF 的 PannerNode 对双声道音乐没有意义（它按单点声源算方位），
 * 反而会让人声听起来「偏到一边」。这里用 StereoPanner + 低频 LFO，
 * 是「环绕」这个诉求下最不容易出错的做法。
 */
export function setPanner(amount: number, speed: number): boolean {
  const g = ensureGraph()
  if (!g) return false
  const depth = Math.max(0, Math.min(1, amount))
  const hz = Math.max(0.02, Math.min(2, speed))
  if (depth <= 0) {
    if (g.lfo) {
      try { g.lfo.stop() } catch { /* 已停 */ }
      try { g.lfo.disconnect() } catch { /* 已断开 */ }
      g.lfo = null
      g.lfoDepth = null
    }
    g.panner.pan.setTargetAtTime(0, g.ctx.currentTime, 0.1)
    return true
  }
  if (!g.lfo) {
    const lfo = g.ctx.createOscillator()
    lfo.type = 'sine'
    const gain = g.ctx.createGain()
    lfo.connect(gain)
    gain.connect(g.panner.pan)
    lfo.start()
    g.lfo = lfo
    g.lfoDepth = gain
  }
  g.lfo.frequency.setTargetAtTime(hz, g.ctx.currentTime, 0.1)
  g.lfoDepth?.gain.setTargetAtTime(depth, g.ctx.currentTime, 0.1)
  return true
}
