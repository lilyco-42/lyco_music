<script setup lang="ts">
/**
 * <audio> 宿主 —— 内核不认识 DOM，播放元素只能放在组件里。
 *
 * 职责很窄：持有 audio 元素，把内核算出来的 url 灌进去，
 * 再把进度/时长/播放状态回灌给 player store。
 *
 * 这里还兜住两类「地址拿到了但放不出来」的现实问题（酷狗/酷我的 CDN 常态）：
 *   1. 加载报错 —— Chromium 只给一句英文（no supported source was found），
 *      交给 player 重新取流，用户看到的仍然是「正在加载」而不是报错；
 *   2. 一直不报错也不出声（CDN 挂着不回包）—— 用看门狗掐掉重来，
 *      否则界面会永远卡在加载态，用户只能自己去切歌。
 */
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { setPlaybackHandler, setSeekHandler, setStopHandler, takePendingResume, usePlayer } from '@/lib/player'
import { bindAudioElement, useEqualizer } from '@/lib/equalizer'
import { setMaxChannels, setOutputDevice } from '@/lib/audio-graph'
import { useSoundEffect } from '@/lib/sound-effect'
import { prefs } from '@/lib/prefs'

const player = usePlayer()
const el = ref<HTMLAudioElement | null>(null)

/** 多久没有任何加载进展就认为这条路走不通（秒） */
const LOAD_TIMEOUT_MS = 15000

let watchdog: ReturnType<typeof setTimeout> | undefined

function clearWatchdog(): void {
  if (watchdog !== undefined) {
    clearTimeout(watchdog)
    watchdog = undefined
  }
}

/**
 * 布下看门狗。
 *
 * 只在「本该出声却没出声」时才动手：readyState 已经到 HAVE_FUTURE_DATA(3)
 * 说明流是通的，慢慢缓冲不算故障；用户自己暂停了也不该被自动重播。
 */
function armWatchdog(): void {
  clearWatchdog()
  watchdog = setTimeout(() => {
    watchdog = undefined
    const a = el.value
    if (!a || !a.src) return
    if (a.readyState >= 3) return
    if (!player.state.loading && !player.state.playing) return
    void player.recoverStreamError()
  }, LOAD_TIMEOUT_MS)
}

const eq = useEqualizer()
const sound = useSoundEffect()

/**
 * 播放速率与变调都落在 playbackRate 上。
 *
 * - 变调比 = 2^(半音/12)；开了变调必须关掉 preservesPitch，否则音高不变（等于没做）；
 * - 两个都开时速率相乘，并夹在 [0.25, 4]：再往外 Chromium 会静音或变调失真。
 * - 换 src 会把 playbackRate 重置成 1，所以每次设 src 之后都要重灌一次。
 */
function applyRate(): void {
  const a = el.value
  if (!a) return
  const pitch = sound.pitchRate.value
  a.preservesPitch = pitch === 1
  const rate = player.state.rate * pitch
  a.playbackRate = Math.max(0.25, Math.min(4, Number.isFinite(rate) ? rate : 1))
}

onMounted(() => {
  // 音效图需要一个真实的 <audio> 元素；只有用户开过音效才会真正接上
  bindAudioElement(el.value)
  // 启动时若音效是开的，建图失败要能反映到设置界面
  if (eq.enabled.value) eq.setEnabled(true)
  sound.restore()
  applyRate()
})

onMounted(() => {
  // 把「播放这个地址」的能力注入内核侧的状态机
  setPlaybackHandler(async (url: string) => {
    const a = el.value
    if (!a) throw new Error('播放器尚未就绪')
    // 重试时拿到的地址可能和上一次完全相同，而给 src 赋同一个值不会触发重新加载，
    // 必须先清掉再设，否则「重试」是个空动作。
    if (a.src === url) {
      a.pause()
      a.removeAttribute('src')
      a.load()
    }
    a.src = url
    a.volume = player.state.volume
    // 换 src 会把 playbackRate 重置成 1，必须每次重新灌
    applyRate()
    armWatchdog()
    await a.play()
  })
})

onMounted(() => {
  setSeekHandler((t: number) => {
    const a = el.value
    if (a && a.src) a.currentTime = t
  })
})

onMounted(() => {
  /**
   * 立即停声并卸载当前音源。
   *
   * 三件事都要做，少一件都会留下「界面说没播、耳朵里有声」的错位：
   *   pause()           —— 真的停下出声；
   *   removeAttribute() —— 断开 src，避免它继续缓冲；
   *   load()            —— 让 Chromium 真正执行卸载（只删 src 不调 load 是空动作）。
   *
   * 看门狗也要清掉，否则 15 秒后会对着一个空音源触发「重试」。
   */
  setStopHandler(() => {
    clearWatchdog()
    const a = el.value
    if (!a) return
    a.pause()
    a.removeAttribute('src')
    a.load()
  })
})

onBeforeUnmount(() => {
  clearWatchdog()
  setPlaybackHandler(null)
  setSeekHandler(null)
  setStopHandler(null)
})

watch(() => player.state.playing, p => {
  const a = el.value
  if (!a || !a.src) return
  if (p) {
    void a.play().catch((e: unknown) => {
      // 自动播放被系统拦下不算故障，保持暂停态等用户点
      if (e instanceof Error && e.name === 'NotAllowedError') return
      void player.recoverStreamError()
    })
  } else {
    a.pause()
  }
})

watch(() => player.state.url, url => {
  // 取流成功但 <audio> 迟迟不开始（或地址已换），重新计时
  if (url) armWatchdog()
  else clearWatchdog()
})

watch(() => player.state.volume, v => {
  if (el.value) el.value.volume = v
})

watch(() => player.state.rate, () => applyRate())
watch(() => sound.semitones.value, () => applyRate())

function onTime(): void {
  if (el.value) player.reportTime(el.value.currentTime)
}
function onMeta(): void {
  const a = el.value
  if (!a) return
  if (Number.isFinite(a.duration)) player.reportDuration(a.duration)
  /**
   * 接着上次听（2.8）。
   *
   * 只在 loadedmetadata 之后设 currentTime —— 更早设置各版本行为不一致，
   * 有的当成「起播位置」、有的直接忽略。消费一次就清空，切歌重试时
   * 不会反复往回跳。
   */
  const resume = takePendingResume()
  if (resume && Number.isFinite(a.duration) && resume < a.duration - 1) {
    try { a.currentTime = resume } catch { /* 极少数格式不支持 seek */ }
  }
}

/**
 * 音频输出设备（2.5）。
 *
 * setSinkId 在 Chromium 里是 <audio> 上的标准方法，但设备 id 会随
 * 「默认设备变更/拔出耳机」失效 —— 失败时静默回落到系统默认，
 * 不要让用户看到一条红色报错却仍然听得到声音。
 *
 * 注意还有一条**并行的路径**：只要开过音效/频谱/最大声道数，声音就被
 * 抽进了 Web Audio 图，`<audio>.setSinkId()` 从此不起作用。那条路径由
 * audio-graph 的 `setOutputDevice()` 负责（改 AudioContext.setSinkId）。
 * 两边都设，用户不用为了换耳机去关音效。
 */
async function applySink(): Promise<void> {
  const id = prefs.outputDevice
  // 先登记：图可能还没建，建图那一刻会自动补上
  setOutputDevice(id)
  const a = el.value
  if (!a || typeof a.setSinkId !== 'function') return
  try {
    await a.setSinkId(id || '')
  } catch {
    prefs.outputDevice = ''
    setOutputDevice('')
  }
}

/**
 * 最大声道数输出（2.6）。
 *
 * 只对「声卡真有 2 声道以上」的机器有意义（外置 DAC、家庭影院、HDMI 接功放）。
 * 做不到时把开关弹回去，而不是留一个开着却没效果的假开关。
 */
function applyChannels(): void {
  if (!prefs.maxOutputChannels) {
    setMaxChannels(false)
    return
  }
  if (!setMaxChannels(true)) prefs.maxOutputChannels = false
}

onMounted(() => {
  void applySink()
  applyChannels()
})
watch(() => prefs.outputDevice, () => { void applySink() })
watch(() => prefs.maxOutputChannels, () => applyChannels())

function onReady(): void {
  clearWatchdog()
}
function onEnded(): void {
  // 自动进下一首要遵守播放模式（单曲循环/随机/顺序），所以传 auto=true
  void player.next(true)
}
function onError(): void {
  // 只有真的设置了 src 才报错，否则页面加载完就会误报
  const a = el.value
  if (!a?.src) return
  clearWatchdog()
  // 首次取流阶段的错误由 player 的取流阶梯自己处理（此时 loading 为真），
  // 这里只接「播到一半断了」和「play() 已经成功之后才报错」的情况。
  void player.recoverStreamError()
}
</script>

<template>
  <audio
    ref="el"
    class="hidden"
    preload="none"
    @timeupdate="onTime"
    @loadedmetadata="onMeta"
    @durationchange="onMeta"
    @canplay="onReady"
    @playing="onReady"
    @ended="onEnded"
    @play="player.setPlaying(true)"
    @pause="player.setPlaying(false)"
    @error="onError"
  />
</template>
