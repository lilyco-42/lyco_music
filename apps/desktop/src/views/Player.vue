<script setup lang="ts">
/**
 * 播放器模式（深色）—— 实测规格：
 * 背景 #101010，底栏 #1d1d1d，高 102px
 * 黑胶中心 (518,604)、外径 574px（约窗口宽 30%），中心专辑图直径 316px
 * 唱针转轴 (518,189)，针头 (776,307)
 * 右侧信息区 x=1005 起：歌名 34~36px、页签 (1005,265) 222x42 圆角 21px
 * 歌词区起始 y=573（与页签间留约 260px）
 * 无垂直分割线，靠亮度差与留白分区
 *
 * 数据全部来自 usePlayer()，不再有写死的示例歌词：
 * 歌词由内核的 parseLyric 解析 LRC，再用二分定位当前行。
 */
import { computed, onBeforeUnmount, ref, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { findLineIndex, getSource, hasSource, type MusicComment, type MusicItem, type SourceId } from '@lxmn/core'
import { viewLyric } from '@/lib/lyric-view'
import { prefs } from '@/lib/prefs'
import { findSameSong } from '@/lib/same-song'
import { lyricScrollDelta, type LyricScrollMode } from '@/lib/lyric-style'
import { buildLrc } from '@/lib/lrc-export'
import { saveText, safeFileName } from '@/lib/download'
import { toast } from '@/lib/toast'
import { useSync } from '@/lib/sync'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { usePlayer } from '@/lib/player'
import WindowControls from '@/components/layout/WindowControls.vue'
import QualityMenu from '@/components/layout/QualityMenu.vue'
import IconButton from '@/components/ui/IconButton.vue'
import { Download, ListMusic, Maximize2, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, ThumbsDown } from 'lucide-vue-next'

const router = useRouter()
const player = usePlayer()

const activeTab = ref('lyric')
const tabs = [
  { key: 'lyric', label: '歌词' },
  { key: 'comment', label: '评论' },
  { key: 'wiki', label: '百科' },
  { key: 'similar', label: '相似推荐' },
] as const

const current = computed(() => player.current.value)
const state = player.state

/** 黑胶只在真正播放时转，暂停就停 —— 之前是独立的 spinning，会和实际状态脱节 */
const spinning = computed(() => state.playing)

const parsed = computed(() => viewLyric(state.lyric, state.tlyric, state.romalrc, state.ylyric))
const lyrics = computed(() => parsed.value.lines)

/**
 * 逐字染色用的「实时播放位置」。
 *
 * <audio> 的 timeupdate 只有 ~4Hz，用它染色会一格一格跳（每 250ms 才亮一个字）。
 * 这里在播放时用 rAF 直接读 audio.currentTime，拿到真正的帧级时间；
 * 不播放就停掉，不空转。
 */
const nowTime = ref(0)
let raf = 0
let audioEl: HTMLAudioElement | null = null

/**
 * 当前行已经唱到第几个字。
 *
 * 单独用一个 ref 存「已唱字数」而不是让模板直接读 nowTime：
 * 后者会让整个歌词列表每帧重渲染一次，而实际上只有「字数变化」的那一刻
 * 才需要动 DOM（一行最多几十个字，一秒也就变几次）。
 */
const litChars = ref(0)

function updateKaraoke(t: number): void {
  const i = currentLine.value
  const line = lyrics.value[i]
  if (!line || isPlainLyric.value) {
    if (litChars.value !== 0) litChars.value = 0
    return
  }
  // 这一行唱到下一行开始为止；最后一行没有下一行，按 4 秒估
  const next = lyrics.value[i + 1]?.time ?? (line.time + 4)
  const span = Math.max(0.4, next - line.time)
  const ratio = Math.min(1, Math.max(0, (t - line.time) / span))
  const total = [...line.text].length
  const n = Math.round(ratio * total)
  if (n !== litChars.value) litChars.value = n
}

function tick(): void {
  if (!audioEl) audioEl = document.querySelector('audio')
  const t = audioEl?.currentTime
  if (typeof t === 'number' && Number.isFinite(t)) {
    nowTime.value = t
    updateKaraoke(t)
  }
  raf = requestAnimationFrame(tick)
}

watch(
  () => state.playing,
  p => {
    if (p && !raf) raf = requestAnimationFrame(tick)
    else if (!p && raf) { cancelAnimationFrame(raf); raf = 0 }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  if (raf) cancelAnimationFrame(raf)
  raf = 0
})

/** 这个字是否已经唱到（唱到的字变亮，其余保持暗色） */
function wordSung(w: { time: number }): boolean {
  return nowTime.value >= w.time
}

/**
 * 纯文本歌词（没有任何时间戳）：网易云对播客/翻唱只回一段无时间轴的词。
 * 这种词不能高亮、也不该可点击跳转 —— 只静态展示。
 */
const isPlainLyric = computed(() => parsed.value.plain === true)

/** 当前唱到第几行：由 <audio> 回灌的 currentTime 驱动 */
/* ---------------- 歌词偏移 ---------------- */

/**
 * 歌词偏移（秒）。
 *
 * 不同来源的歌词时间轴经常差半秒到两秒：有的源从「第一句开口」开始计时，
 * 有的从「前奏第一拍」开始。偏移是**整体平移**，不是只影响当前行 ——
 * 一旦出现「人声到了歌词还没到」，调这个最快。
 *
 * 约定：offset > 0 表示歌词**晚**出现（播放位置减去 offset 再去查行）。
 */
const OFFSET_MAX = 5
const OFFSET_STEP = 0.5

/**
 * 偏移存在全局偏好里（不再用本页私有 key）。
 *
 * 原来只有播放页认这个值，播放栏和桌面歌词各走各的 —— 用户调完发现
 * 「这边对齐了，桌面歌词还是慢半拍」。现在三处共用一份，
 * 由 viewLyric() 在解析阶段统一平移时间轴。
 */
const lyricOffset = computed({
  get: () => prefs.lyricOffset,
  set: v => {
    prefs.lyricOffset = Math.max(-OFFSET_MAX, Math.min(OFFSET_MAX, Math.round(v / OFFSET_STEP) * OFFSET_STEP))
  },
})

function setOffset(v: number): void {
  lyricOffset.value = v
  void nextTick().then(() => centerActiveLine())
}

const offsetLabel = computed(() => (lyricOffset.value > 0 ? '+' : '') + lyricOffset.value.toFixed(1) + 's')

const currentLine = computed(() =>
  isPlainLyric.value ? -1 : findLineIndex(lyrics.value, state.currentTime),
)

/** 把正在唱的那行滚到可视区中间 */
const lyricBox = ref<HTMLElement | null>(null)

/**
 * 滚动方式（仿 lx-music 的「居中 / 逐行」）：
 *   center —— 当前行始终停在可视区正中，跳转感最明显；
 *   line   —— 当前行钉在顶部，一行一行往下推，长歌词读起来更稳。
 * 存 localStorage：这是纯观感偏好，不值得为它加一条服务端同步。
 */
const SCROLL_KEY = 'lxmn.lyric.scroll'
const SCROLL_MODES = [
  { id: 'center' as const, label: '居中' },
  { id: 'line' as const, label: '逐行' },
]

function readScrollMode(): LyricScrollMode {
  try {
    return localStorage.getItem(SCROLL_KEY) === 'line' ? 'line' : 'center'
  } catch {
    return 'center'
  }
}

const scrollMode = ref<LyricScrollMode>(readScrollMode())

function setScrollMode(mode: LyricScrollMode): void {
  scrollMode.value = mode
  try {
    localStorage.setItem(SCROLL_KEY, mode)
  } catch {
    // 隐私模式下写不进去，只影响下次启动的默认值
  }
  // 切完立刻按新模式重定位，否则要等下一句歌词才动
  void nextTick().then(() => centerActiveLine())
}

/* ---------------- 歌词对齐（左 / 中 / 右） ---------------- */

/**
 * 对齐方式。
 *
 * 默认左对齐：中文歌词多为长句，居中后每行起点参差，读起来反而更累；
 * 但投影/桌面歌词场景下居中最省眼睛，所以给三档并记住选择。
 */
const ALIGN_KEY = 'lxmn.lyric.align'
const ALIGNS = [
  { id: 'left' as const, label: '左' },
  { id: 'center' as const, label: '中' },
  { id: 'right' as const, label: '右' },
]
type LyricAlign = (typeof ALIGNS)[number]['id']

function readAlign(): LyricAlign {
  try {
    const v = localStorage.getItem(ALIGN_KEY)
    return v === 'center' || v === 'right' ? v : 'left'
  } catch {
    return 'left'
  }
}

const align = ref<LyricAlign>(readAlign())

function setAlign(a: LyricAlign): void {
  align.value = a
  try {
    localStorage.setItem(ALIGN_KEY, a)
  } catch {
    // 隐私模式下写不进去，只影响下次启动的默认值
  }
}

const alignClass = computed(() =>
  align.value === 'center' ? 'text-center' : align.value === 'right' ? 'text-right' : 'text-left',
)

/* ---------------- 歌词层级开关（原文 / 罗马音 / 翻译） ---------------- */

/**
 * 三行各自可关。
 *
 * 默认全开：日文歌三行叠着信息量刚好；但很多人只想看原文，
 * 或者看中文翻译练语感 —— 不给开关就只能忍着。
 * 全关时回落到原文，否则整块歌词会变成一片空白，看着像加载失败。
 */
const LAYER_KEY = 'lxmn.lyric.layers'

function readLayers(): { original: boolean; romaji: boolean; translation: boolean } {
  try {
    const raw = localStorage.getItem(LAYER_KEY)
    if (raw) {
      const v = JSON.parse(raw) as Partial<Record<'original' | 'romaji' | 'translation', boolean>>
      return { original: v.original !== false, romaji: v.romaji !== false, translation: v.translation !== false }
    }
  } catch {
    // 读不出来就用默认值
  }
  return { original: true, romaji: true, translation: true }
}

const layers = ref(readLayers())

/**
 * 三个可切换的字幕层。
 *
 * 播放器右侧只有约 600px 宽，用「原文 / 罗马音 / 翻译」会把整行挤到换行
 * （实测每个字竖着排）。单字标签 + title 说明，既省地方也一眼能认。
 */
const LAYER_OPTIONS = [
  { key: 'original' as const, label: '原', name: '原文' },
  { key: 'romaji' as const, label: '罗', name: '罗马音' },
  { key: 'translation' as const, label: '译', name: '翻译' },
]

function toggleLayer(key: 'original' | 'romaji' | 'translation'): void {
  layers.value = { ...layers.value, [key]: !layers.value[key] }
  try {
    localStorage.setItem(LAYER_KEY, JSON.stringify(layers.value))
  } catch {
    // 只影响下次启动的默认值
  }
}

/** 这一行要显示哪几行文字：第一行当主行（大字），其余当副行（小字） */
function layersOf(line: { text: string; romaji?: string; translation?: string }): string[] {
  const out: string[] = []
  if (layers.value.original && line.text) out.push(line.text)
  if (layers.value.romaji && line.romaji) out.push(line.romaji)
  if (layers.value.translation && line.translation) out.push(line.translation)
  if (!out.length) out.push(line.text || '·')
  return out
}

/* ---------------- 歌词导出 ---------------- */

const exporting = ref(false)

/**
 * 导出当前歌词为 .lrc。
 *
 * 导的是**界面上看到的这份**（原文 + 罗马音 + 翻译），
 * 不是音源返回的原始串 —— 用户导出的目的通常是拿去别的播放器用，
 * 那份翻译是我们在网易云补的，原串里根本没有。
 */
async function exportLyric(): Promise<void> {
  const t = current.value
  if (exporting.value || !t || !lyrics.value.length) return
  exporting.value = true
  try {
    const text = buildLrc(
      { title: t.name, artist: t.singer, album: t.albumName },
      lyrics.value,
      isPlainLyric.value,
    )
    const res = await saveText(safeFileName(`${t.name} - ${t.singer}`) + '.lrc', text)
    if (res.canceled) return
    toast(res.ok ? '歌词已导出' : `导出失败：${res.error ?? '未知错误'}`)
  } finally {
    exporting.value = false
  }
}

function centerActiveLine(behavior: ScrollBehavior = 'smooth'): void {  const box = lyricBox.value
  if (!box) return
  const el = box.querySelector<HTMLElement>('[data-active="true"]')
  if (!el) { box.scrollTo({ top: 0, behavior }); return }
  // 用 rect 差值算相对滚动量：offsetTop 依赖定位祖先，容器不是 relative 时会算错
  const boxRect = box.getBoundingClientRect()
  const elRect = el.getBoundingClientRect()
  const delta = lyricScrollDelta(scrollMode.value, {
    boxHeight: box.clientHeight,
    lineTop: elRect.top - boxRect.top,
    lineHeight: elRect.height,
  })
  box.scrollTo({ top: box.scrollTop + delta, behavior })
}

/* ---------------- 歌词字号（3.6） ---------------- */

/**
 * 详情页歌词字号。
 *
 * 和桌面歌词的字号分开：那边是浮在桌面上的大字（默认 34px），
 * 这边是跟着页面读的中等字号（默认 22px），共用一个值会让两边都不舒服。
 */
const FONT_MIN = 14
const FONT_MAX = 34

const lyricFontSize = computed(() => prefs.playLyricFontSize)

function setLyricFont(v: number): void {
  prefs.playLyricFontSize = Math.max(FONT_MIN, Math.min(FONT_MAX, Math.round(v)))
  void nextTick().then(() => centerActiveLine())
}

/** 主行与副行的字号/行高：副行按主行的 0.86 倍走，比例固定 */
function lineFontStyle(sub: boolean): Record<string, string> {
  const size = lyricFontSize.value * (sub ? 0.86 : 1)
  return { fontSize: size + 'px', lineHeight: Math.round(size * 1.4) + 'px' }
}

/* ---------------- 歌词滚动 ---------------- */

let scrollTimer: ReturnType<typeof setTimeout> | null = null

/**
 * 当前行变化时跟随滚动。
 *
 * 延迟滚动（3.8）：把滚动推迟 N 毫秒，让当前行先唱一小段再居中 ——
 * 有些歌一句特别长，行一出现就滚会让人反复「重新找位置」。
 * 每次切行都要清掉上一次的定时器，否则快速切歌时会攒下一串滚动动作。
 */
watch(currentLine, async (i) => {
  if (i < 0) return
  if (scrollTimer) { clearTimeout(scrollTimer); scrollTimer = null }
  const delay = prefs.lyricScrollDelay
  if (delay > 0) {
    scrollTimer = setTimeout(() => {
      scrollTimer = null
      void nextTick().then(() => centerActiveLine())
    }, delay)
    return
  }
  await nextTick()
  centerActiveLine()
})

/** 歌词刚到或者换歌时，先定位一次，否则要等下一行才动 */
watch([lyrics, () => state.lyric], async () => {
  await nextTick()
  centerActiveLine('auto')
})

/* ---------------- 拖拽歌词调进度 ---------------- */

/**
 * 按住歌词区上下拖动可以刮擦定位（仿 lx 的「拖拽歌词调整播放进度」）。
 *
 * 为什么不用 click：click 只能跳到「点中的那一行」，用户想微调前后几句时
 * 得反复点。拖动是连续的，松手即定。
 *
 * 节流 120ms：每次 seek 都会让 <audio> 重新定位，几百毫秒内连发十几次
 * 会让声音一顿一顿的，反而更难对准。
 */
const dragSeeking = ref(false)
const dragHint = ref('')
let lastSeekAt = 0

function lyricLineAt(x: number, y: number): { time: number; text: string } | null {
  const el = document.elementFromPoint(x, y)?.closest('[data-lyric-index]') as HTMLElement | null
  if (!el) return null
  const line = lyrics.value[Number(el.dataset.lyricIndex)]
  return line ? { time: line.time, text: line.text } : null
}

function onLyricDragMove(e: PointerEvent): void {
  if (!dragSeeking.value) return
  const hit = lyricLineAt(e.clientX, e.clientY)
  if (!hit) return
  dragHint.value = fmt(hit.time) + '  ' + hit.text.slice(0, 24)
  const now = Date.now()
  if (now - lastSeekAt < 120) return
  lastSeekAt = now
  player.seek(hit.time)
}

function onLyricDragUp(): void {
  if (!dragSeeking.value) return
  dragSeeking.value = false
  dragHint.value = ''
  window.removeEventListener('pointermove', onLyricDragMove)
  window.removeEventListener('pointerup', onLyricDragUp)
}

function onLyricPointerDown(e: PointerEvent): void {
  if (isPlainLyric.value || e.button !== 0) return
  // 拖动刮擦定位可以在设置里关掉（3.7）：有人习惯在歌词区框选文字
  if (!prefs.lyricSeekByDrag) return
  dragSeeking.value = true
  lastSeekAt = 0
  window.addEventListener('pointermove', onLyricDragMove)
  window.addEventListener('pointerup', onLyricDragUp)
  onLyricDragMove(e)
}

/** 点歌词跳转播放位置（进度条之外最自然的 seek 方式） */
function seekTo(time: number): void {
  // 纯文本歌词的时间是造出来的，跳过去只会乱，直接忽略
  if (isPlainLyric.value) return
  // 歌词时间轴已经按偏移平移过，行时间就是音频时间
  player.seek(time)
}

const QUALITY_LABEL: Record<string, string> = {
  '128k': '标准', '320k': '极高', flac: '无损', flac24bit: 'Hi-Res',
  hires: 'Hi-Res', atmos: '沉浸环绕', master: '超清母带',
}
const qualityLabel = computed(() => QUALITY_LABEL[state.quality] ?? state.quality)

/* 播放模式：图标随模式变，点一下切下一档 */
const modeIcon = computed(() => {
  if (state.mode === 'single') return Repeat1
  if (state.mode === 'shuffle') return Shuffle
  return Repeat
})
const modeLabel = computed(() => player.modeLabel())

const progressPct = computed(() =>
  state.duration > 0 ? Math.min(100, (state.currentTime / state.duration) * 100) : 0)

function fmt(t: number): string {
  if (!Number.isFinite(t) || t < 0) t = 0
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return m + ':' + String(s).padStart(2, '0')
}

const cover = computed(() => state.picUrl)
const title = computed(() => current.value?.name ?? '未在播放')
const singer = computed(() => current.value?.singer ?? '')
const album = computed(() => current.value?.albumName ?? '')

/* ---------------- 评论 ---------------- */


const { library, favorites, dislikes, isDisliked, dislike, undislike } = useSync()

/**
 * 当前这首是否已被标记「不喜欢」。
 *
 * 依赖 dislikes 是为了让按钮在规则变化后重算 —— isDisliked 读的是
 * 内核里的索引，Vue 追踪不到它。
 */
const disliked = computed(() => {
  void dislikes.value
  const item = state.playingItem ?? current.value
  return item ? isDisliked({ name: item.name, singer: item.singer }) : false
})

async function toggleDislike(): Promise<void> {
  const item = state.playingItem ?? current.value
  if (!item) return
  const target = { name: item.name, singer: item.singer }
  if (disliked.value) {
    await undislike(target)
    toast('已取消不喜欢')
  } else {
    await dislike(target)
    toast('已加入不喜欢，之后不再推荐这首')
  }
}

/** 评论只对实现了 getComments 的音源有效（当前是网易云） */
const commentSource = computed(() => commentTarget.value?.source ?? '')

/**
 * 评论目标。
 *
 * 酷狗/酷我/咪咕都没有可用的评论接口，但「这首歌在网易云上有没有评论」
 * 和「我是从哪个源播的」没有关系 —— 同一首歌，评论是同一批人写的。
 * 所以当前音源没有评论能力时，按「歌名 + 歌手」去网易云找同一首，
 * 借它的评论展示，并在界面上如实标注来源。
 */
const commentTarget = ref<{ source: SourceId; item: MusicItem; borrowed: boolean } | null>(null)
const commentResolving = ref(false)

async function resolveCommentTarget(): Promise<void> {
  const item = state.playingItem ?? current.value
  commentTarget.value = null
  if (!item) return
  if (hasSource(item.source) && getSource(item.source).getComments) {
    commentTarget.value = { source: item.source, item, borrowed: false }
    return
  }
  if (!hasSource('wy')) return
  const wy = getSource('wy')
  if (!wy.getComments) return
  commentResolving.value = true
  try {
    // 复用「同一首歌在别处是哪一条」的缓存：歌词补翻译时可能已经查过了
    const match = await findSameSong(item, 'wy')
    if (match) commentTarget.value = { source: match.source, item: match, borrowed: true }
  } catch {
    // 找不到就当作没有评论，不要用一个英文报错糊在界面上
  } finally {
    commentResolving.value = false
  }
}

const comments = ref<MusicComment[]>([])
const commentTotal = ref(0)
const commentPage = ref(1)
const commentLoading = ref(false)
const commentError = ref('')
const commentMore = ref(true)
/** 评论排序（9.1）：热门第一页带热评，最新只按时间倒序 */
const commentSort = ref<'hot' | 'new'>('hot')

async function loadComments(reset = false): Promise<void> {
  const target = commentTarget.value
  if (!target) return
  if (commentLoading.value) return
  if (reset) {
    comments.value = []
    commentPage.value = 1
    commentTotal.value = 0
    commentMore.value = true
    commentError.value = ''
  }
  commentLoading.value = true
  try {
    const res = await getSource(target.source).getComments!(target.item, commentPage.value, 20, commentSort.value)
    comments.value = commentPage.value === 1 ? res.list : [...comments.value, ...res.list]
    commentTotal.value = res.total
    commentMore.value = res.more && res.list.length > 0
    if (res.list.length) commentPage.value += 1
  } catch (e) {
    commentError.value = e instanceof Error ? e.message : String(e)
  } finally {
    commentLoading.value = false
  }
}

/** 切歌或切到评论页签时按需加载（不要在歌词页也去请求评论） */
watch([() => (current.value ? current.value.source + '-' + String(current.value.songmid) : ''), activeTab], async ([, tab]) => {
  if (tab !== 'comment') return
  await resolveCommentTarget()
  await loadComments(true)
}, { immediate: true })

function fmtLikes(n: number): string {
  if (n >= 10000) return (n / 10000).toFixed(1) + '万'
  return String(n)
}

function fmtCommentTime(t: number): string {
  if (!t) return ''
  const d = new Date(t)
  const p = (x: number) => String(x).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}

/* ---------------- 收藏（爱心） ---------------- */

function isFavorite(): boolean {
  const item = state.playingItem ?? current.value
  if (!item) return false
  return favorites.value.some(f => f.source === item.source && String(f.songmid) === String(item.songmid))
}

function toggleFavorite(): void {
  const item = state.playingItem ?? current.value
  if (!item) return
  void library.toggleFavorite(item)
}

/** 相似推荐：拿当前曲目的「歌名 + 歌手」再搜一遍，去掉自己 */
const similarSongs = ref<MusicItem[]>([])
watch(
  () => (current.value ? current.value.source + '-' + String(current.value.songmid) : ''),
  async () => {
    similarSongs.value = []
    const t = current.value
    if (!t) return
    try {
      const r = await player.search(t.name + ' ' + t.singer, 1, 10)
      similarSongs.value = r.list
        .filter(x => !(x.source === t.source && String(x.songmid) === String(t.songmid)))
        .slice(0, 8)
    } catch {
      // 相似推荐失败不影响播放
    }
  },
  { immediate: true },
)

/** 点相似曲目直接播（以前列表是死的，只能看不能点） */
function playSimilar(s: MusicItem): void {
  void player.play(s, similarSongs.value)
}

/** 全屏切换：Electron 里交给 BrowserWindow，浏览器里退化成 Fullscreen API */
function toggleFullscreen(): void {
  const doc = document
  if (!doc.fullscreenElement) void doc.documentElement.requestFullscreen().catch(() => undefined)
  else void doc.exitFullscreen().catch(() => undefined)
}

function close(): void {
  router.push({ name: 'home' })
}

/** 点进度条跳转：按点击位置换算成秒数 */
function onSeekClick(e: MouseEvent): void {
  const box = e.currentTarget as HTMLElement | null
  if (!box || state.duration <= 0) return
  const rect = box.getBoundingClientRect()
  const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
  player.seek(ratio * state.duration)
}

function onVolume(e: Event): void {
  const v = Number((e.target as HTMLInputElement).value) / 100
  player.setVolume(Math.min(1, Math.max(0, v)))
}



const vinylStyle = computed(() => ({
  background: 'repeating-radial-gradient(circle, #111 0, #111 2px, #181818 3px, #181818 4px)',
  boxShadow: '0 10px 30px rgba(0,0,0,.35), inset 0 0 0 2px rgba(255,255,255,.04)',
}))
</script>

<template>
  <div class="relative h-full w-full overflow-hidden bg-ncmd-bg text-ncmd-fg">
    <!--
      模糊背景：把封面放大到铺满再重模糊，模拟网易云的「沉浸式」底色。
      两层叠加 —— 图片本身 + 一层压暗，否则亮色封面会让白色歌词读不清。
    -->
    <div class="pointer-events-none absolute inset-0 overflow-hidden">
      <img
        v-if="cover"
        :key="cover"
        :src="cover"
        alt=""
        class="size-full scale-[1.35] object-cover opacity-55 blur-[72px] saturate-125 transition-opacity duration-700"
        referrerpolicy="no-referrer"
      />
      <div class="absolute inset-0 bg-black/35" />
      <!-- 顶部再压一层渐变，让顶栏图标在亮封面上也看得见 -->
      <div class="absolute inset-x-0 top-0 h-[120px] bg-gradient-to-b from-black/35 to-transparent" />
    </div>

    <!-- 顶栏：与背景融合，不另做色块 -->
    <div class="absolute inset-x-0 top-0 z-10 flex h-[72px] items-center justify-between pl-6 pr-1 [app-region:drag]">
      <!-- 左上：折叠箭头 -->
      <button type="button" class="text-ncmd-muted hover:text-ncmd-fg [app-region:no-drag]" aria-label="收起播放器模式" @click="close">
        <svg viewBox="0 0 24 24" class="size-5 stroke-current" fill="none" stroke-width="1.8">
          <path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>

      <!-- 右上：当前为播放器模式（只作状态标识），加全屏与窗口控制 -->
      <div class="flex items-center gap-0.5 text-ncmd-muted">
        <span class="mr-1.5 flex items-center gap-1.5 text-[14px]">
          <span class="size-[14px] rounded-full border-[1.5px] border-current" aria-hidden="true" />
          播放器模式
        </span>
        <span class="mx-0.5 h-3.5 w-px bg-ncmd-elevated" aria-hidden="true" />
        <IconButton label="全屏" tone="dark" size="lg" @click="toggleFullscreen">
          <template #default="{ size, stroke }"><Maximize2 :size="size" :stroke-width="stroke" aria-hidden="true" /></template>
        </IconButton>
        <!-- 与主界面共用同一组窗口按钮 -->
        <WindowControls tone="dark" />
      </div>
    </div>

    <!-- 主体：左黑胶 / 右信息歌词 -->
    <div class="flex h-full pt-[72px] pb-[102px]">
      <!-- ============ 左侧黑胶区 (x=0~930) ============ -->
      <div class="relative flex w-[820px] shrink-0 items-center justify-center">
        <!-- 黑胶：外径 574px，中心略偏右下 -->
        <div
          class="relative size-[520px] rounded-full transition-transform duration-[3000ms]"
          :class="spinning ? 'animate-[spin_20s_linear_infinite]' : ''"
          :style="vinylStyle"
        >
          <!-- 内圈白色粗环 + 中心专辑图 316px -->
          <div class="absolute inset-0 flex items-center justify-center">
            <div class="flex size-[308px] items-center justify-center rounded-full bg-ncmd-vinyl-ring">
              <div class="relative size-[286px] overflow-hidden rounded-full bg-gradient-to-br from-[#3a3a3a] to-[#141414]">
                <img
                  v-if="cover"
                  :src="cover"
                  alt=""
                  class="h-full w-full object-cover"
                  referrerpolicy="no-referrer"
                  @error="($event.target as HTMLImageElement).src = './art/cover-default.jpg'"
                />
                <img
                  v-else
                  :src="'./art/cover-default.jpg'"
                  alt=""
                  class="h-full w-full object-cover"
                />
                <!-- 质感滤镜：压在专辑图上，像唱片封套印的网屏 -->
                <span class="tex-img" aria-hidden="true" />
              </div>
            </div>
          </div>
        </div>

        <!-- 唱针：转轴 (518,189)，针头 (776,307) -->
        <div class="pointer-events-none absolute left-1/2 top-[70px] -translate-x-1/2">
          <div class="relative">
            <!-- 转轴底座 -->
            <div class="size-[54px] rounded-full bg-[#0a0a0a] shadow-[0_6px_16px_rgba(0,0,0,.5)]" />
            <!-- 白色机械臂 -->
            <div class="absolute left-[24px] top-[24px] h-[12px] w-[280px] origin-left rotate-[23deg] rounded-full bg-[#f2f2f2] shadow-[0_4px_10px_rgba(0,0,0,.4)]">
              <!-- 针头 -->
              <div class="absolute right-[-6px] top-[-4px] size-[20px] rounded-[4px] bg-[#e8e8e8]" />
            </div>
          </div>
        </div>

        <!-- 状态胶囊：330x49，圆角 24px，中心 (517,945) -->
        <div
          v-if="state.loading || state.error"
          class="absolute bottom-[140px] left-1/2 flex h-[49px] w-[330px] -translate-x-1/2 items-center justify-center gap-2 rounded-pill bg-black/70 px-4 backdrop-blur"
        >
          <template v-if="state.loading">
            <span class="text-[14px] text-white">正在获取播放地址…</span>
          </template>
          <template v-else>
            <span class="truncate text-[14px] text-ncmd-accent" :title="state.error">{{ state.error }}</span>
          </template>
        </div>
      </div>

      <!-- ============ 右侧信息 + 歌词区 (x=1005 起) ============ -->
      <div class="flex min-h-0 min-w-0 flex-1 flex-col pt-[25px]">
        <!-- 歌名行：34~36px，后跟音源 / 音质小标签 -->
        <div class="flex items-center gap-2">
          <h1 class="truncate text-[35px] leading-[44px] text-ncmd-fg">{{ title }}</h1>
          <span class="shrink-0 rounded-[3px] border border-ncmd-muted px-1 text-[11px] leading-[17px] text-ncmd-muted">{{ current?.source?.toUpperCase() ?? '—' }}</span>
          <span class="shrink-0 rounded-[3px] border border-ncmd-muted px-1 text-[11px] leading-[17px] text-ncmd-muted">{{ qualityLabel }}</span>
          <IconButton
            :label="isFavorite() ? '取消收藏' : '收藏这首'"
            tone="dark"
            size="lg"
            class="ml-1"
            @click="toggleFavorite"
          >
            <template #default="{ size }">
              <svg
                viewBox="0 0 24 24"
                :width="size"
                :height="size"
                :class="isFavorite() ? 'fill-ncmd-accent stroke-ncmd-accent' : 'fill-none stroke-current'"
                stroke-width="1.8"
                aria-hidden="true"
              >
                <path d="M12 20.5S4.5 15.6 3.2 11.3C2.1 7.7 4.4 4.8 7.5 4.8c1.9 0 3.4 1 4.5 2.6 1.1-1.6 2.6-2.6 4.5-2.6 3.1 0 5.4 2.9 4.3 6.5C19.5 15.6 12 20.5 12 20.5z" />
              </svg>
            </template>
          </IconButton>
          <IconButton
            :label="disliked ? '取消不喜欢' : '不喜欢这首'"
            tone="dark"
            size="lg"
            @click="toggleDislike"
          >
            <template #default="{ size }">
              <ThumbsDown
                :size="size"
                :stroke-width="1.8"
                :class="disliked ? 'fill-ncmd-accent/25 text-ncmd-accent' : 'text-ncmd-muted'"
                aria-hidden="true"
              />
            </template>
          </IconButton>
        </div>

        <!-- 副标题：18px，距歌名 15px -->
        <p class="mt-[8px] truncate text-[18px] leading-[26px] text-ncmd-muted">{{ singer || '—' }}</p>

        <!-- 元信息：距副标题 11px -->
        <p class="mt-[6px] truncate text-[17px] leading-[24px] text-ncmd-muted">
          专辑：{{ album || '未知' }}&nbsp;&nbsp;歌手：{{ singer || '未知' }}&nbsp;&nbsp;来源：{{ current?.source?.toUpperCase() ?? '—' }}
        </p>

        <!-- 页签切换器（shadcn-vue Tabs）：222x42，圆角 21px，位于 (1005,265) -->
        <Tabs v-model="activeTab" class="mt-[28px] flex min-h-0 flex-1 flex-col">
          <div class="flex items-center justify-between gap-3">
            <TabsList class="shrink-0">
              <TabsTrigger v-for="t in tabs" :key="t.key" :value="t.key">
                {{ t.label }}
              </TabsTrigger>
            </TabsList>
          </div>

          <!-- 歌词控件：单独一行。挤在页签右边会超出 600px 的列宽，被窗口裁掉 -->
          <div v-if="activeTab === 'lyric'" class="mt-2 flex flex-wrap items-center gap-1 text-[12px] text-ncmd-dim">
              <!-- 字幕层级：原文 / 罗马音 / 翻译 各自可关 -->
              <button
                v-for="o in LAYER_OPTIONS"
                :key="o.key"
                type="button"
                class="shrink-0 rounded-full px-2 py-[2px] transition-colors"
                :class="layers[o.key] ? 'bg-white/15 text-ncmd-fg' : 'hover:bg-white/10 hover:text-ncmd-muted'"
                :title="layers[o.key] ? `隐藏${o.name}` : `显示${o.name}`"
                @click="toggleLayer(o.key)"
              >
                {{ o.label }}
              </button>
              <span class="mx-1 text-ncmd-darker">|</span>
              <button
                v-for="m in SCROLL_MODES"
                :key="m.id"
                type="button"
                class="shrink-0 rounded-full px-2 py-[2px] transition-colors"
                :class="scrollMode === m.id ? 'bg-white/15 text-ncmd-fg' : 'hover:bg-white/10 hover:text-ncmd-muted'"
                :title="m.id === 'center' ? '当前行始终停在可视区中间' : '当前行钉在顶部，一行一行往下推'"
                @click="setScrollMode(m.id)"
              >
                {{ m.label }}
              </button>
              <span class="mx-1 text-ncmd-darker">|</span>
              <button
                type="button"
                class="shrink-0 rounded-full px-1.5 py-[2px] tabular-nums transition-colors hover:bg-white/10"
                :class="lyricOffset === 0 ? 'text-ncmd-darker' : 'text-ncmd-fg'"
                :title="lyricOffset === 0 ? '歌词已经对齐，点一下恢复默认' : '恢复默认（歌词不偏移）'"
                @click="setOffset(0)"
              >{{ offsetLabel }}</button>
              <button
                type="button"
                class="shrink-0 rounded-full px-1.5 py-[2px] transition-colors hover:bg-white/10"
                title="歌词提前 0.5 秒"
                @click="setOffset(lyricOffset - 0.5)"
              >−</button>
              <button
                type="button"
                class="shrink-0 rounded-full px-1.5 py-[2px] transition-colors hover:bg-white/10"
                title="歌词延后 0.5 秒"
                @click="setOffset(lyricOffset + 0.5)"
              >+</button>
              <span class="mx-1 text-ncmd-darker">|</span>
              <button
                type="button"
                class="shrink-0 rounded-full px-1.5 py-[2px] transition-colors hover:bg-white/10"
                title="歌词字号变小"
                @click="setLyricFont(lyricFontSize - 2)"
              >A−</button>
              <button
                type="button"
                class="shrink-0 rounded-full px-1.5 py-[2px] transition-colors hover:bg-white/10"
                title="歌词字号变大"
                @click="setLyricFont(lyricFontSize + 2)"
              >A+</button>
              <span class="mx-1 text-ncmd-darker">|</span>
              <button
                v-for="a in ALIGNS"
                :key="a.id"
                type="button"
                class="shrink-0 rounded-full px-2 py-[2px] transition-colors"
                :class="align === a.id ? 'bg-white/15 text-ncmd-fg' : 'hover:bg-white/10 hover:text-ncmd-muted'"
                :title="`歌词${a.label}对齐`"
                @click="setAlign(a.id)"
              >
                {{ a.label }}
              </button>
              <!-- 导出歌词：把当前这首（含翻译/罗马音）存成 .lrc -->
              <button
                type="button"
                class="ml-1 shrink-0 rounded-full p-1 transition-colors hover:bg-white/10 hover:text-ncmd-muted disabled:opacity-40"
                :disabled="!lyrics.length || exporting"
                title="导出歌词为 .lrc"
                aria-label="导出歌词"
                @click="exportLyric"
              >
                <Download :size="13" :stroke-width="1.8" aria-hidden="true" />
              </button>
          </div>

          <!-- 歌词区：与页签间留约 260px 空白，起始 y=573 -->
          <TabsContent value="lyric" class="mt-[24px] flex min-h-0 max-w-[620px] flex-1 flex-col pb-4">
            <div
              ref="lyricBox"
              class="relative min-h-0 flex-1 overflow-y-auto pr-3"
              :class="[alignClass, dragSeeking ? 'cursor-grabbing select-none' : '']"
              @pointerdown="onLyricPointerDown"
            >
              <!-- 拖动时的位置提示：跟随手指不方便，固定在歌词区顶部更稳 -->
              <div
                v-if="dragHint"
                class="pointer-events-none sticky top-0 z-10 mb-2 inline-block rounded-full bg-black/70 px-3 py-1 text-[12px] text-white backdrop-blur"
              >{{ dragHint }}</div>
              <p v-if="!lyrics.length" class="text-[20px] leading-[32px] text-ncmd-dim">暂无歌词</p>
              <div
                v-for="(line, i) in lyrics"
                :key="i"
                :data-active="i === currentLine"
                :data-lyric-index="i"
                class="transition-[margin]"
                :class="[
                  isPlainLyric ? 'cursor-default' : 'cursor-pointer',
                  i === currentLine ? 'mb-[18px]' : 'mb-[14px]',
                ]"
                @click="seekTo(line.time)"
              >
                <p
                  v-for="(t, li) in layersOf(line)"
                  :key="li"
                  class="transition-colors"
                  :style="lineFontStyle(li !== 0)"
                  :class="[
                    li === 0 ? '' : 'mt-[2px]',
                    li === 0
                      ? (i === currentLine ? 'text-ncmd-fg' : (isPlainLyric ? 'text-ncmd-muted' : 'text-ncmd-dim'))
                      : (i === currentLine ? 'text-ncmd-muted' : 'text-ncmd-darker'),
                  ]"
                >
                  <!-- 逐字染色：只在「原文 + 当前行」上做，副行（罗马音/翻译）不参与 -->
                  <template v-if="li === 0 && i === currentLine && layers.original">
                    <template v-if="line.words?.length">
                      <span
                        v-for="(w, wi) in line.words"
                        :key="wi"
                        class="transition-colors duration-150"
                        :class="wordSung(w) ? 'text-ncmd-fg' : 'text-ncmd-darker'"
                      >{{ w.text }}</span>
                    </template>
                    <!-- 没有逐字时间轴时按整行时长均分：唱到第几个字，第几个字变亮 -->
                    <template v-else>
                      <span
                        v-for="(ch, ci) in [...line.text]"
                        :key="ci"
                        class="transition-colors duration-150"
                        :class="ci < litChars ? 'text-ncmd-fg' : 'text-ncmd-darker'"
                      >{{ ch }}</span>
                    </template>
                  </template>
                  <template v-else>{{ t }}</template>
                </p>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="comment" class="mt-[16px] flex min-h-0 max-w-[680px] flex-1 flex-col pb-4">
            <div class="mb-2 flex items-baseline gap-2 text-[13px] text-ncmd-muted">
              <div class="mr-2 flex items-center gap-1">
                <button
                  v-for="s in [{ id: 'hot' as const, label: '热门' }, { id: 'new' as const, label: '最新' }]"
                  :key="s.id"
                  type="button"
                  class="rounded-full px-2.5 py-[2px] text-[12px] transition-colors"
                  :class="commentSort === s.id ? 'bg-white/15 text-ncmd-fg' : 'hover:bg-white/10 text-ncmd-dim'"
                  @click="commentSort = s.id; void loadComments(true)"
                >{{ s.label }}</button>
              </div>
              <span v-if="commentTotal">{{ fmtLikes(commentTotal) }}</span>
              <span v-if="commentResolving" class="text-ncmd-dim">正在找这首歌的评论…</span>
              <span v-else-if="!commentSource" class="text-ncmd-dim">这首歌暂时没有可用的评论</span>
              <span v-else-if="commentTarget?.borrowed" class="text-ncmd-dim">来自网易云同名歌曲</span>
            </div>
            <div class="min-h-0 flex-1 overflow-y-auto pr-3">
              <p v-if="commentLoading && !comments.length" class="text-[15px] text-ncmd-dim">加载评论中…</p>
              <p v-else-if="commentError" class="text-[15px] text-ncmd-accent">{{ commentError }}</p>
              <p v-else-if="!comments.length" class="text-[15px] text-ncmd-dim">
                {{ commentResolving ? '正在找这首歌的评论…' : '还没有评论' }}
              </p>

              <article v-for="(c, ci) in comments" :key="c.id + '-' + ci" class="mb-4 flex gap-3">
                <img
                  v-if="c.avatar"
                  :src="c.avatar"
                  alt=""
                  class="size-9 shrink-0 rounded-full object-cover"
                  referrerpolicy="no-referrer"
                />
                <span v-else class="size-9 shrink-0 rounded-full bg-ncmd-elevated" />
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2 text-[13px]">
                    <span class="truncate text-ncmd-muted">{{ c.userName || '匿名用户' }}</span>
                    <span v-if="c.hot" class="shrink-0 rounded-[3px] border border-ncmd-muted px-1 text-[10px] leading-[15px] text-ncmd-muted">热评</span>
                  </div>
                  <p class="mt-1 whitespace-pre-wrap break-words text-[15px] leading-[24px] text-ncmd-fg/90">{{ c.content }}</p>
                  <div class="mt-1 flex items-center gap-3 text-[12px] text-ncmd-dim">
                    <span>{{ fmtCommentTime(c.time) }}</span>
                    <span class="flex items-center gap-1">
                      <svg viewBox="0 0 24 24" class="size-3.5 stroke-current" fill="none" stroke-width="1.8" aria-hidden="true">
                        <path d="M7 11v9H4v-9h3Zm0 0 4.5-8a2 2 0 0 1 3.6 1.6L14 9h5a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 17.8 19H7" stroke-linecap="round" stroke-linejoin="round" />
                      </svg>
                      {{ fmtLikes(c.likedCount) }}
                    </span>
                  </div>
                </div>
              </article>

              <button
                v-if="commentMore && comments.length"
                type="button"
                class="mb-6 w-full rounded-lg border border-ncmd-elevated py-2 text-[13px] text-ncmd-muted transition-colors hover:bg-white/5 disabled:opacity-50"
                :disabled="commentLoading"
                @click="loadComments()"
              >
                {{ commentLoading ? '加载中…' : '查看更多评论' }}
              </button>
            </div>
          </TabsContent>

          <TabsContent value="wiki" class="mt-[24px] text-[18px] leading-[30px] text-ncmd-dim">
            <p>专辑：{{ album || '未知' }}</p>
            <p class="mt-2">歌手：{{ singer || '未知' }}</p>
            <p class="mt-2">来源：{{ current?.source?.toUpperCase() ?? '—' }} · 音质 {{ qualityLabel }}</p>
          </TabsContent>
          <TabsContent value="similar" class="mt-[24px] text-[18px] leading-[30px] text-ncmd-dim">
            <p v-if="!similarSongs.length">没有找到相似曲目</p>
            <ul v-else class="space-y-1">
              <li
                v-for="s in similarSongs"
                :key="s.source + s.songmid"
                class="cursor-pointer truncate transition-colors hover:text-ncmd-fg"
                :title="s.name + ' — ' + s.singer"
                @click="playSimilar(s)"
              >
                {{ s.name }} — {{ s.singer }}
              </li>
            </ul>
          </TabsContent>
        </Tabs>
      </div>
    </div>

    <!-- ============ 底部播放条：高 102px ============ -->
    <div class="absolute inset-x-0 bottom-0 h-[102px] bg-ncmd-bottombar">
      <!-- 进度条贴顶，高 3~4px：可点击跳转 -->
      <div
        class="absolute inset-x-0 top-0 h-[4px] cursor-pointer bg-ncmd-elevated"
        role="slider"
        :aria-valuenow="Math.round(progressPct)"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-label="播放进度"
        @click="onSeekClick"
      >
        <div class="h-full bg-[#a8a8a8]" :style="{ width: progressPct + '%' }" />
      </div>

      <!-- 左：歌名 + 标签 + 歌手，左边距 50px -->
      <div class="absolute left-[50px] top-[27px] max-w-[320px]">
        <div class="flex items-center gap-1.5">
          <span class="truncate text-[18px] text-ncmd-fg">{{ title }}</span>
          <span class="shrink-0 rounded-[3px] border border-ncmd-muted px-1 text-[10px] leading-4 text-ncmd-muted">{{ current?.source?.toUpperCase() ?? '—' }}</span>
          <span class="shrink-0 rounded-[3px] border border-ncmd-muted px-1 text-[10px] leading-4 text-ncmd-muted">{{ qualityLabel }}</span>
        </div>
        <div class="mt-[7px] truncate text-[17px] text-ncmd-muted">
          {{ singer }}<template v-if="state.duration"> · {{ fmt(state.currentTime) }} / {{ fmt(state.duration) }}</template>
        </div>
      </div>

      <!-- 中央控制区：中心 x=960，按钮间距 29~34px -->
      <div class="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-[31px]">
        <IconButton :label="modeLabel" tone="dark" size="lg" @click="player.cycleMode()">
          <template #default="{ size, stroke }">
            <component :is="modeIcon" :size="size" :stroke-width="stroke" aria-hidden="true" />
          </template>
        </IconButton>
        <IconButton label="上一首" tone="dark" size="lg" :disabled="!state.queue.length" @click="player.prev()">
          <template #default="{ size, stroke }"><SkipBack :size="size" :stroke-width="stroke" aria-hidden="true" /></template>
        </IconButton>
        <button
          type="button"
          class="mx-1 flex size-[52px] shrink-0 items-center justify-center rounded-full bg-ncmd-surface text-white transition-colors hover:bg-ncmd-elevated disabled:cursor-not-allowed disabled:opacity-40"
          :aria-label="state.playing ? '暂停' : '播放'"
          :disabled="state.loading || !current"
          @click="player.toggle()"
        >
          <Pause v-if="state.playing" :size="24" :stroke-width="0" fill="currentColor" aria-hidden="true" />
          <Play v-else :size="24" :stroke-width="0" fill="currentColor" class="translate-x-[1px]" aria-hidden="true" />
        </button>
        <IconButton label="下一首" tone="dark" size="lg" :disabled="!state.queue.length" @click="player.next()">
          <template #default="{ size, stroke }"><SkipForward :size="size" :stroke-width="stroke" aria-hidden="true" /></template>
        </IconButton>
        <IconButton label="播放列表" tone="dark" size="lg">
          <template #default="{ size, stroke }"><ListMusic :size="size" :stroke-width="stroke" aria-hidden="true" /></template>
        </IconButton>
      </div>

      <!-- 右：音质 / 词 / 音量 / 更多，从 x≈1642 起 -->
      <div class="absolute right-[49px] top-1/2 flex -translate-y-1/2 items-center gap-[29px] text-ncmd-muted">
        <QualityMenu tone="dark" />
        <button type="button" class="text-[15px] hover:text-ncmd-fg" @click="activeTab = 'lyric'">词</button>
        <div class="flex items-center gap-2">
          <svg viewBox="0 0 24 24" class="size-[19px] stroke-current" fill="none" stroke-width="1.8">
            <path d="M4 9v6h3l4 3V6L7 9H4ZM16 9a4 4 0 0 1 0 6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <input
            type="range"
            min="0"
            max="100"
            :value="Math.round(state.volume * 100)"
            class="h-1 w-[70px] accent-[#a8a8a8]"
            aria-label="音量"
            @input="onVolume"
          />
        </div>
        <button type="button" class="text-[18px] leading-none hover:text-ncmd-fg">…</button>
      </div>
    </div>
  </div>
</template>
