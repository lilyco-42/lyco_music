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
import { computed, ref, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { parseLyric, findLineIndex, getSource, hasSource, type MusicComment, type MusicItem } from '@lxmn/core'
import { useSync } from '@/lib/sync'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { usePlayer } from '@/lib/player'
import WindowControls from '@/components/layout/WindowControls.vue'
import QualityMenu from '@/components/layout/QualityMenu.vue'
import IconButton from '@/components/ui/IconButton.vue'
import { ListMusic, Maximize2, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward } from 'lucide-vue-next'

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

const parsed = computed(() => parseLyric(state.lyric, state.tlyric))
const lyrics = computed(() => parsed.value.lines)

/**
 * 纯文本歌词（没有任何时间戳）：网易云对播客/翻唱只回一段无时间轴的词。
 * 这种词不能高亮、也不该可点击跳转 —— 只静态展示。
 */
const isPlainLyric = computed(() => parsed.value.plain === true)

/** 当前唱到第几行：由 <audio> 回灌的 currentTime 驱动 */
const currentLine = computed(() => (isPlainLyric.value ? -1 : findLineIndex(lyrics.value, state.currentTime)))

/** 把正在唱的那行滚到可视区中间 */
const lyricBox = ref<HTMLElement | null>(null)

function centerActiveLine(behavior: ScrollBehavior = 'smooth'): void {
  const box = lyricBox.value
  if (!box) return
  const el = box.querySelector<HTMLElement>('[data-active="true"]')
  if (!el) { box.scrollTo({ top: 0, behavior }); return }
  // 用 rect 差值算相对滚动量：offsetTop 依赖定位祖先，容器不是 relative 时会算错
  const boxRect = box.getBoundingClientRect()
  const elRect = el.getBoundingClientRect()
  const delta = elRect.top - boxRect.top
  box.scrollTo({ top: box.scrollTop + delta - box.clientHeight / 2 + elRect.height / 2, behavior })
}

/** 当前行变化时跟随滚动（歌词滚动的核心） */
watch(currentLine, async (i) => {
  if (i < 0) return
  await nextTick()
  centerActiveLine()
})

/** 歌词刚到或者换歌时，先定位一次，否则要等下一行才动 */
watch([lyrics, () => state.lyric], async () => {
  await nextTick()
  centerActiveLine('auto')
})

/** 点歌词跳转播放位置（进度条之外最自然的 seek 方式） */
function seekTo(time: number): void {
  // 纯文本歌词的时间是造出来的，跳过去只会乱，直接忽略
  if (isPlainLyric.value) return
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


const { library, favorites } = useSync()

/** 评论只对实现了 getComments 的音源有效（当前是网易云） */
const commentSource = computed(() => {
  const src = state.playingItem?.source ?? current.value?.source ?? ''
  return src && hasSource(src) && Boolean(getSource(src).getComments) ? src : ''
})

const comments = ref<MusicComment[]>([])
const commentTotal = ref(0)
const commentPage = ref(1)
const commentLoading = ref(false)
const commentError = ref('')
const commentMore = ref(true)

async function loadComments(reset = false): Promise<void> {
  const item = state.playingItem ?? current.value
  if (!item || !commentSource.value) return
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
    const res = await getSource(commentSource.value).getComments!(item, commentPage.value, 20)
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
watch([() => (current.value ? current.value.source + '-' + String(current.value.songmid) : ''), activeTab], ([, tab]) => {
  if (tab === 'comment') void loadComments(true)
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
              <div class="size-[286px] overflow-hidden rounded-full bg-gradient-to-br from-[#3a3a3a] to-[#141414]">
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
        </div>

        <!-- 副标题：18px，距歌名 15px -->
        <p class="mt-[8px] truncate text-[18px] leading-[26px] text-ncmd-muted">{{ singer || '—' }}</p>

        <!-- 元信息：距副标题 11px -->
        <p class="mt-[6px] truncate text-[17px] leading-[24px] text-ncmd-muted">
          专辑：{{ album || '未知' }}&nbsp;&nbsp;歌手：{{ singer || '未知' }}&nbsp;&nbsp;来源：{{ current?.source?.toUpperCase() ?? '—' }}
        </p>

        <!-- 页签切换器（shadcn-vue Tabs）：222x42，圆角 21px，位于 (1005,265) -->
        <Tabs v-model="activeTab" class="mt-[28px] flex min-h-0 flex-1 flex-col">
          <TabsList>
            <TabsTrigger v-for="t in tabs" :key="t.key" :value="t.key">
              {{ t.label }}
            </TabsTrigger>
          </TabsList>

          <!-- 歌词区：与页签间留约 260px 空白，起始 y=573 -->
          <TabsContent value="lyric" class="mt-[24px] flex min-h-0 max-w-[620px] flex-1 flex-col pb-4">
            <div ref="lyricBox" class="min-h-0 flex-1 overflow-y-auto pr-3">
              <p v-if="!lyrics.length" class="text-[20px] leading-[32px] text-ncmd-dim">暂无歌词</p>
              <div
                v-for="(line, i) in lyrics"
                :key="i"
                :data-active="i === currentLine"
                class="transition-[margin]"
                :class="[
                  isPlainLyric ? 'cursor-default' : 'cursor-pointer',
                  i === currentLine ? 'mb-[18px]' : 'mb-[14px]',
                ]"
                @click="seekTo(line.time)"
              >
                <p
                  class="text-[22px] leading-[30px] transition-colors"
                  :class="i === currentLine ? 'text-ncmd-fg' : (isPlainLyric ? 'text-ncmd-muted' : 'text-ncmd-dim')"
                >
                  {{ line.text || '·' }}
                </p>
                <p
                  v-if="line.translation"
                  class="mt-[2px] text-[19px] leading-[26px] transition-colors"
                  :class="i === currentLine ? 'text-ncmd-muted' : 'text-ncmd-darker'"
                >
                  {{ line.translation }}
                </p>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="comment" class="mt-[16px] flex min-h-0 max-w-[680px] flex-1 flex-col pb-4">
            <div class="mb-2 flex items-baseline gap-2 text-[13px] text-ncmd-muted">
              <span>评论</span>
              <span v-if="commentTotal">{{ fmtLikes(commentTotal) }}</span>
              <span v-if="!commentSource" class="text-ncmd-dim">当前音源不提供评论</span>
            </div>
            <div class="min-h-0 flex-1 overflow-y-auto pr-3">
              <p v-if="commentLoading && !comments.length" class="text-[15px] text-ncmd-dim">加载评论中…</p>
              <p v-else-if="commentError" class="text-[15px] text-ncmd-accent">{{ commentError }}</p>
              <p v-else-if="!comments.length" class="text-[15px] text-ncmd-dim">还没有评论</p>

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
            <p v-if="similarSongs.length">正在按《{{ title }}》找相似曲目…</p>
            <ul v-else class="space-y-1">
              <li v-for="s in similarSongs" :key="s.source + s.songmid" class="truncate">
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
