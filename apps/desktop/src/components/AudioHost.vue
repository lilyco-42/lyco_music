<script setup lang="ts">
/**
 * <audio> 宿主 —— 内核不认识 DOM，播放元素只能放在组件里。
 *
 * 职责很窄：持有 audio 元素，把内核算出来的 url 灌进去，
 * 再把进度/时长/播放状态回灌给 player store。
 */
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { setPlaybackHandler, setSeekHandler, usePlayer } from '@/lib/player'

const player = usePlayer()
const el = ref<HTMLAudioElement | null>(null)

onMounted(() => {
  // 把「播放这个地址」的能力注入内核侧的状态机
  setPlaybackHandler(async (url: string) => {
    const a = el.value
    if (!a) return
    a.src = url
    a.volume = player.state.volume
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
  setPlaybackHandler(null)
  setSeekHandler(null)
})

watch(() => player.state.playing, p => {
  const a = el.value
  if (!a || !a.src) return
  if (p) void a.play().catch(() => { /* 自动播放被拦截时保持暂停态 */ })
  else a.pause()
})

watch(() => player.state.volume, v => {
  if (el.value) el.value.volume = v
})

function onTime(): void {
  if (el.value) player.reportTime(el.value.currentTime)
}
function onMeta(): void {
  if (el.value && Number.isFinite(el.value.duration)) player.reportDuration(el.value.duration)
}
function onEnded(): void {
  // 自动进下一首要遵守播放模式（单曲循环/随机/顺序），所以传 auto=true
  void player.next(true)
}
function onError(): void {
  // 只有真的设置了 src 才报错，否则页面加载完就会误报
  if (el.value?.src) player.setError('音频加载失败，可能是地址已过期或网络受限')
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
    @ended="onEnded"
    @play="player.setPlaying(true)"
    @pause="player.setPlaying(false)"
    @error="onError"
  />
</template>
