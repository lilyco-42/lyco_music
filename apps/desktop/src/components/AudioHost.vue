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
import { setPlaybackHandler, setSeekHandler, usePlayer } from '@/lib/player'
import { bindAudioElement, useEqualizer } from '@/lib/equalizer'

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

onMounted(() => {
  // 音效图需要一个真实的 <audio> 元素；只有用户开过音效才会真正接上
  bindAudioElement(el.value)
  // 启动时若音效是开的，建图失败要能反映到设置界面
  if (eq.enabled.value) eq.setEnabled(true)
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
    a.playbackRate = player.state.rate
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

onBeforeUnmount(() => {
  clearWatchdog()
  setPlaybackHandler(null)
  setSeekHandler(null)
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

watch(() => player.state.rate, r => {
  if (el.value) el.value.playbackRate = r
})

function onTime(): void {
  if (el.value) player.reportTime(el.value.currentTime)
}
function onMeta(): void {
  if (el.value && Number.isFinite(el.value.duration)) player.reportDuration(el.value.duration)
}
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
