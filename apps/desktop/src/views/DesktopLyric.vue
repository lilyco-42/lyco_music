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
import { parseLyric, findLineIndex, type LyricLine } from '@lxmn/core'
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
  currentTime?: number
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

/** 面板占的高度：主进程按这个值把窗口往下长，面板才不会被歌词挤掉 */
const MENU_RESERVE = 172

const lines = computed<LyricLine[]>(() => parseLyric(data.value.lyric, data.value.tlyric).lines)
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

/** 描边 + 阴影一次算好，模板里不用重复拼字符串 */
const paint = computed(() => strokePaint(style.value.stroke))
const fontStack = computed(() => style.value.fontFamily || undefined)

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
  window.addEventListener('mouseup', onDragEnd)
})

onBeforeUnmount(() => {
  off?.()
  document.removeEventListener('mousedown', onDocDown)
  window.removeEventListener('mouseup', onDragEnd)
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
 */
async function onDragStart(e: MouseEvent): Promise<void> {
  if (locked.value || e.button !== 0) return
  // 只从歌词本体起拖：工具条/面板上的按钮有自己的点击语义
  const el = e.target as HTMLElement | null
  if (el?.closest('button')) return
  await api?.dragStart().catch(() => null)
}

function onDragEnd(): void {
  void api?.dragEnd().catch(() => false)
}

async function close(): Promise<void> {
  await api?.close()
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
    @mousedown="onDragStart"
  >
    <!-- 歌词本体：占满剩余高度并垂直居中；面板展开时它自然缩到上半部分 -->
    <div class="flex min-h-0 flex-1 flex-col items-center justify-center px-4" :class="locked ? '' : 'cursor-move'">
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
          class="select-none text-center leading-[1.45] transition-all"
          :style="{
            fontSize: (i === 0 ? style.fontSize : Math.round(style.fontSize * 0.78)) + 'px',
          color: i === 0 ? style.playedColor : style.unplayedColor,
          fontFamily: fontStack,
          opacity: i === 0 ? 1 : 0.65,
          fontWeight: i === 0 ? 700 : 400,
          ...paint,
          marginTop: i === 0 ? 0 : Math.round(style.fontSize * 0.2) + 'px',
        }"
      >
        {{ l.text || '·' }}
      </p>
    </template>
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
