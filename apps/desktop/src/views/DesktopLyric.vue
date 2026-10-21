<script setup lang="ts">
/**
 * 桌面歌词窗口（仿 lx-music 原版）。
 *
 * 它是独立的、透明置顶、无边框的小窗口：
 *   - 平时鼠标事件穿透（不挡下面的窗口），解锁后可拖动/调整大小；
 *   - 悬停出现工具条：锁定 / 字体加减 / 换色 / 关闭；
 *   - 双击锁定（与 lx-music 一致）；
 *   - 右键打开样式面板：字号 / 颜色 / 字体 / 描边 / 单双行。
 *
 * 数据来自主窗口：主进程转发 lxmn:lyric:data，这里只负责渲染与交互。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { findLineIndex, type LyricLine } from '@lxmn/core'
import { viewLyric } from '@/lib/lyric-view'
import {
  LYRIC_COLORS,
  LYRIC_FONTS,
  LYRIC_STROKES,
  normalizeLyricStyle,
  strokePaint,
  DEFAULT_LYRIC_STYLE,
  type LyricStyle,
} from '@/lib/lyric-style'

interface Payload {
  name?: string
  singer?: string
  lyric?: string
  tlyric?: string
  romalrc?: string
  currentTime?: number
  duration?: number
  playing?: boolean
}

const data = ref<Payload>({})
const style = ref<LyricStyle>({ ...DEFAULT_LYRIC_STYLE })
const locked = ref(false)
const hovering = ref(false)
const menuOpen = ref(false)

const api = typeof window !== 'undefined' ? window.lxmnNative?.lyric : undefined

/** 单行 / 双行选项（模板里不能写 TS 断言，放这儿） */
const LINE_OPTIONS = [1, 2] as const

/** 行距档位（3.15） */
const LINE_HEIGHTS = [1, 1.2, 1.35, 1.5, 1.8, 2.2] as const

/** 当前行停靠位置（3.17） */
const DOCKS = [
  { id: 'center' as const, label: '居中' },
  { id: 'top' as const, label: '顶部' },
]

/** 面板占的高度：主进程按这个值把窗口往下长，面板才不会被歌词挤掉 */
const MENU_RESERVE = 372

/* ---------------- 三层歌词：原文 / 罗马音 / 翻译 ---------------- */

type LayerKey = 'original' | 'romaji' | 'translation'

/**
 * 桌面歌词的开关单独存一份，不和播放页共用。
 *
 * 两个场景要的行数不一样：播放页有整屏可以铺，桌面歌词只有一两行 ——
 * 在播放页关掉罗马音不该顺手把桌面歌词也关掉。
 */
const LAYER_KEY = 'lxmn.lyric.win.layers'

const LAYER_OPTIONS: { key: LayerKey; label: string; short: string }[] = [
  { key: 'original', label: '原文', short: '原' },
  { key: 'romaji', label: '罗马音', short: '罗' },
  { key: 'translation', label: '翻译', short: '译' },
]

function readLayers(): Record<LayerKey, boolean> {
  try {
    const raw = localStorage.getItem(LAYER_KEY)
    if (raw) {
      const v = JSON.parse(raw) as Partial<Record<LayerKey, boolean>>
      return { original: v.original !== false, romaji: v.romaji !== false, translation: v.translation !== false }
    }
  } catch {
    // 读不出来就用默认值
  }
  return { original: true, romaji: true, translation: true }
}

const layers = ref<Record<LayerKey, boolean>>(readLayers())

function toggleLayer(key: LayerKey): void {
  layers.value = { ...layers.value, [key]: !layers.value[key] }
  try {
    localStorage.setItem(LAYER_KEY, JSON.stringify(layers.value))
  } catch {
    // 只影响下次启动的默认值
  }
}

const lines = computed<LyricLine[]>(
  () => viewLyric(data.value.lyric, data.value.tlyric, data.value.romalrc).lines,
)

/** 纯文本歌词（没有任何时间戳）不能点着跳转，跳过去只会乱 */
const isPlain = computed(() => !/\[\d{1,3}:\d{1,2}/.test(data.value.lyric ?? ''))

/** 这一行要显示哪几行字：第一行是主行，其余当小字副行 */
function layersOf(line: LyricLine): string[] {
  const out: string[] = []
  if (layers.value.original && line.text) out.push(line.text)
  if (layers.value.romaji && line.romaji) out.push(line.romaji)
  if (layers.value.translation && line.translation) out.push(line.translation)
  if (!out.length) out.push(line.text || '·')
  return out
}

const activeIndex = computed(() => findLineIndex(lines.value, data.value.currentTime ?? 0))

/** 当前行 +（双行时）下一行：多了会挡住别的窗口 */
const visible = computed(() => {
  const list = lines.value
  if (!list.length) return []
  const at = activeIndex.value
  const from = Math.max(0, at < 0 ? 0 : at)
  return list.slice(from, from + style.value.lines).map((l, i) => ({ ...l, active: i === 0 && at >= 0 }))
})

const empty = computed(() => !lines.value.length)

/* ---------------- 时间条：显示进度 + 点/拖跳转 ---------------- */

const barEl = ref<HTMLElement | null>(null)
const seeking = ref(false)

const duration = computed(() => {
  const d = Number(data.value.duration)
  return Number.isFinite(d) && d > 0 ? d : 0
})
const progressPct = computed(() => {
  if (!duration.value) return 0
  const t = Math.min(duration.value, Math.max(0, data.value.currentTime ?? 0))
  return (t / duration.value) * 100
})

function fmt(sec: number): string {
  const s = Number.isFinite(sec) && sec > 0 ? Math.floor(sec) : 0
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')
}

/** 把鼠标 x 换成秒数：时间条宽度对应整首时长 */
function timeAt(clientX: number): number | null {
  const box = barEl.value
  if (!box || !duration.value) return null
  const r = box.getBoundingClientRect()
  if (r.width <= 0) return null
  const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
  return ratio * duration.value
}

function onBarDown(e: MouseEvent): void {
  if (locked.value) return
  e.preventDefault()
  e.stopPropagation()
  seeking.value = true
  const t = timeAt(e.clientX)
  if (t !== null) void api?.seek(t)
}

function onBarMove(e: MouseEvent): void {
  if (!seeking.value) return
  e.stopPropagation()
  const t = timeAt(e.clientX)
  if (t !== null) void api?.seek(t)
}

function onBarUp(): void {
  seeking.value = false
}

/** 点歌词行跳过去（拖动窗口时不能误触，见下面 onPressMove） */
function seekTo(time: number): void {
  if (isPlain.value) return
  if (!Number.isFinite(time) || time < 0) return
  void api?.seek(time)
}

/** 描边 + 阴影一次算好，模板里不用重复拼字符串 */
const paint = computed(() => strokePaint(style.value.stroke))
const fontStack = computed(() => style.value.fontFamily || undefined)

/**
 * 暂停时整体调淡（3.18）。
 *
 * 只调淡、不隐藏：桌面歌词常常压在别人的窗口上，暂停时半透明能让人
 * 看清底下的内容，但又能一眼确认「歌词还在」。
 */
const bodyOpacity = computed(() =>
  style.value.dimWhenPaused && data.value.playing === false ? style.value.dimOpacity : 1,
)

/** 当前行停在窗口顶部还是居中（3.17） */
const dockClass = computed(() => (style.value.scrollAt === 'top' ? 'justify-start pt-1' : 'justify-center'))

/** 竖排（3.16）：逐字竖排 + 从右往左排列 */
const bodyWriting = computed(() => (style.value.vertical ? 'vertical-rl' : undefined))

/** 不换行（3.14）：超长就省略，而不是把窗口撑成两行 */
const lineWrapClass = computed(() => (style.value.noWrap ? 'whitespace-nowrap overflow-hidden text-ellipsis' : 'whitespace-pre-wrap'))

let off: (() => void) | null = null

onMounted(async () => {
  // 告诉 CSS「这是歌词窗口」：html/body 背景转透明
  document.documentElement.dataset.window = 'lyric'
  off = api?.onData(payload => { data.value = payload ?? {} }) ?? null
  const saved = await api?.getStyle().catch(() => null)
  if (saved) {
    style.value = normalizeLyricStyle(saved)
    locked.value = Boolean(saved.locked)
    await api?.setClickThrough(locked.value)
  }
  // 点空白处收面板。不能只依赖 Esc：窗口 focusable:false，键盘事件根本到不了
  document.addEventListener('mousedown', onDocDown)
  window.addEventListener('mousemove', onPressMove)
  window.addEventListener('mouseup', onPressUp)
})

onBeforeUnmount(() => {
  off?.()
  document.removeEventListener('mousedown', onDocDown)
  window.removeEventListener('mousemove', onPressMove)
  window.removeEventListener('mouseup', onPressUp)
  delete document.documentElement.dataset.window
})

function onDocDown(e: MouseEvent): void {
  if (!menuOpen.value) return
  const menu = document.getElementById('lyric-style-menu')
  if (menu && !menu.contains(e.target as Node)) closeMenu()
}

async function toggleLock(): Promise<void> {
  closeMenu()
  locked.value = !locked.value
  // 只切换本次会话的穿透状态，不写盘（见 main.cjs get-style 注释）
  await api?.setClickThrough(locked.value)
}

/** 所有样式改动都走这里：先本地生效（不能等 IPC 回来才刷新），再落盘 */
async function patch(next: Partial<LyricStyle>): Promise<void> {
  style.value = normalizeLyricStyle({ ...style.value, ...next }, style.value)
  const saved = await api?.setStyle(next).catch(() => null)
  // 主进程会再夹一次范围，以它返回的为准（避免两边算出不同的值）
  if (saved) style.value = normalizeLyricStyle(saved, style.value)
}

function bump(delta: number): void {
  void patch({ fontSize: style.value.fontSize + delta })
}

function showMenu(): void {
  if (locked.value || menuOpen.value) return
  menuOpen.value = true
  // 面板是流内元素，先把窗口加高，否则它会挤掉歌词
  void api?.reserve(MENU_RESERVE)
}

function openMenu(e: MouseEvent): void {
  e.preventDefault()
  showMenu()
}

function closeMenu(): void {
  if (!menuOpen.value) return
  menuOpen.value = false
  void api?.release()
}

/* ---------------- 拖动窗口 ---------------- */

/**
 * 为什么自己算位置：这个窗口是 transparent + focusable:false，
 * `-webkit-app-region: drag` 要么命中不到（拖动区 pointer-events:none），
 * 要么把工具条上的按钮一起变成不可点。
 *
 * 渲染层这里只负责「按下 / 松手」两个信号，真正的坐标由主进程读系统光标：
 * 窗口是跟着鼠标走的，用 clientX/screenX 都会自激（实测拖 150px 窗口跑 754px）。
 *
 * 现在按下不再立刻开始拖：要先挪动超过 DRAG_SLOP 才算拖。
 * 否则「点一下歌词行跳转」和「拖窗口」是同一个 mousedown，永远分不开。
 */
const DRAG_SLOP = 4

let pressAt: { x: number; y: number } | null = null
let pressLine: number | null = null
let dragging = false

function onPressDown(e: MouseEvent): void {
  if (locked.value || e.button !== 0) return
  // 工具条按钮、时间条有自己的点击语义
  const el = e.target as HTMLElement | null
  if (el?.closest('button') || el?.closest('[data-seekbar]')) return
  pressAt = { x: e.clientX, y: e.clientY }
  dragging = false
  const row = el?.closest('[data-line-time]') as HTMLElement | null
  const t = row ? Number(row.dataset.lineTime) : NaN
  pressLine = Number.isFinite(t) ? t : null
}

function onPressMove(e: MouseEvent): void {
  if (!pressAt || dragging) return
  if (Math.abs(e.clientX - pressAt.x) <= DRAG_SLOP && Math.abs(e.clientY - pressAt.y) <= DRAG_SLOP) return
  dragging = true
  void api?.dragStart().catch(() => null)
}

function onPressUp(): void {
  const line = pressLine
  const wasDragging = dragging
  pressAt = null
  pressLine = null
  dragging = false
  onBarUp()
  if (wasDragging) {
    void api?.dragEnd().catch(() => false)
    return
  }
  // 没拖动就是单击：点歌词行跳到那一句
  if (line !== null) seekTo(line)
}

async function close(): Promise<void> {
  await api?.close()
}

/** 重置窗口位置（3.23）：换显示器后窗口落在不存在的坐标上时唯一的救援入口 */
async function resetWindow(): Promise<void> {
  await api?.resetWindow().catch(() => false)
  closeMenu()
}
</script>

<template>
  <div
    class="relative flex h-full w-full flex-col overflow-hidden rounded-xl"
    :class="!locked && hovering && !menuOpen ? 'bg-black/30' : 'bg-transparent'"
    @mouseenter="hovering = true"
    @mouseleave="hovering = false"
    @dblclick="menuOpen ? closeMenu() : toggleLock()"
    @contextmenu="openMenu"
    @mousedown="onPressDown"
  >
    <!-- 歌词本体：占满剩余高度并垂直居中；面板展开时它自然缩到上半部分 -->
    <div
      class="flex min-h-0 flex-1 flex-col items-center px-4"
      :class="[dockClass, locked ? '' : 'cursor-move']"
      :style="{ opacity: bodyOpacity, writingMode: bodyWriting }"
    >
      <p
        v-if="empty"
        class="select-none text-center"
        :style="{
          fontSize: style.fontSize + 'px',
          color: style.playedColor,
          fontFamily: fontStack,
          opacity: 0.75,
          ...paint,
        }"
      >
        {{ data.name ? '等待歌词…' : 'Lyco Music 桌面歌词' }}
      </p>
      <template v-else>
        <p
          v-for="(l, i) in visible"
          :key="i"
          :data-line-time="l.time"
          class="select-none text-center transition-all"
          :class="[isPlain ? '' : 'cursor-pointer', lineWrapClass]"
          :style="{
            fontSize: (i === 0 ? style.fontSize : Math.round(style.fontSize * 0.78)) + 'px',
            color: i === 0 ? style.playedColor : style.unplayedColor,
            fontFamily: fontStack,
            opacity: i === 0 ? 1 : 0.65,
            fontWeight: style.boldLines ? 700 : 400,
            lineHeight: String(style.lineHeight),
            marginTop: i === 0 ? 0 : Math.round(style.fontSize * 0.2) + 'px',
            ...paint,
          }"
        >
          <!-- 主行大字，罗马音/翻译作为小字副行挂在下面 -->
          <span
            v-for="(t, li) in layersOf(l)"
            :key="li"
            class="block whitespace-pre-wrap"
            :style="li === 0 ? undefined : {
              fontSize: Math.round(style.fontSize * 0.56) + 'px',
              fontWeight: style.boldTranslation ? 700 : 400,
              opacity: 0.85,
              marginTop: '2px',
            }"
          >{{ t }}</span>
        </p>
      </template>
    </div>

    <!-- 时间条：悬停时出现，点一下/按住拖都能跳转（歌词窗口自己没有播放器，靠主窗口执行） -->
    <div
      v-if="hovering && !locked && !menuOpen"
      data-seekbar
      class="absolute inset-x-0 bottom-0 flex h-[16px] cursor-pointer items-center gap-1.5 px-2"
      role="slider"
      :aria-valuenow="Math.round(progressPct)"
      aria-valuemin="0"
      aria-valuemax="100"
      aria-label="播放进度"
      @mousedown="onBarDown"
      @mousemove="onBarMove"
      @mouseup="onBarUp"
      @dblclick.stop
    >
      <span class="w-[32px] shrink-0 text-right text-[10px] tabular-nums text-white/70">{{ fmt(data.currentTime ?? 0) }}</span>
      <div ref="barEl" class="relative h-[3px] flex-1 overflow-hidden rounded-full bg-white/25">
        <div class="h-full rounded-full bg-white/85" :style="{ width: progressPct + '%' }" />
      </div>
      <span class="w-[32px] shrink-0 text-[10px] tabular-nums text-white/45">{{ fmt(duration) }}</span>
    </div>

    <!-- 工具条：悬停且未锁定时出现（面板打开时让位，避免两层浮层叠在一起） -->
    <div
      v-if="hovering && !locked && !menuOpen"
      class="absolute right-2 top-2 flex items-center gap-1 rounded-lg bg-black/55 px-1.5 py-1 backdrop-blur"
      :style="{ WebkitAppRegion: 'no-drag' } as never"
    >
      <button type="button" class="rounded px-1.5 text-[12px] text-white/85 hover:bg-white/15" title="锁定（锁定后鼠标穿透，到播放器底栏点「词」解锁）" @click="toggleLock">🔓</button>
      <button type="button" class="rounded px-1.5 text-[12px] text-white/85 hover:bg-white/15" title="调小" @click="bump(-2)">A-</button>
      <button type="button" class="rounded px-1.5 text-[12px] text-white/85 hover:bg-white/15" title="调大" @click="bump(2)">A+</button>
      <span class="mx-0.5 h-3 w-px bg-white/25" aria-hidden="true" />
      <!-- 三层开关：原文 / 罗马音 / 翻译 -->
      <button
        v-for="o in LAYER_OPTIONS"
        :key="o.key"
        type="button"
        class="rounded px-1.5 text-[12px]"
        :class="layers[o.key] ? 'bg-white/20 text-white' : 'text-white/40 hover:bg-white/15'"
        :title="(layers[o.key] ? '隐藏' : '显示') + o.label"
        @click="toggleLayer(o.key)"
      >{{ o.short }}</button>
      <span class="mx-0.5 h-3 w-px bg-white/25" aria-hidden="true" />
      <button
        v-for="c in LYRIC_COLORS.slice(-6)"
        :key="c"
        type="button"
        class="size-3.5 rounded-full border border-white/40"
        :style="{ background: c }"
        :title="'当前行颜色 ' + c"
        @click="patch({ playedColor: c })"
      />
      <span class="mx-0.5 h-3 w-px bg-white/25" aria-hidden="true" />
      <button type="button" class="rounded px-1.5 text-[12px] text-white/85 hover:bg-white/15" title="右键打开更多样式" @click="showMenu">⋯</button>
      <button type="button" class="rounded px-1.5 text-[12px] text-white/85 hover:bg-white/15" title="关闭桌面歌词" @click="close">×</button>
    </div>

    <!-- 样式面板（右键打开）：流内元素，窗口已按 MENU_RESERVE 加高，不会压住歌词 -->
    <div
      v-if="menuOpen"
      id="lyric-style-menu"
      class="mx-2 mb-2 shrink-0 overflow-y-auto rounded-xl border border-white/15 bg-black/80 px-3 py-2 text-white shadow-[0_8px_28px_rgba(0,0,0,.5)] backdrop-blur"
      :style="{ WebkitAppRegion: 'no-drag' } as never"
      @contextmenu.prevent
    >
      <div class="mb-1 flex items-center justify-between text-[11px] text-white/45">
        <span>桌面歌词样式</span>
        <button type="button" class="rounded px-1 text-white/60 hover:bg-white/15" title="关闭面板" @click="closeMenu">×</button>
      </div>

      <!-- 字号 -->
      <div class="flex h-[26px] items-center gap-1.5">
        <span class="w-9 shrink-0 text-[11px] text-white/45">字号</span>
        <button type="button" class="rounded bg-white/10 px-2 text-[12px] hover:bg-white/20" @click="bump(-2)">A-</button>
        <span class="w-7 text-center text-[12px] tabular-nums text-white/80">{{ style.fontSize }}</span>
        <button type="button" class="rounded bg-white/10 px-2 text-[12px] hover:bg-white/20" @click="bump(2)">A+</button>
        <button type="button" class="ml-1 rounded px-2 text-[11px] text-white/55 hover:bg-white/15" @click="patch({ fontSize: DEFAULT_LYRIC_STYLE.fontSize })">重置</button>

        <span class="ml-auto flex items-center gap-1 text-[11px] text-white/45">
          行数
          <button
            v-for="n in LINE_OPTIONS"
            :key="n"
            type="button"
            class="rounded px-2 text-[11px]"
            :class="style.lines === n ? 'bg-white/90 text-black' : 'bg-white/10 text-white/70 hover:bg-white/20'"
            @click="patch({ lines: n })"
          >
            {{ n === 1 ? '单行' : '双行' }}
          </button>
        </span>
      </div>

      <!-- 显示层：原文 / 罗马音 / 翻译 各自独立开关 -->
      <div class="mt-1 flex h-[26px] items-center gap-1.5">
        <span class="w-9 shrink-0 text-[11px] text-white/45">显示</span>
        <button
          v-for="o in LAYER_OPTIONS"
          :key="'l' + o.key"
          type="button"
          class="rounded px-2 text-[11px]"
          :class="layers[o.key] ? 'bg-white/90 text-black' : 'bg-white/10 text-white/70 hover:bg-white/20'"
          :title="(layers[o.key] ? '隐藏' : '显示') + o.label"
          @click="toggleLayer(o.key)"
        >
          {{ o.label }}
        </button>
        <span class="ml-auto text-[11px] text-white/30">没这几层时多半是源没给</span>
      </div>

      <!-- 颜色：当前行 / 下一行 -->
      <div class="mt-1 flex h-[26px] items-center gap-1.5">
        <span class="w-9 shrink-0 text-[11px] text-white/45">颜色</span>
        <span class="text-[11px] text-white/40">当前</span>
        <button
          v-for="c in LYRIC_COLORS"
          :key="'p' + c"
          type="button"
          class="size-4 rounded-full border"
          :class="style.playedColor === c ? 'border-white ring-1 ring-white/60' : 'border-white/30'"
          :style="{ background: c }"
          :title="c"
          @click="patch({ playedColor: c })"
        />
        <span class="ml-2 text-[11px] text-white/40">下一行</span>
        <button
          v-for="c in LYRIC_COLORS"
          :key="'u' + c"
          type="button"
          class="size-4 rounded-full border"
          :class="style.unplayedColor === c ? 'border-white ring-1 ring-white/60' : 'border-white/30'"
          :style="{ background: c }"
          :title="c"
          @click="patch({ unplayedColor: c })"
        />
      </div>

      <!-- 字体 -->
      <div class="mt-1 flex h-[26px] items-center gap-1.5">
        <span class="w-9 shrink-0 text-[11px] text-white/45">字体</span>
        <button
          v-for="f in LYRIC_FONTS"
          :key="f.id"
          type="button"
          class="rounded px-2 text-[11px]"
          :class="style.fontFamily === f.stack ? 'bg-white/90 text-black' : 'bg-white/10 text-white/70 hover:bg-white/20'"
          :style="{ fontFamily: f.stack || undefined }"
          @click="patch({ fontFamily: f.stack })"
        >
          {{ f.name }}
        </button>
      </div>

      <!-- 排版：加粗 / 不换行 / 行距 / 竖排 / 停靠 -->
      <div class="mt-1 flex h-[26px] items-center gap-1.5">
        <span class="w-9 shrink-0 text-[11px] text-white/45">排版</span>
        <button
          type="button"
          class="rounded px-2 text-[11px]"
          :class="style.boldLines ? 'bg-white/90 text-black' : 'bg-white/10 text-white/70 hover:bg-white/20'"
          title="歌词正文加粗"
          @click="patch({ boldLines: !style.boldLines })"
        >加粗</button>
        <button
          type="button"
          class="rounded px-2 text-[11px]"
          :class="style.boldTranslation ? 'bg-white/90 text-black' : 'bg-white/10 text-white/70 hover:bg-white/20'"
          title="翻译行加粗"
          @click="patch({ boldTranslation: !style.boldTranslation })"
        >译粗</button>
        <button
          type="button"
          class="rounded px-2 text-[11px]"
          :class="style.noWrap ? 'bg-white/90 text-black' : 'bg-white/10 text-white/70 hover:bg-white/20'"
          title="超长歌词不折行，直接省略"
          @click="patch({ noWrap: !style.noWrap })"
        >不换行</button>
        <button
          type="button"
          class="rounded px-2 text-[11px]"
          :class="style.vertical ? 'bg-white/90 text-black' : 'bg-white/10 text-white/70 hover:bg-white/20'"
          title="竖排显示（日式字幕）"
          @click="patch({ vertical: !style.vertical })"
        >竖排</button>
      </div>

      <!-- 行距 / 停靠位置 -->
      <div class="mt-1 flex h-[26px] items-center gap-1.5">
        <span class="w-9 shrink-0 text-[11px] text-white/45">行距</span>
        <button
          v-for="lh in LINE_HEIGHTS"
          :key="lh"
          type="button"
          class="rounded px-2 text-[11px]"
          :class="style.lineHeight === lh ? 'bg-white/90 text-black' : 'bg-white/10 text-white/70 hover:bg-white/20'"
          @click="patch({ lineHeight: lh })"
        >{{ lh.toFixed(1) }}</button>
        <span class="ml-2 text-[11px] text-white/40">位置</span>
        <button
          v-for="d in DOCKS"
          :key="d.id"
          type="button"
          class="rounded px-2 text-[11px]"
          :class="style.scrollAt === d.id ? 'bg-white/90 text-black' : 'bg-white/10 text-white/70 hover:bg-white/20'"
          @click="patch({ scrollAt: d.id })"
        >{{ d.label }}</button>
      </div>

      <!-- 行为：暂停变淡 / 任务栏 / 全屏隐藏 / 重置窗口 -->
      <div class="mt-1 flex h-[26px] items-center gap-1.5">
        <span class="w-9 shrink-0 text-[11px] text-white/45">行为</span>
        <button
          type="button"
          class="rounded px-2 text-[11px]"
          :class="style.dimWhenPaused ? 'bg-white/90 text-black' : 'bg-white/10 text-white/70 hover:bg-white/20'"
          title="暂停时把歌词调淡，避免挡住桌面"
          @click="patch({ dimWhenPaused: !style.dimWhenPaused })"
        >暂停变淡</button>
        <button
          type="button"
          class="rounded px-2 text-[11px]"
          :class="style.showInTaskbar ? 'bg-white/90 text-black' : 'bg-white/10 text-white/70 hover:bg-white/20'"
          title="在任务栏显示这个窗口（录屏抓不到歌词时用）"
          @click="patch({ showInTaskbar: !style.showInTaskbar })"
        >任务栏</button>
        <button
          type="button"
          class="rounded px-2 text-[11px]"
          :class="style.hideOnFullscreen ? 'bg-white/90 text-black' : 'bg-white/10 text-white/70 hover:bg-white/20'"
          title="主窗口全屏时自动隐藏（只对 Lyco 自己的全屏生效）"
          @click="patch({ hideOnFullscreen: !style.hideOnFullscreen })"
        >全屏隐藏</button>
        <button
          type="button"
          class="ml-auto rounded px-2 text-[11px] text-white/60 hover:bg-white/15"
          title="窗口拖到屏幕外找不回来时点这里"
          @click="resetWindow"
        >重置窗口</button>
      </div>

      <!-- 描边 -->
      <div class="mt-1 flex h-[26px] items-center gap-1.5">
        <span class="w-9 shrink-0 text-[11px] text-white/45">描边</span>
        <button
          v-for="s in LYRIC_STROKES"
          :key="s.level"
          type="button"
          class="rounded px-2 text-[11px]"
          :class="style.stroke === s.level ? 'bg-white/90 text-black' : 'bg-white/10 text-white/70 hover:bg-white/20'"
          @click="patch({ stroke: s.level })"
        >
          {{ s.name }}
        </button>
        <span class="ml-auto text-[11px] text-white/30">右键可再打开 · 双击锁定</span>
      </div>
    </div>

    <!-- 锁定后只留一个极淡的提示，避免完全找不到入口 -->
    <div
      v-if="locked && hovering"
      class="absolute inset-x-0 bottom-1 text-center text-[10px] text-white/40"
      :style="{ WebkitAppRegion: 'no-drag' } as never"
    >
      歌词已锁定 · 到播放器底栏点「词」解锁
    </div>
  </div>
</template>
