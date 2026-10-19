<script setup lang="ts">
/**
 * 桌面歌词窗口（仿 lx-music 原版）。
 *
 * 它是独立的、透明置顶、无边框的小窗口：
 *   - 平时鼠标事件穿透（不挡下面的窗口），解锁后可拖动/调整大小；
 *   - 悬停出现工具条：锁定 / 字体加减 / 换色 / 关闭；
 *   - 双击锁定（与 lx-music 一致）。
 *
 * 数据来自主窗口：主进程转发 lxmn:lyric:data，这里只负责渲染与交互。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { parseLyric, findLineIndex, type LyricLine } from '@lxmn/core'

interface Payload {
  name?: string
  singer?: string
  lyric?: string
  tlyric?: string
  currentTime?: number
  playing?: boolean
}

const data = ref<Payload>({})
const fontSize = ref(34)
const color = ref('#4ade80')
const locked = ref(false)
const hovering = ref(false)

const api = typeof window !== 'undefined' ? window.lxmnNative?.lyric : undefined

const lines = computed<LyricLine[]>(() => parseLyric(data.value.lyric, data.value.tlyric).lines)
const activeIndex = computed(() => findLineIndex(lines.value, data.value.currentTime ?? 0))

/** 当前行 + 下一行：两行是桌面歌词的可读上限，多了会挡住别的窗口 */
const visible = computed(() => {
  const list = lines.value
  if (!list.length) return []
  const at = activeIndex.value
  const from = Math.max(0, at < 0 ? 0 : at)
  return list.slice(from, from + 2).map((l, i) => ({ ...l, active: i === 0 && at >= 0 }))
})

const empty = computed(() => !lines.value.length)

let off: (() => void) | null = null

onMounted(async () => {
  // 告诉 CSS「这是歌词窗口」：html/body 背景转透明
  document.documentElement.dataset.window = 'lyric'
  off = api?.onData(payload => { data.value = payload ?? {} }) ?? null
  const style = await api?.getStyle().catch(() => null)
  if (style) {
    fontSize.value = style.fontSize
    color.value = style.color
    locked.value = style.locked
    await api?.setClickThrough(style.locked)
  }
})

onBeforeUnmount(() => {
  off?.()
  delete document.documentElement.dataset.window
})

async function toggleLock(): Promise<void> {
  locked.value = !locked.value
  // 只切换本次会话的穿透状态，不写盘（见 main.cjs get-style 注释）
  await api?.setClickThrough(locked.value)
}

async function bump(delta: number): Promise<void> {
  fontSize.value = Math.min(72, Math.max(18, fontSize.value + delta))
  await api?.setStyle({ fontSize: fontSize.value })
}

const COLORS = ['#4ade80', '#ffffff', '#f87171', '#60a5fa', '#fbbf24', '#c084fc']

async function pick(c: string): Promise<void> {
  color.value = c
  await api?.setStyle({ color: c })
}

async function close(): Promise<void> {
  await api?.close()
}
</script>

<template>
  <div
    class="relative flex h-full w-full flex-col items-center justify-center overflow-hidden rounded-xl"
    :class="!locked && hovering ? 'bg-black/30' : 'bg-transparent'"
    @mouseenter="hovering = true"
    @mouseleave="hovering = false"
    @dblclick="toggleLock"
  >
    <!-- 拖动区：只有解锁时才允许拖动窗口 -->
    <div class="pointer-events-none absolute inset-x-0 top-0 h-6" :style="{ WebkitAppRegion: locked ? 'no-drag' : 'drag' } as never" />

    <p
      v-if="empty"
      class="select-none text-center"
      :style="{ fontSize: fontSize + 'px', color, opacity: 0.75, textShadow: '0 2px 8px rgba(0,0,0,.8)' }"
    >
      {{ data.name ? '等待歌词…' : 'Lyco Music 桌面歌词' }}
    </p>
    <template v-else>
      <p
        v-for="(l, i) in visible"
        :key="i"
        class="select-none text-center leading-[1.45] transition-all"
        :style="{
          fontSize: (i === 0 ? fontSize : Math.round(fontSize * 0.78)) + 'px',
          color,
          opacity: i === 0 ? 1 : 0.65,
          fontWeight: i === 0 ? 700 : 400,
          textShadow: '0 2px 10px rgba(0,0,0,.85)',
          marginTop: i === 0 ? 0 : Math.round(fontSize * 0.2) + 'px',
        }"
      >
        {{ l.text || '·' }}
      </p>
    </template>

    <!-- 工具条：悬停且未锁定时出现 -->
    <div
      v-if="hovering && !locked"
      class="absolute right-2 top-2 flex items-center gap-1 rounded-lg bg-black/55 px-1.5 py-1 backdrop-blur"
      :style="{ WebkitAppRegion: 'no-drag' } as never"
    >
      <button type="button" class="rounded px-1.5 text-[12px] text-white/85 hover:bg-white/15" title="锁定（双击歌词也可锁定）" @click="toggleLock">🔓</button>
      <button type="button" class="rounded px-1.5 text-[12px] text-white/85 hover:bg-white/15" title="调小" @click="bump(-2)">A-</button>
      <button type="button" class="rounded px-1.5 text-[12px] text-white/85 hover:bg-white/15" title="调大" @click="bump(2)">A+</button>
      <span class="mx-0.5 h-3 w-px bg-white/25" aria-hidden="true" />
      <button
        v-for="c in COLORS"
        :key="c"
        type="button"
        class="size-3.5 rounded-full border border-white/40"
        :style="{ background: c }"
        :title="'颜色 ' + c"
        @click="pick(c)"
      />
      <span class="mx-0.5 h-3 w-px bg-white/25" aria-hidden="true" />
      <button type="button" class="rounded px-1.5 text-[12px] text-white/85 hover:bg-white/15" title="关闭桌面歌词" @click="close">×</button>
    </div>

    <!-- 锁定后只留一个极淡的提示，避免完全找不到入口 -->
    <div
      v-if="locked && hovering"
      class="absolute inset-x-0 bottom-1 text-center text-[10px] text-white/40"
      :style="{ WebkitAppRegion: 'no-drag' } as never"
    >
      歌词已锁定 · 双击解锁
    </div>
  </div>
</template>
