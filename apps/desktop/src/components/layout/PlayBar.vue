<script setup lang="ts">
/**
 * 底部播放条 —— 实测规格：
 * 高 102px，背景 #FBFCFE，贴顶进度条高 3~4px 全宽
 * 左侧歌名/歌手左边距 50px；中央控制区中心 x=960；播放按钮 52x52 圆形
 * 右侧从 x≈1642 起：音质 / 词 / 音量 / 更多
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ListMusic, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward } from 'lucide-vue-next'
import { parseLyric, findLineIndex } from '@lxmn/core'
import { usePlayer } from '@/lib/player'
import { useSync } from '@/lib/sync'
import IconButton from '@/components/ui/IconButton.vue'
import QualityMenu from '@/components/layout/QualityMenu.vue'
import { saveUrl, safeFileName, audioExt } from '@/lib/download'
import { enqueueDownload } from '@/lib/downloads'
import { toast } from '@/lib/toast'

const router = useRouter()
const player = usePlayer()
const { library, playlists, dislikes, isDisliked, dislike, undislike } = useSync()

const track = computed(() => player.current.value)

/** 实际在播的那条（串源后与队列里的可能不同）：封面/标签都跟它走 */
const playingItem = computed(() => player.state.playingItem ?? player.current.value)
const playing = computed(() => player.state.playing)

/** 封面：优先用实际在播曲目的图；没有就退回内置占位图，避免出现破图 */
const cover = computed(() => player.state.picUrl || './art/cover-default.jpg')

function openPlayer(): void {
  void router.push({ name: 'player' })
}

/**
 * 桌面歌词。
 *
 * Electron 里打开的是**独立的透明置顶窗口**（仿 lx-music 原版）：
 * 可以拖到桌面任意位置、置顶、锁定后鼠标穿透。
 * 浏览器预览没有多窗口能力，退回底栏浮层。
 */
const showLyric = computed(() => player.state.lyricOpen)
const nativeLyric = typeof window !== 'undefined' ? window.lxmnNative?.lyric : undefined
const lyricWindowOpen = ref(false)
/** 高亮状态：Electron 里看独立窗口是否打开，浏览器里看浮层开关 */
const lyricActive = computed(() => (nativeLyric ? lyricWindowOpen.value : showLyric.value))

async function toggleLyric(): Promise<void> {
  if (!nativeLyric) {
    player.toggleLyric()
    return
  }
  if (lyricWindowOpen.value) {
    /**
     * 锁定后歌词窗口鼠标穿透，双击/右键都收不到 —— 它自己解不了锁。
     * 所以「词」按钮在锁定时先解锁（而不是关闭），这是唯一的逃生通道。
     */
    const isLocked = await nativeLyric.isLocked().catch(() => false)
    if (isLocked) {
      await nativeLyric.setLock(false).catch(() => false)
      return
    }
    await nativeLyric.close()
    lyricWindowOpen.value = false
    return
  }
  await nativeLyric.open({
    name: player.current.value?.name ?? '',
    singer: player.current.value?.singer ?? '',
    lyric: player.state.lyric,
    tlyric: player.state.tlyric,
    currentTime: player.state.currentTime,
    playing: player.state.playing,
  })
  lyricWindowOpen.value = true
}

onMounted(async () => {
  if (!nativeLyric) return
  lyricWindowOpen.value = await nativeLyric.isOpen().catch(() => false)
})

const lyricLines = computed(() => parseLyric(player.state.lyric, player.state.tlyric, player.state.romalrc).lines)
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

/* ---------------- 进度条：点击 / 拖动跳转 ---------------- */

/**
 * 之前这条只是「显示」进度，点上去什么都不发生 —— 用户第一反应就是「进度条没反应」。
 * 现在按网易云的做法：整条可点可拖，悬停放大并显示落点时间。
 */
const seekBar = ref<HTMLElement | null>(null)
const seeking = ref(false)
const hoverRatio = ref<number | null>(null)

function ratioAt(e: MouseEvent): number {
  const el = seekBar.value
  if (!el) return 0
  const r = el.getBoundingClientRect()
  if (!r.width) return 0
  return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
}

function seekToRatio(ratio: number): void {
  const { duration } = player.state
  if (!duration || !Number.isFinite(duration) || duration <= 0) return
  player.seek(ratio * duration)
}

function onSeekMove(e: MouseEvent): void {
  hoverRatio.value = ratioAt(e)
  if (seeking.value) seekToRatio(hoverRatio.value)
}

function onSeekUp(): void {
  seeking.value = false
  // 松手时把落点气泡收掉：拖到进度条外面松手不会触发 mouseleave，
  // 不清的话气泡和手柄会一直挂在那个位置
  hoverRatio.value = null
  window.removeEventListener('mousemove', onSeekMove)
  window.removeEventListener('mouseup', onSeekUp)
}

function onSeekDown(e: MouseEvent): void {
  if (!player.state.duration) return
  seeking.value = true
  hoverRatio.value = ratioAt(e)
  seekToRatio(hoverRatio.value)
  // 拖出进度条也要继续跟手：挂在 window 上而不是元素上
  window.addEventListener('mousemove', onSeekMove)
  window.addEventListener('mouseup', onSeekUp)
}

onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onSeekMove)
  window.removeEventListener('mouseup', onSeekUp)
})

/** 悬停/拖动时在进度条下方显示落点时间 */
const seekHint = computed(() => {
  const r = hoverRatio.value
  const { duration } = player.state
  if (r === null || !duration) return ''
  return `${fmtTime(r * duration)} / ${fmtTime(duration)}`
})

/* ---------------- 右侧「…」菜单与播放队列 ---------------- */

/** 面板互斥：同时只开一个，避免两层浮层叠在一起 */
const openPanel = ref<'none' | 'more' | 'queue' | 'addto'>('none')

function togglePanel(name: 'more' | 'queue'): void {
  openPanel.value = openPanel.value === name ? 'none' : name
}

/** 当前曲目是否被标记不喜欢（依赖 dislikes 才能随规则变化重算） */
const disliked = computed(() => {
  void dislikes.value
  const t = playingItem.value
  return t ? isDisliked({ name: t.name, singer: t.singer }) : false
})

const moreItems = computed(() => {
  const t = track.value
  if (!t) return []
  return [
    { key: 'singer', label: `歌手：${t.singer || '未知'}`, hint: '在搜索里查看这位歌手' },
    { key: 'album', label: `专辑：${t.albumName || '未知'}`, hint: '在搜索里查看这张专辑' },
    { key: 'addto', label: '添加到歌单', hint: playlists.value.length ? `共 ${playlists.value.length} 个歌单` : '还没有歌单，可以直接新建' },
    { key: 'download', label: '下载歌曲', hint: downloading.value ? '正在下载…' : '另存为音频文件' },
    { key: 'enqueue', label: '下载到音乐库', hint: '进下载管理，可暂停 / 续传' },
    { key: 'copy', label: '复制歌名 - 歌手', hint: '粘贴到别处分享' },
    disliked.value
      ? { key: 'dislike', label: '取消不喜欢', hint: '恢复推荐与播放' }
      : { key: 'dislike', label: '不喜欢这首歌', hint: '加入屏蔽规则，之后自动跳过' },
    { key: 'lyric', label: lyricActive.value ? '关闭桌面歌词' : '打开桌面歌词', hint: '' },
    { key: 'queue', label: `播放队列（${player.state.queue.length}）`, hint: '' },
  ]
})

/* ---- 添加到歌单 ---- */

const addHint = ref('')
const addNewName = ref('')
const addBusy = ref(false)

async function addCurrentTo(playlistId: string): Promise<void> {
  const t = track.value
  if (!t) return
  const pl = playlists.value.find(p => p.id === playlistId)
  const ok = await library.addToPlaylist(playlistId, t)
  addHint.value = ok
    ? `已加入「${pl?.name ?? '歌单'}」`
    : `「${pl?.name ?? '歌单'}」里已经有这首了`
}

/** 建一个新歌单，并把当前这首放进去（名字重了就自动加序号） */
async function addCurrentToNew(): Promise<void> {
  const t = track.value
  if (!t || addBusy.value) return
  addBusy.value = true
  try {
    const base = addNewName.value.replace(/\s+/g, ' ').trim().slice(0, 32) || '新建歌单'
    const used = new Set(playlists.value.map(p => p.name))
    let name = base
    let n = 2
    while (used.has(name)) {
      name = `${base} ${n}`
      n++
    }
    const pl = await library.createPlaylist(name)
    await library.addToPlaylist(pl.id, t)
    addNewName.value = ''
    addHint.value = `已新建「${pl.name}」并加入`
  } finally {
    addBusy.value = false
  }
}

/* ---- 下载当前歌曲 ---- */

const downloading = ref(false)

/**
 * 下载当前曲目。
 *
 * 地址现取现用：state.url 可能是几分钟前取的，酷狗/酷我的签名早就过期了。
 * 真正写文件交给主进程（能弹「另存为」、也能绕开渲染层的 CORS）。
 */
async function downloadCurrent(): Promise<void> {
  const t = track.value
  if (!t || downloading.value) return
  downloading.value = true
  toast('正在准备下载…', 60000)
  try {
    const url = await player.ensureStreamUrl()
    const filename = safeFileName(`${t.name} - ${t.singer}`) + '.' + audioExt(url)
    const res = await saveUrl(filename, url)
    if (res.canceled) {
      toast('已取消下载')
      return
    }
    toast(res.ok ? '已保存' : `下载失败：${res.error ?? '未知错误'}`)
  } catch (e) {
    toast(`下载失败：${e instanceof Error ? e.message : String(e)}`)
  } finally {
    downloading.value = false
  }
}

async function onMore(key: string): Promise<void> {
  const t = track.value
  openPanel.value = 'none'
  if (!t) return
  if (key === 'singer' || key === 'album') {
    const q = key === 'singer' ? t.singer : t.albumName
    if (!q) return
    void router.push({ name: 'search', query: { q } })
    return
  }
  if (key === 'copy') {
    try {
      await navigator.clipboard.writeText(`${t.name} - ${t.singer}`)
    } catch {
      // 剪贴板被拒时不要静默失败：退回到选中文本让用户自己复制
      console.warn('clipboard denied')
    }
    return
  }
  if (key === 'lyric') {
    await toggleLyric()
    return
  }
  if (key === 'addto') {
    addHint.value = ''
    openPanel.value = 'addto'
    return
  }
  if (key === 'download') {
    await downloadCurrent()
    return
  }
  if (key === 'enqueue') {
    const t = track.value
    if (!t) return
    openPanel.value = 'none'
    const n = await enqueueDownload([t], player.state.quality)
    toast(n ? '已加入下载队列' : '这首已经在下载列表里了')
    return
  }
  if (key === 'dislike') {
    const target = { name: t.name, singer: t.singer }
    if (disliked.value) {
      await undislike(target)
      toast('已取消不喜欢')
    } else {
      await dislike(target)
      toast('已加入不喜欢，之后自动跳过')
    }
    return
  }
  if (key === 'queue') {
    openPanel.value = 'queue'
  }
}

function playFromQueue(i: number): void {
  const item = player.state.queue[i]
  if (!item) return
  void player.play(item)
}

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
    <!-- 进度条：贴顶全宽。可点击/拖动跳转，悬停放大并显示落点时间 -->
    <div
      ref="seekBar"
      class="group/seek absolute inset-x-0 top-0 z-10 h-[10px] cursor-pointer"
      role="slider"
      aria-label="播放进度"
      :aria-valuemin="0"
      :aria-valuemax="Math.round(player.state.duration || 0)"
      :aria-valuenow="Math.round(player.state.currentTime || 0)"
      :tabindex="track ? 0 : -1"
      @mousedown.prevent="onSeekDown"
      @mousemove="onSeekMove"
      @mouseleave="hoverRatio = null"
    >
      <div class="absolute inset-x-0 top-0 h-[4px] bg-ncm-divider transition-[height] duration-150 group-hover/seek:h-[6px]">
        <div class="h-full bg-ncm-progress" :style="{ width: progress + '%' }" />
        <!-- 拖动手柄：悬停/拖动时才出现，平时不打扰 -->
        <div
          v-if="track && (hoverRatio !== null || seeking)"
          class="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-ncm-accent-play shadow"
          :style="{ left: (hoverRatio !== null ? hoverRatio * 100 : progress) + '%' }"
        />
      </div>
      <!-- 落点时间：贴在进度条下方，避免超出窗口顶部 -->
      <div
        v-if="seekHint"
        class="pointer-events-none absolute top-[10px] -translate-x-1/2 rounded bg-black/75 px-1.5 py-0.5 text-[11px] text-white tabular-nums"
        :style="{ left: (hoverRatio ?? 0) * 100 + '%' }"
      >
        {{ seekHint }}
      </div>
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
        <span class="tex-img" aria-hidden="true" />
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
        <div v-if="error" class="mt-1 flex items-center gap-1.5 text-[12px] text-ncm-accent">
          <span class="truncate" :title="error">{{ error }}</span>
          <!-- 自动重取失败后总得留一条手动通道，否则用户只能切歌 -->
          <button
            type="button"
            class="shrink-0 underline decoration-dotted underline-offset-2 hover:text-ncm-fg"
            @click.stop="player.retry()"
          >重试</button>
        </div>
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

      <IconButton label="播放列表" size="xl" :class="openPanel === 'queue' ? 'text-ncm-accent' : ''" @click="togglePanel('queue')">
        <template #default="{ size, stroke }"><ListMusic :size="size" :stroke-width="stroke" aria-hidden="true" /></template>
      </IconButton>
    </div>

    <!-- 右侧工具区：从 x≈1642 起 -->
    <div class="flex w-[430px] shrink-0 items-center justify-end gap-[29px] pr-[49px] text-ncm-faint">
      <QualityMenu />
      <button
        type="button"
        class="text-[15px] [app-region:no-drag]"
        :class="lyricActive ? 'text-ncm-accent' : 'hover:text-ncm-fg'"
        aria-label="桌面歌词"
        title="桌面歌词（窗口锁定时点此解锁）"
        :aria-pressed="lyricActive"
        @click="toggleLyric"
      >词</button>

      <!-- 音量 -->
      <div class="flex items-center gap-2">
        <svg viewBox="0 0 24 24" class="size-5 stroke-current" fill="none" stroke-width="1.8" aria-hidden="true">
          <path d="M4 9v6h3l4 3V6L7 9H4ZM16 9a4 4 0 0 1 0 6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <input v-model="volume" type="range" min="0" max="100" class="h-1 w-[70px] accent-ncm-accent-play" />
      </div>

      <button
        type="button"
        class="text-[18px] leading-none hover:text-ncm-fg"
        :class="openPanel === 'more' ? 'text-ncm-accent' : ''"
        aria-label="更多"
        title="更多操作"
        @click="togglePanel('more')"
      >…</button>
    </div>

    <!-- 点空白处收起面板 -->
    <div v-if="openPanel !== 'none'" class="fixed inset-0 z-40" @click="openPanel = 'none'" />

    <!-- 「…」菜单：只放真能用的动作，不做占位项 -->
    <div
      v-if="openPanel === 'more' && moreItems.length"
      class="absolute bottom-[112px] right-[28px] z-50 w-[300px] overflow-hidden rounded-2xl border border-ncm-divider bg-white py-1 shadow-[0_12px_32px_rgba(0,0,0,.14)]"
    >
      <button
        v-for="it in moreItems"
        :key="it.key"
        type="button"
        class="flex w-full items-start justify-between gap-3 px-4 py-2 text-left transition-colors hover:bg-black/5"
        @click="onMore(it.key)"
      >
        <span class="min-w-0">
          <span class="block truncate text-[14px] text-ncm-fg">{{ it.label }}</span>
          <span v-if="it.hint" class="block truncate text-[11px] text-ncm-fainter">{{ it.hint }}</span>
        </span>
      </button>
    </div>

    <!-- 添加到歌单 -->
    <div
      v-if="openPanel === 'addto'"
      class="absolute bottom-[112px] right-[28px] z-50 flex max-h-[420px] w-[320px] flex-col overflow-hidden rounded-2xl border border-ncm-divider bg-white shadow-[0_12px_32px_rgba(0,0,0,.14)]"
    >
      <div class="border-b border-ncm-divider px-4 py-2.5 text-[14px] text-ncm-fg">添加到歌单</div>
      <div class="min-h-0 flex-1 overflow-y-auto py-1">
        <p v-if="!playlists.length" class="px-4 py-6 text-center text-[13px] text-ncm-fainter">还没有歌单，在下面直接建一个</p>
        <button
          v-for="pl in playlists"
          :key="pl.id"
          type="button"
          class="flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-black/5"
          @click="addCurrentTo(pl.id)"
        >
          <ListMusic :size="16" :stroke-width="1.8" class="shrink-0 text-ncm-faint" aria-hidden="true" />
          <span class="min-w-0 flex-1 truncate text-[13px] text-ncm-fg">{{ pl.name }}</span>
          <span class="shrink-0 text-[11px] text-ncm-fainter">{{ pl.items.length }}</span>
        </button>
      </div>
      <p v-if="addHint" class="border-t border-ncm-divider bg-ncm-accent/5 px-4 py-1.5 text-[12px] text-ncm-accent">{{ addHint }}</p>
      <form class="flex items-center gap-2 border-t border-ncm-divider p-2.5" @submit.prevent="addCurrentToNew">
        <input
          v-model="addNewName"
          type="text"
          maxlength="40"
          placeholder="新建歌单并加入…"
          class="min-w-0 flex-1 rounded-[6px] border border-ncm-divider px-2 py-1 text-[13px] text-ncm-fg outline-none placeholder:text-ncm-fainter focus:border-ncm-accent"
        />
        <button
          type="submit"
          class="shrink-0 rounded-pill bg-ncm-accent px-3 py-1 text-[12px] text-white disabled:opacity-50"
          :disabled="addBusy"
        >创建并加入</button>
      </form>
    </div>

    <!-- 播放队列 -->
    <div
      v-if="openPanel === 'queue'"
      class="absolute bottom-[112px] right-[28px] z-50 flex max-h-[440px] w-[400px] flex-col overflow-hidden rounded-2xl border border-ncm-divider bg-white shadow-[0_12px_32px_rgba(0,0,0,.14)]"
    >
      <div class="flex items-center justify-between border-b border-ncm-divider px-4 py-2.5">
        <span class="text-[14px] text-ncm-fg">播放队列</span>
        <span class="text-[12px] text-ncm-fainter">{{ player.state.queue.length }} 首</span>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto">
        <p v-if="!player.state.queue.length" class="px-4 py-8 text-center text-[13px] text-ncm-fainter">队列是空的</p>
        <button
          v-for="(item, i) in player.state.queue"
          :key="item.songmid + item.source + i"
          type="button"
          class="flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-black/5"
          :class="i === player.state.index ? 'bg-ncm-accent/10' : ''"
          @click="playFromQueue(i)"
        >
          <span class="w-4 shrink-0 text-[12px] tabular-nums" :class="i === player.state.index ? 'text-ncm-accent' : 'text-ncm-fainter'">
            {{ i === player.state.index ? '♪' : i + 1 }}
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-[13px]" :class="i === player.state.index ? 'text-ncm-accent' : 'text-ncm-fg'">{{ item.name }}</span>
            <span class="block truncate text-[11px] text-ncm-fainter">{{ item.singer }}</span>
          </span>
        </button>
      </div>
    </div>

    <!-- 桌面歌词浮层 -->
    <!-- 浏览器回退：没有独立窗口时用浮层 -->
    <div
      v-if="showLyric && !nativeLyric"
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
