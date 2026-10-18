<script setup lang="ts">
/**
 * 底部播放条 —— 实测规格：
 * 高 102px，背景 #FBFCFE，贴顶进度条高 3~4px 全宽
 * 左侧歌名/歌手左边距 50px；中央控制区中心 x=960；播放按钮 52x52 圆形
 * 右侧从 x≈1642 起：音质 / 词 / 音量 / 更多
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { parseLyric, findLineIndex } from '@lxmn/core'
import { Button } from '@/components/ui/button'
import { usePlayer } from '@/lib/player'

const router = useRouter()
const player = usePlayer()

const track = computed(() => player.current.value)
const playing = computed(() => player.state.playing)

/** 封面：优先用实际在播曲目的图；没有就退回内置占位图，避免出现破图 */
const cover = computed(() => player.state.picUrl || './art/cover-default.jpg')

function openPlayer(): void {
  void router.push({ name: 'player' })
}

/** 桌面歌词浮层（点「词」开关）—— 以前这个按钮直接跳播放页，等于没有歌词开关 */
const showLyric = ref(false)

const lyricLines = computed(() => parseLyric(player.state.lyric, player.state.tlyric).lines)
const lyricIndex = computed(() => findLineIndex(lyricLines.value, player.state.currentTime))
const lyricWindow = computed(() => {
  const lines = lyricLines.value
  if (!lines.length) return []
  const at = lyricIndex.value
  const from = Math.max(0, (at < 0 ? 0 : at) - 1)
  return lines.slice(from, from + 3).map((l, i) => ({ ...l, active: from + i === at }))
})
const hasLyric = computed(() => lyricLines.value.length > 0)

/** 进度：没有时长信息时按 0 处理，避免 NaN 宽度 */
const progress = computed(() => {
  const { currentTime, duration } = player.state
  if (!duration || !Number.isFinite(duration) || duration <= 0) return 0
  return Math.min(100, Math.max(0, (currentTime / duration) * 100))
})

const volume = computed({
  get: () => Math.round(player.state.volume * 100),
  set: v => player.setVolume(Number(v) / 100),
})

function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const t = Math.floor(sec)
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

const timeText = computed(() =>
  track.value ? `${fmtTime(player.state.currentTime)} / ${fmtTime(player.state.duration)}` : '')

/** 音质循环切换：点一下换下一档 */
const QUALITIES = ['128k', '320k', 'flac', 'flac24bit', 'hires', 'atmos', 'master'] as const
const qualityLabel = computed(() => ({
  '128k': '标准', '320k': '极高', flac: '无损', flac24bit: 'Hi-Res', hires: 'Hi-Res',
  atmos: '沉浸环绕', master: '超清母带',
}[player.state.quality] ?? player.state.quality))

function cycleQuality(): void {
  const at = QUALITIES.indexOf(player.state.quality)
  const nextQ = QUALITIES[(at + 1) % QUALITIES.length]!
  void player.setQuality(nextQ)
}

/** 播放失败时把原因显示出来（版权/VIP 等），而不是静默什么都不发生 */
const error = computed(() => player.state.error)
</script>

<template>
  <footer class="relative flex items-center bg-ncm-bottombar">
    <!-- 进度条：贴顶，高 4px，全宽 -->
    <div class="absolute inset-x-0 top-0 h-[4px] bg-ncm-divider">
      <div class="h-full bg-ncm-progress" :style="{ width: progress + '%' }" />
    </div>

    <!-- 左侧歌曲信息：左边距 50px -->
    <div class="flex w-[430px] shrink-0 items-center gap-4 pl-[28px]">
      <!-- 封面：网易云底部是一直有图的，点图进播放页 -->
      <button
        type="button"
        class="group relative size-[56px] shrink-0 overflow-hidden rounded-lg bg-ncm-divider"
        :aria-label="track ? '打开播放页' : '暂无播放'"
        :disabled="!track"
        @click="openPlayer"
      >
        <img :src="cover" alt="" class="size-full object-cover" referrerpolicy="no-referrer" />
        <span
          class="absolute inset-0 flex items-center justify-center bg-black/35 opacity-0 transition-opacity group-hover:opacity-100"
        >
          <svg viewBox="0 0 24 24" class="size-6 fill-white"><path d="M6 9l6-6 6 6M12 3v12" stroke="white" stroke-width="2" fill="none" /><path d="M12 21v-6" stroke="white" stroke-width="2" /></svg>
        </span>
      </button>

      <div class="min-w-0" :class="track ? 'cursor-pointer' : ''" @click="track && openPlayer()">
        <div class="flex items-center gap-1.5">
          <span class="truncate text-[18px] text-ncm-fg">{{ track ? track.name : '未在播放' }}</span>
        </div>
        <div class="mt-[7px] truncate text-[17px] text-ncm-faint">{{ track ? track.singer : '双击歌曲开始播放' }}</div>
        <div v-if="error" class="mt-1 truncate text-[12px] text-ncm-accent">{{ error }}</div>
        <div v-else-if="timeText" class="mt-1 text-[12px] text-ncm-fainter">{{ timeText }}</div>
      </div>

    </div>

    <!-- 中央控制区 -->
    <div class="flex flex-1 items-center justify-center gap-[31px]">
      <!-- 循环模式 -->
      <button type="button" class="text-ncm-faint hover:text-ncm-fg" aria-label="循环模式">
        <svg viewBox="0 0 24 24" class="size-[22px] stroke-current" fill="none" stroke-width="1.8">
          <path d="M17 2l4 4-4 4M7 22l-4-4 4-4M21 6H7a4 4 0 0 0-4 4M3 18h14a4 4 0 0 0 4-4" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>

      <!-- 上一首 -->
      <button type="button" class="text-ncm-fg/80 hover:text-ncm-fg" aria-label="上一首" @click="player.prev()">
        <svg viewBox="0 0 24 24" class="size-[26px] fill-current"><path d="M6 5h2v14H6zM20 5v14L9 12z" /></svg>
      </button>

      <!-- 播放/暂停（shadcn-vue Button）：52x52 圆形 -->
      <Button
        variant="default"
        class="size-[52px] rounded-full p-0 transition-transform hover:scale-105"
        :aria-label="playing ? '暂停' : '播放'"
        :disabled="!track"
        @click="player.toggle()"
      >
        <svg v-if="playing" viewBox="0 0 24 24" class="size-6 fill-current"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>
        <svg v-else viewBox="0 0 24 24" class="size-6 fill-current"><path d="M8 5v14l11-7z" /></svg>
      </Button>

      <!-- 下一首 -->
      <button type="button" class="text-ncm-fg/80 hover:text-ncm-fg" aria-label="下一首" @click="player.next()">
        <svg viewBox="0 0 24 24" class="size-[26px] fill-current"><path d="M16 5h2v14h-2zM4 5v14l11-7z" /></svg>
      </button>

      <!-- 播放列表 -->
      <button type="button" class="text-ncm-faint hover:text-ncm-fg" aria-label="播放列表">
        <svg viewBox="0 0 24 24" class="size-[22px] stroke-current" fill="none" stroke-width="1.8">
          <path d="M4 6h11M4 12h11M4 18h7M19 10v8M19 18a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z" stroke-linecap="round" />
        </svg>
      </button>
    </div>

    <!-- 右侧工具区：从 x≈1642 起 -->
    <div class="flex w-[430px] shrink-0 items-center justify-end gap-[29px] pr-[49px] text-ncm-faint">
      <span class="text-[14px] text-ncm-fg/70">{{ qualityLabel }}</span>
      <button type="button" class="text-[15px] hover:text-ncm-fg" aria-label="切换音质" @click="cycleQuality">+</button>
      <button
        type="button"
        class="text-[15px] [app-region:no-drag]"
        :class="showLyric ? 'text-ncm-accent' : 'hover:text-ncm-fg'"
        aria-label="桌面歌词"
        :aria-pressed="showLyric"
        @click="showLyric = !showLyric"
      >词</button>

      <!-- 音量 -->
      <div class="flex items-center gap-2">
        <svg viewBox="0 0 24 24" class="size-[19px] stroke-current" fill="none" stroke-width="1.8">
          <path d="M4 9v6h3l4 3V6L7 9H4ZM16 9a4 4 0 0 1 0 6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <input v-model="volume" type="range" min="0" max="100" class="h-1 w-[70px] accent-ncm-accent-play" />
      </div>

      <button type="button" class="text-[18px] leading-none hover:text-ncm-fg" aria-label="更多">…</button>
    </div>

    <!-- 桌面歌词浮层 -->
    <div
      v-if="showLyric"
      class="absolute bottom-[112px] right-[28px] w-[430px] rounded-2xl border border-ncm-divider bg-white/95 px-5 py-4 shadow-[0_12px_32px_rgba(0,0,0,.14)] backdrop-blur"
    >
      <div class="mb-2 flex items-center justify-between">
        <span class="truncate text-[13px] text-ncm-faint">{{ track ? track.name + ' · ' + track.singer : '未在播放' }}</span>
        <button type="button" class="text-[13px] text-ncm-faint hover:text-ncm-fg" @click="showLyric = false">收起</button>
      </div>
      <p v-if="!hasLyric" class="py-6 text-center text-[15px] text-ncm-fainter">暂无歌词</p>
      <template v-else>
        <p
          v-for="(l, i) in lyricWindow"
          :key="i"
          class="truncate py-1 text-[16px] leading-6 transition-colors"
          :class="l.active ? 'font-semibold text-ncm-accent' : 'text-ncm-muted'"
        >{{ l.text || '·' }}</p>
      </template>
    </div>
  </footer>
</template>
