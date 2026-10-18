<script setup lang="ts">
/**
 * 底部播放条 —— 实测规格：
 * 高 102px，背景 #FBFCFE，贴顶进度条高 3~4px 全宽
 * 左侧歌名/歌手左边距 50px；中央控制区中心 x=960；播放按钮 52x52 圆形
 * 右侧从 x≈1642 起：音质 / 词 / 音量 / 更多
 */
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { ListMusic, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward } from 'lucide-vue-next'
import { parseLyric, findLineIndex } from '@lxmn/core'
import { usePlayer } from '@/lib/player'
import IconButton from '@/components/ui/IconButton.vue'
import QualityMenu from '@/components/layout/QualityMenu.vue'

const router = useRouter()
const player = usePlayer()

const track = computed(() => player.current.value)

/** 实际在播的那条（串源后与队列里的可能不同）：封面/标签都跟它走 */
const playingItem = computed(() => player.state.playingItem ?? player.current.value)
const playing = computed(() => player.state.playing)

/** 封面：优先用实际在播曲目的图；没有就退回内置占位图，避免出现破图 */
const cover = computed(() => player.state.picUrl || './art/cover-default.jpg')

function openPlayer(): void {
  void router.push({ name: 'player' })
}

/** 桌面歌词浮层状态放在 player store：底栏「词」按钮与 L 快捷键共用同一份 */
const showLyric = computed(() => player.state.lyricOpen)
function toggleLyric(): void { player.toggleLyric() }

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

/** 播放模式：循环图标随模式变化，点一下切下一档 */
const modeIcon = computed(() => {
  if (player.state.mode === 'single') return Repeat1
  if (player.state.mode === 'shuffle') return Shuffle
  return Repeat
})
const modeLabel = computed(() => player.modeLabel())
function cycleMode(): void { player.cycleMode() }

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

    <!-- 中央控制区：图标全部走 IconButton，尺寸按 token 取 -->
    <div class="flex flex-1 items-center justify-center gap-2">
      <IconButton :label="modeLabel" size="lg" :class="player.state.mode === 'order' ? '' : 'text-ncm-accent'" @click="cycleMode">
        <template #default="{ size, stroke }">
          <component :is="modeIcon" :size="size" :stroke-width="stroke" aria-hidden="true" />
        </template>
      </IconButton>

      <IconButton label="上一首" size="2xl" :disabled="!player.state.queue.length" @click="player.prev()">
        <template #default="{ size, stroke }"><SkipBack :size="size" :stroke-width="stroke" aria-hidden="true" /></template>
      </IconButton>

      <!-- 播放/暂停：40px 圆形主按钮（网易云底栏就是这个量级） -->
      <button
        type="button"
        class="mx-1 flex size-[40px] shrink-0 items-center justify-center rounded-full bg-ncm-accent-play text-white transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-40"
        :aria-label="playing ? '暂停' : '播放'"
        :disabled="!track"
        @click="player.toggle()"
      >
        <Pause v-if="playing" :size="20" :stroke-width="0" fill="currentColor" aria-hidden="true" />
        <Play v-else :size="20" :stroke-width="0" fill="currentColor" class="translate-x-[1px]" aria-hidden="true" />
      </button>

      <IconButton label="下一首" size="2xl" :disabled="!player.state.queue.length" @click="player.next()">
        <template #default="{ size, stroke }"><SkipForward :size="size" :stroke-width="stroke" aria-hidden="true" /></template>
      </IconButton>

      <IconButton label="播放列表" size="xl">
        <template #default="{ size, stroke }"><ListMusic :size="size" :stroke-width="stroke" aria-hidden="true" /></template>
      </IconButton>
    </div>

    <!-- 右侧工具区：从 x≈1642 起 -->
    <div class="flex w-[430px] shrink-0 items-center justify-end gap-[29px] pr-[49px] text-ncm-faint">
      <QualityMenu />
      <button
        type="button"
        class="text-[15px] [app-region:no-drag]"
        :class="showLyric ? 'text-ncm-accent' : 'hover:text-ncm-fg'"
        aria-label="桌面歌词"
        :aria-pressed="showLyric"
        @click="toggleLyric"
      >词</button>

      <!-- 音量 -->
      <div class="flex items-center gap-2">
        <svg viewBox="0 0 24 24" class="size-5 stroke-current" fill="none" stroke-width="1.8" aria-hidden="true">
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
        <button type="button" class="text-[13px] text-ncm-faint hover:text-ncm-fg" @click="toggleLyric">收起</button>
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
