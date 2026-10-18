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
import { parseLyric, findLineIndex, type MusicItem } from '@lxmn/core'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { usePlayer } from '@/lib/player'
import WindowControls from '@/components/layout/WindowControls.vue'

const router = useRouter()
const player = usePlayer()

const activeTab = ref('lyric')
const tabs = [
  { key: 'lyric', label: '歌词' },
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

/** 音质循环：只在已安装音源真正支持的那些里转 */
function cycleQuality(): void {
  const order = player.qualityOrder
  if (!order.length) return
  const at = order.indexOf(state.quality)
  const next = order[(at + 1) % order.length]
  if (next) void player.setQuality(next)
}

const vinylStyle = computed(() => ({
  background: 'repeating-radial-gradient(circle, #111 0, #111 2px, #181818 3px, #181818 4px)',
  boxShadow: '0 10px 30px rgba(0,0,0,.35), inset 0 0 0 2px rgba(255,255,255,.04)',
}))
</script>

<template>
  <div class="relative h-full w-full overflow-hidden bg-ncmd-bg text-ncmd-fg">
    <!-- 顶栏：与背景融合，不另做色块 -->
    <div class="absolute inset-x-0 top-0 z-10 flex h-[100px] items-center justify-between px-[52px] [app-region:drag]">
      <!-- 左上：折叠箭头 -->
      <button type="button" class="text-ncmd-muted hover:text-ncmd-fg [app-region:no-drag]" aria-label="收起播放器模式" @click="close">
        <svg viewBox="0 0 24 24" class="size-5 stroke-current" fill="none" stroke-width="1.8">
          <path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>

      <!-- 右上：播放器模式 + 窗口控制 -->
      <div class="flex items-center gap-3 text-ncmd-muted">
        <span class="size-[18px] rounded-full border-[1.5px] border-current" />
        <span class="text-[18px]">播放器模式</span>
        <span class="mx-1 h-4 w-px bg-ncmd-elevated" />
        <button
          type="button"
          class="size-[18px] rounded-[3px] border-[1.5px] border-current [app-region:no-drag]"
          aria-label="全屏"
          @click="toggleFullscreen"
        />
        <!-- 与主界面共用同一组窗口按钮：这里原来是一套只会画图的假按钮 -->
        <WindowControls tone="dark" class="ml-2" />
      </div>
    </div>

    <!-- 主体：左黑胶 / 右信息歌词 -->
    <div class="flex h-full pt-[100px] pb-[102px]">
      <!-- ============ 左侧黑胶区 (x=0~930) ============ -->
      <div class="relative flex w-[930px] shrink-0 items-center justify-center">
        <!-- 黑胶：外径 574px，中心略偏右下 -->
        <div
          class="relative size-[574px] rounded-full transition-transform duration-[3000ms]"
          :class="spinning ? 'animate-[spin_20s_linear_infinite]' : ''"
          :style="vinylStyle"
        >
          <!-- 内圈白色粗环 + 中心专辑图 316px -->
          <div class="absolute inset-0 flex items-center justify-center">
            <div class="flex size-[340px] items-center justify-center rounded-full bg-ncmd-vinyl-ring">
              <div class="size-[316px] overflow-hidden rounded-full bg-gradient-to-br from-[#3a3a3a] to-[#141414]">
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
        <div class="pointer-events-none absolute left-1/2 top-[89px] -translate-x-1/2">
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
        </div>

        <!-- 副标题：18px，距歌名 15px -->
        <p class="mt-[15px] truncate text-[18px] leading-[26px] text-ncmd-muted">{{ singer || '—' }}</p>

        <!-- 元信息：距副标题 11px -->
        <p class="mt-[11px] truncate text-[18px] leading-[26px] text-ncmd-muted">
          专辑：{{ album || '未知' }}&nbsp;&nbsp;歌手：{{ singer || '未知' }}&nbsp;&nbsp;来源：{{ current?.source?.toUpperCase() ?? '—' }}
        </p>

        <!-- 页签切换器（shadcn-vue Tabs）：222x42，圆角 21px，位于 (1005,265) -->
        <Tabs v-model="activeTab" class="mt-[57px] flex min-h-0 flex-1 flex-col">
          <TabsList>
            <TabsTrigger v-for="t in tabs" :key="t.key" :value="t.key">
              {{ t.label }}
            </TabsTrigger>
          </TabsList>

          <!-- 歌词区：与页签间留约 260px 空白，起始 y=573 -->
          <TabsContent value="lyric" class="mt-[96px] flex min-h-0 max-w-[620px] flex-1 flex-col pb-6">
            <div ref="lyricBox" class="min-h-0 flex-1 overflow-y-auto pr-3">
              <p v-if="!lyrics.length" class="text-[20px] leading-[32px] text-ncmd-dim">暂无歌词</p>
              <div
                v-for="(line, i) in lyrics"
                :key="i"
                :data-active="i === currentLine"
                class="transition-[margin]"
                :class="[
                  isPlainLyric ? 'cursor-default' : 'cursor-pointer',
                  i === currentLine ? 'mb-[27px]' : 'mb-[23px]',
                ]"
                @click="seekTo(line.time)"
              >
                <p
                  class="text-[24px] leading-[32px] transition-colors"
                  :class="i === currentLine ? 'text-ncmd-fg' : (isPlainLyric ? 'text-ncmd-muted' : 'text-ncmd-dim')"
                >
                  {{ line.text || '·' }}
                </p>
                <p
                  v-if="line.translation"
                  class="mt-[3px] text-[24px] leading-[32px] transition-colors"
                  :class="i === currentLine ? 'text-ncmd-muted' : 'text-ncmd-darker'"
                >
                  {{ line.translation }}
                </p>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="wiki" class="mt-[96px] text-[20px] leading-[32px] text-ncmd-dim">
            <p>专辑：{{ album || '未知' }}</p>
            <p class="mt-2">歌手：{{ singer || '未知' }}</p>
            <p class="mt-2">来源：{{ current?.source?.toUpperCase() ?? '—' }} · 音质 {{ qualityLabel }}</p>
          </TabsContent>
          <TabsContent value="similar" class="mt-[96px] text-[20px] leading-[32px] text-ncmd-dim">
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
        <button type="button" class="text-ncmd-muted hover:text-ncmd-fg" aria-label="循环模式">
          <svg viewBox="0 0 24 24" class="size-[22px] stroke-current" fill="none" stroke-width="1.8">
            <path d="M17 2l4 4-4 4M7 22l-4-4 4-4M21 6H7a4 4 0 0 0-4 4M3 18h14a4 4 0 0 0 4-4" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
        <button type="button" class="text-ncmd-fg/80 hover:text-ncmd-fg disabled:opacity-40" aria-label="上一首" :disabled="!state.queue.length" @click="player.prev()">
          <svg viewBox="0 0 24 24" class="size-[26px] fill-current"><path d="M6 5h2v14H6zM20 5v14L9 12z" /></svg>
        </button>
        <!-- 播放按钮（shadcn-vue Button）52x52 圆形 -->
        <Button
          variant="secondary"
          class="size-[52px] rounded-full bg-ncmd-surface p-0 text-white hover:bg-ncmd-elevated"
          :aria-label="state.playing ? '暂停' : '播放'"
          :disabled="state.loading || !current"
          @click="player.toggle()"
        >
          <svg v-if="state.playing" viewBox="0 0 24 24" class="size-6 fill-current"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>
          <svg v-else viewBox="0 0 24 24" class="size-6 fill-current"><path d="M8 5v14l11-7z" /></svg>
        </Button>
        <button type="button" class="text-ncmd-fg/80 hover:text-ncmd-fg disabled:opacity-40" aria-label="下一首" :disabled="!state.queue.length" @click="player.next()">
          <svg viewBox="0 0 24 24" class="size-[26px] fill-current"><path d="M16 5h2v14h-2zM4 5v14l11-7z" /></svg>
        </button>
        <button type="button" class="text-ncmd-muted hover:text-ncmd-fg" aria-label="播放列表">
          <svg viewBox="0 0 24 24" class="size-[22px] stroke-current" fill="none" stroke-width="1.8">
            <path d="M4 6h11M4 12h11M4 18h7M19 10v8M19 18a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z" stroke-linecap="round" />
          </svg>
        </button>
      </div>

      <!-- 右：音质 / 词 / 音量 / 更多，从 x≈1642 起 -->
      <div class="absolute right-[49px] top-1/2 flex -translate-y-1/2 items-center gap-[29px] text-ncmd-muted">
        <button type="button" class="text-[14px] hover:text-ncmd-fg" :title="'当前音质：' + qualityLabel" @click="cycleQuality">{{ qualityLabel }}</button>
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
