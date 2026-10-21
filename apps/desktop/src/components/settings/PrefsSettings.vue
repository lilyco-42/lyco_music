<script setup lang="ts">
/**
 * 设置页的「播放 / 列表 / 系统」分区。
 *
 * 从 Settings.vue 里拆出来的原因：那边是外观与音源，改一次要滚很久；
 * 而且这几项都写在本机偏好里（prefs.ts），和云同步的字段不是一回事，
 * 放在一起容易让人以为改了会同步到另一台设备。
 */
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import {
  Download, ListOrdered, Monitor, Music2, RotateCcw, Trash2, Volume2, FolderInput, Type, Globe, Link2, Copy, RefreshCw, ExternalLink, Info, Archive,
} from 'lucide-vue-next'
import {
  prefs, resetPrefs, FONT_SCALES, WINDOW_PRESETS, type ProgressStyle,
} from '@/lib/prefs'
import { clearResumePositions, shuffleQueue, usePlayer } from '@/lib/player'
import { library, useSync } from '@/lib/sync'
import { toast } from '@/lib/toast'
import { useUpdater } from '@/lib/update'
import { exportBackup, importBackup } from '@/lib/backup'
import { outputChannelInfo } from '@/lib/audio-graph'
import HotkeySettings from './HotkeySettings.vue'

const player = usePlayer()
const { favorites, history, playlists, trial } = useSync()
const updater = useUpdater()

/* ---------------- 最大声道数（2.6） ---------------- */

/**
 * 只有建过 Web Audio 图才知道声卡能吃几声道，所以这里是「事后读数」：
 * 开关一拨，AudioHost 会去建图，隔一拍再回来读。
 */
const channelHint = ref('')

function refreshChannelHint(): void {
  const info = outputChannelInfo()
  channelHint.value = info ? `本机最多 ${info.max} 声道，当前按 ${info.current} 声道输出。` : ''
}

onMounted(() => { setTimeout(refreshChannelHint, 120) })
watch(() => prefs.maxOutputChannels, () => { setTimeout(refreshChannelHint, 120) })

/* ---------------- 备份与恢复（4.10） ---------------- */

const backupBusy = ref(false)
const backupMsg = ref('')
const backupErr = ref('')

async function doExport(): Promise<void> {
  if (backupBusy.value) return
  backupBusy.value = true
  backupMsg.value = ''
  backupErr.value = ''
  try {
    const r = await exportBackup()
    if ('canceled' in r) return
    if ('error' in r) { backupErr.value = r.error; return }
    backupMsg.value = `已导出：收藏 ${r.counts.favorites} · 歌单 ${r.counts.playlists} · 历史 ${r.counts.history} · 试听 ${r.counts.trial}`
  } finally {
    backupBusy.value = false
  }
}

/**
 * 恢复。覆盖模式必须点两次：这个操作没有「撤销」，而备份又很容易点错文件。
 */
async function doImport(mode: 'merge' | 'replace'): Promise<void> {
  if (backupBusy.value) return
  if (mode === 'replace' && arm('restore')) return
  backupBusy.value = true
  backupMsg.value = ''
  backupErr.value = ''
  try {
    const r = await importBackup(mode)
    if (!r.ok) {
      if (!('canceled' in r && r.canceled)) backupErr.value = r.error || '导入失败'
      return
    }
    backupMsg.value = (mode === 'merge' ? '已合并：' : '已恢复：') +
      `收藏 ${r.counts.favorites} · 歌单 ${r.counts.playlists} · 历史 ${r.counts.history} · 试听 ${r.counts.trial}`
  } finally {
    backupBusy.value = false
  }
}

/* ---------------- 系统集成（6.5 / 6.6 / 6.8） ---------------- */

/** 开放 API 的示例端点：设一次就不用去翻文档 */
const API_EXAMPLE = 'http://127.0.0.1:23330/status'
const SCHEME_EXAMPLE = 'lxmusic://music/search?keyword=晴天'

function copy(text: string): void {
  void navigator.clipboard.writeText(text).then(
    () => toast('已复制'),
    () => toast('复制失败，请手动选中'),
  )
}

/* ---------------- 输出设备（2.5） ---------------- */

interface OutputDevice { id: string; label: string }

const outputs = ref<OutputDevice[]>([])
const outputError = ref('')

async function refreshOutputs(): Promise<void> {
  try {
    const list = await navigator.mediaDevices.enumerateDevices()
    outputs.value = list
      .filter(d => d.kind === 'audiooutput')
      .map(d => ({ id: d.deviceId, label: d.label || '未命名设备' }))
    outputError.value = ''
  } catch (e) {
    // 浏览器里没给权限时 enumerateDevices 会抛 SecurityError
    outputs.value = []
    outputError.value = e instanceof Error ? e.message : String(e)
  }
}

function onDeviceChange(): void { void refreshOutputs() }

onMounted(() => {
  void refreshOutputs()
  navigator.mediaDevices?.addEventListener?.('devicechange', onDeviceChange)
})
onBeforeUnmount(() => {
  navigator.mediaDevices?.removeEventListener?.('devicechange', onDeviceChange)
})

/* ---------------- 添加歌曲位置（4.12，走云同步） ---------------- */

const addLocation = ref<'top' | 'bottom'>('top')

onMounted(async () => {
  await library.load()
  addLocation.value = library.snapshot().settings.addMusicLocationType === 'bottom' ? 'bottom' : 'top'
})

async function setAddLocation(v: 'top' | 'bottom'): Promise<void> {
  addLocation.value = v
  await library.updateSettings({ addMusicLocationType: v })
  toast(v === 'top' ? '新加入的歌曲会放在列表顶部' : '新加入的歌曲会放在列表底部')
}

/* ---------------- 列表清理（4.9） ---------------- */

/**
 * 二次确认用「同一个按钮再点一次」，不弹 window.confirm。
 *
 * confirm 在 Electron 里会阻塞渲染进程，而且样式是系统框 —— 在一个
 * 自绘界面的应用里非常突兀。这里点第一次变成红字「再点一次确认」，
 * 3 秒内没点就复位。
 */
const pending = ref('')
let pendingTimer: ReturnType<typeof setTimeout> | null = null

function arm(action: string): boolean {
  if (pending.value === action) {
    pending.value = ''
    if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null }
    return true
  }
  pending.value = action
  if (pendingTimer) clearTimeout(pendingTimer)
  pendingTimer = setTimeout(() => { pending.value = ''; pendingTimer = null }, 3000)
  return false
}

const stats = computed(() => ({
  favorites: favorites.value.length,
  history: history.value.length,
  trial: trial.value.length,
  playlists: playlists.value.length,
}))

async function clearFavorites(): Promise<void> {
  if (!arm('fav')) return
  const n = await library.clearFavorites()
  toast(n ? `已清空 ${n} 首收藏` : '收藏本来就是空的')
}

async function clearHistory(): Promise<void> {
  if (!arm('his')) return
  await library.clearHistory()
  toast('已清空播放记录')
}

async function clearTrial(): Promise<void> {
  if (!arm('trial')) return
  await library.clearTrial()
  toast('已清空试听列表')
}

async function clearPlaylists(): Promise<void> {
  if (!arm('pl')) return
  const ids = playlists.value.map(p => p.id)
  for (const id of ids) await library.deletePlaylist(id)
  toast(ids.length ? `已删除 ${ids.length} 个自建歌单` : '没有自建歌单')
}

async function clearProgress(): Promise<void> {
  if (!arm('pos')) return
  clearResumePositions()
  toast('已清空播放进度记录')
}

/* ---------------- 乱序（4.6） ---------------- */

function shuffleNow(): void {
  const n = shuffleQueue()
  toast(n > 1 ? `已打乱播放队列（${n} 首）` : '队列太短，不需要打乱')
}

/* ---------------- 恢复默认 ---------------- */

function restoreDefaults(): void {
  if (!arm('reset')) return
  resetPrefs()
  toast('已恢复默认设置')
}

const SCROLL_DELAYS = [
  { value: 0, label: '不延迟' },
  { value: 300, label: '0.3s' },
  { value: 600, label: '0.6s' },
  { value: 1000, label: '1s' },
  { value: 1500, label: '1.5s' },
] as const

/** 偏移按 0.5s 步进，和播放页那两个 ± 按钮保持一致 */
function bumpOffset(delta: number): void {
  const next = Math.round((prefs.lyricOffset + delta) * 2) / 2
  prefs.lyricOffset = Math.max(-5, Math.min(5, next))
}

const PROGRESS_STYLES: { id: ProgressStyle; label: string; desc: string }[] = [
  { id: 'line', label: '细线', desc: '默认，2px' },
  { id: 'thick', label: '粗条', desc: '5px，指哪打哪' },
  { id: 'dot', label: '圆点', desc: '拖动时才显示圆点' },
]
</script>

<template>
  <div>
    <!-- ============ 播放 ============ -->
    <div class="mt-5 rounded-2xl border border-ncm-divider bg-white p-7">
      <div class="flex items-center gap-2">
        <Music2 :size="19" class="text-ncm-accent" />
        <h2 class="text-lg font-semibold text-ncm-fg">播放</h2>
      </div>

      <div class="mt-4 divide-y divide-ncm-divider">
        <label class="flex cursor-pointer items-start gap-3 py-3">
          <input v-model="prefs.rememberProgress" type="checkbox" class="mt-0.5 size-4 accent-[var(--color-ncm-accent)]" />
          <span class="min-w-0 flex-1">
            <span class="block text-[14px] text-ncm-fg">记住播放进度</span>
            <span class="mt-0.5 block text-[12px] leading-[18px] text-ncm-faint">下次点同一首歌从上次的位置接着播；快到结尾的歌会从头开始</span>
          </span>
        </label>

        <label class="flex cursor-pointer items-start gap-3 py-3">
          <input v-model="prefs.autoPlayOnStart" type="checkbox" class="mt-0.5 size-4 accent-[var(--color-ncm-accent)]" />
          <span class="min-w-0 flex-1">
            <span class="block text-[14px] text-ncm-fg">启动时自动播放</span>
            <span class="mt-0.5 block text-[12px] leading-[18px] text-ncm-faint">打开应用就接着放上次的队列。关着更安全 —— 不会一点开就出声</span>
          </span>
        </label>

        <label class="flex cursor-pointer items-start gap-3 py-3">
          <input v-model="prefs.preventSleep" type="checkbox" class="mt-0.5 size-4 accent-[var(--color-ncm-accent)]" />
          <span class="min-w-0 flex-1">
            <span class="block text-[14px] text-ncm-fg">播放时阻止系统休眠</span>
            <span class="mt-0.5 block text-[12px] leading-[18px] text-ncm-faint">只阻止系统挂起，屏幕该黑还是会黑</span>
          </span>
        </label>

        <label class="flex cursor-pointer items-start gap-3 py-3">
          <input v-model="prefs.taskbarProgress" type="checkbox" class="mt-0.5 size-4 accent-[var(--color-ncm-accent)]" />
          <span class="min-w-0 flex-1">
            <span class="block text-[14px] text-ncm-fg">任务栏显示播放进度</span>
            <span class="mt-0.5 block text-[12px] leading-[18px] text-ncm-faint">Windows 任务栏图标下方那条绿线</span>
          </span>
        </label>

        <!-- 输出设备 -->
        <div class="flex items-start gap-3 py-3">
          <Volume2 :size="16" class="mt-1 shrink-0 text-ncm-faint" />
          <div class="min-w-0 flex-1">
            <div class="text-[14px] text-ncm-fg">音频输出设备</div>
            <p class="mt-0.5 text-[12px] leading-[18px] text-ncm-faint">
              插拔耳机后列表会自动刷新；选中的设备被拔掉时自动回落到系统默认。
            </p>
            <div class="mt-2 flex items-center gap-2">
              <select
                v-model="prefs.outputDevice"
                class="min-w-0 flex-1 rounded-[8px] border border-ncm-divider bg-ncm-bg px-2.5 py-1.5 text-[13px] text-ncm-fg outline-none focus:border-ncm-accent"
              >
                <option value="">系统默认</option>
                <option v-for="d in outputs" :key="d.id" :value="d.id">{{ d.label }}</option>
              </select>
              <button
                type="button"
                class="shrink-0 rounded-full border border-ncm-divider px-3 py-1 text-[12px] text-ncm-muted hover:bg-ncm-bg"
                @click="refreshOutputs"
              >刷新</button>
            </div>
            <p v-if="outputError" class="mt-1 text-[12px] text-red-500">读取设备列表失败：{{ outputError }}</p>
          </div>
        </div>

        <!-- 最大声道数（2.6） -->
        <label class="flex cursor-pointer items-start gap-3 py-3">
          <input v-model="prefs.maxOutputChannels" type="checkbox" class="mt-0.5 size-4 accent-[var(--color-ncm-accent)]" />
          <span class="min-w-0 flex-1">
            <span class="block text-[14px] text-ncm-fg">使用设备能处理的最大声道数</span>
            <span class="mt-0.5 block text-[12px] leading-[18px] text-ncm-faint">
              让 Chromium 按声卡真实能力输出（5.1 / 7.1 声卡、HDMI 接功放才有区别）。
              普通耳机/音箱本来就是双声道，开了不会有变化，也不会有副作用。
              <span v-if="channelHint" class="text-ncm-muted">{{ channelHint }}</span>
            </span>
          </span>
        </label>
      </div>
    </div>

    <!-- ============ 歌词 ============ -->
    <div class="mt-5 rounded-2xl border border-ncm-divider bg-white p-7">
      <div class="flex items-center gap-2">
        <Type :size="19" class="text-ncm-accent" />
        <h2 class="text-lg font-semibold text-ncm-fg">歌词</h2>
      </div>

      <div class="mt-4 divide-y divide-ncm-divider">
        <label class="flex cursor-pointer items-start gap-3 py-3">
          <input v-model="prefs.lyricS2T" type="checkbox" class="mt-0.5 size-4 accent-[var(--color-ncm-accent)]" />
          <span class="min-w-0 flex-1">
            <span class="block text-[14px] text-ncm-fg">歌词转繁体</span>
            <span class="mt-0.5 block text-[12px] leading-[18px] text-ncm-faint">简体歌词按字形转成繁体（与 lx 的「简繁转换」同义）。逐字映射，不做分词，个别多音字可能不准</span>
          </span>
        </label>

        <label class="flex cursor-pointer items-start gap-3 py-3">
          <input v-model="prefs.lyricSeekByDrag" type="checkbox" class="mt-0.5 size-4 accent-[var(--color-ncm-accent)]" />
          <span class="min-w-0 flex-1">
            <span class="block text-[14px] text-ncm-fg">允许拖拽歌词调进度</span>
            <span class="mt-0.5 block text-[12px] leading-[18px] text-ncm-faint">按住歌词区上下拖动可以刮擦定位；点某一行也能直接跳过去</span>
          </span>
        </label>

        <!-- 偏移 -->
        <div class="flex items-start gap-3 py-3">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="text-[14px] text-ncm-fg">歌词偏移</span>
              <span class="text-[12px] tabular-nums" :class="prefs.lyricOffset === 0 ? 'text-ncm-faint' : 'text-ncm-accent'">
                {{ prefs.lyricOffset > 0 ? '+' : '' }}{{ prefs.lyricOffset.toFixed(1) }}s
              </span>
            </div>
            <p class="mt-0.5 text-[12px] leading-[18px] text-ncm-faint">
              人声到了歌词还没到就调正数，反过来调负数。播放页、播放栏、桌面歌词共用这一个值。
            </p>
            <div class="mt-2 flex items-center gap-2">
              <button type="button" class="rounded-full border border-ncm-divider px-3 py-1 text-[12px] text-ncm-muted hover:bg-ncm-bg" @click="bumpOffset(-0.5)">−0.5s</button>
              <button type="button" class="rounded-full border border-ncm-divider px-3 py-1 text-[12px] text-ncm-muted hover:bg-ncm-bg" @click="bumpOffset(0.5)">+0.5s</button>
              <button
                type="button"
                class="rounded-full border border-ncm-divider px-3 py-1 text-[12px] text-ncm-muted hover:bg-ncm-bg disabled:opacity-40"
                :disabled="prefs.lyricOffset === 0"
                @click="prefs.lyricOffset = 0"
              >归零</button>
            </div>
          </div>
        </div>

        <!-- 详情页字号 -->
        <div class="flex items-start gap-3 py-3">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="text-[14px] text-ncm-fg">播放页歌词字号</span>
              <span class="text-[12px] tabular-nums text-ncm-faint">{{ prefs.playLyricFontSize }}px</span>
            </div>
            <input
              type="range"
              min="14"
              max="34"
              step="2"
              :value="prefs.playLyricFontSize"
              class="mt-2 h-1 w-full max-w-[280px] accent-[var(--color-ncm-accent)]"
              aria-label="播放页歌词字号"
              @input="prefs.playLyricFontSize = Number(($event.target as HTMLInputElement).value)"
            />
            <p class="mt-1 text-[12px] text-ncm-faint">只影响播放详情页；桌面歌词的字号在歌词窗口里右键调。</p>
          </div>
        </div>

        <!-- 延迟滚动 -->
        <div class="flex items-start gap-3 py-3">
          <div class="min-w-0 flex-1">
            <div class="text-[14px] text-ncm-fg">滚动延迟</div>
            <p class="mt-0.5 text-[12px] leading-[18px] text-ncm-faint">
              新的一行出现后等一会儿再滚动，长句不会刚露头就被推到中间。
            </p>
            <div class="mt-2 flex flex-wrap gap-2">
              <button
                v-for="d in SCROLL_DELAYS"
                :key="d.value"
                type="button"
                class="rounded-full border px-3 py-1 text-[12px] transition-colors"
                :class="prefs.lyricScrollDelay === d.value ? 'border-ncm-accent bg-ncm-accent/5 text-ncm-accent' : 'border-ncm-divider text-ncm-muted hover:bg-ncm-bg'"
                @click="prefs.lyricScrollDelay = d.value"
              >{{ d.label }}</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ============ 列表 ============ -->
    <div class="mt-5 rounded-2xl border border-ncm-divider bg-white p-7">
      <div class="flex items-center gap-2">
        <ListOrdered :size="19" class="text-ncm-accent" />
        <h2 class="text-lg font-semibold text-ncm-fg">列表</h2>
      </div>

      <div class="mt-4">
        <div class="text-[14px] text-ncm-fg">新加入的歌曲放在</div>
        <div class="mt-2 flex gap-2">
          <button
            v-for="opt in [{ id: 'top' as const, label: '顶部', desc: '刚点的歌马上能看到' }, { id: 'bottom' as const, label: '底部', desc: '按加入顺序排下去' }]"
            :key="opt.id"
            type="button"
            class="rounded-xl border px-3.5 py-2 text-left transition-colors"
            :class="addLocation === opt.id ? 'border-ncm-accent bg-ncm-accent/5' : 'border-ncm-divider hover:bg-ncm-bg'"
            @click="setAddLocation(opt.id)"
          >
            <span class="block text-[13px] text-ncm-fg">{{ opt.label }}</span>
            <span class="mt-0.5 block text-[11px] text-ncm-faint">{{ opt.desc }}</span>
          </button>
        </div>
        <p class="mt-2 text-[12px] text-ncm-faint">这一项跟随云同步，另一台设备也会用同样的规则。</p>
      </div>

      <div class="mt-5 border-t border-ncm-divider pt-4">
        <div class="text-[14px] text-ncm-fg">随机乱序</div>
        <p class="mt-0.5 text-[12px] leading-[18px] text-ncm-faint">
          把当前播放队列真的打乱（不是「随机播放」模式）。想按原顺序听回来就重新点一次歌单。
        </p>
        <button
          type="button"
          class="mt-2 rounded-full border border-ncm-divider px-4 py-1.5 text-[13px] text-ncm-muted hover:bg-ncm-bg disabled:opacity-40"
          :disabled="player.state.queue.length < 2"
          @click="shuffleNow"
        >打乱当前队列（{{ player.state.queue.length }} 首）</button>
      </div>

      <!-- 数据清理 -->
      <div class="mt-5 border-t border-ncm-divider pt-4">
        <div class="flex items-center gap-2">
          <Trash2 :size="16" class="text-ncm-faint" />
          <span class="text-[14px] text-ncm-fg">清理数据</span>
          <span class="text-[12px] text-ncm-faint">收藏 {{ stats.favorites }} · 记录 {{ stats.history }} · 试听 {{ stats.trial }} · 歌单 {{ stats.playlists }}</span>
        </div>
        <div class="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            class="rounded-full border px-3.5 py-1.5 text-[12px] transition-colors"
            :class="pending === 'fav' ? 'border-red-400 bg-red-50 text-red-600' : 'border-ncm-divider text-ncm-muted hover:bg-ncm-bg'"
            @click="clearFavorites"
          >{{ pending === 'fav' ? '再点一次清空收藏' : '清空收藏' }}</button>
          <button
            type="button"
            class="rounded-full border px-3.5 py-1.5 text-[12px] transition-colors"
            :class="pending === 'his' ? 'border-red-400 bg-red-50 text-red-600' : 'border-ncm-divider text-ncm-muted hover:bg-ncm-bg'"
            @click="clearHistory"
          >{{ pending === 'his' ? '再点一次清空记录' : '清空播放记录' }}</button>
          <button
            type="button"
            class="rounded-full border px-3.5 py-1.5 text-[12px] transition-colors"
            :class="pending === 'trial' ? 'border-red-400 bg-red-50 text-red-600' : 'border-ncm-divider text-ncm-muted hover:bg-ncm-bg'"
            @click="clearTrial"
          >{{ pending === 'trial' ? '再点一次清空试听' : '清空试听列表' }}</button>
          <button
            type="button"
            class="rounded-full border px-3.5 py-1.5 text-[12px] transition-colors"
            :class="pending === 'pl' ? 'border-red-400 bg-red-50 text-red-600' : 'border-ncm-divider text-ncm-muted hover:bg-ncm-bg'"
            @click="clearPlaylists"
          >{{ pending === 'pl' ? '再点一次删除歌单' : '删除全部自建歌单' }}</button>
          <button
            type="button"
            class="rounded-full border px-3.5 py-1.5 text-[12px] transition-colors"
            :class="pending === 'pos' ? 'border-red-400 bg-red-50 text-red-600' : 'border-ncm-divider text-ncm-muted hover:bg-ncm-bg'"
            @click="clearProgress"
          >{{ pending === 'pos' ? '再点一次清空进度' : '清空播放进度' }}</button>
        </div>
        <p class="mt-2 text-[12px] text-ncm-faint">清理只动本机数据；已开启云同步的话，下次同步会把这些删除推上去。</p>
      </div>

      <!-- 备份与恢复（4.10） -->
      <div class="mt-5 border-t border-ncm-divider pt-4">
        <div class="flex items-center gap-2">
          <Archive :size="16" class="text-ncm-faint" />
          <span class="text-[14px] text-ncm-fg">备份与恢复</span>
        </div>
        <p class="mt-1 text-[12px] leading-[18px] text-ncm-faint">
          导出一个可读的 JSON（收藏 / 歌单 / 试听列表 / 历史 / 屏蔽规则 / 设置）。换设备或重装前先导一份最省事。
        </p>
        <div class="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="rounded-full bg-ncm-accent px-3.5 py-1.5 text-[12px] text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            :disabled="backupBusy"
            @click="doExport"
          >导出备份</button>
          <button
            type="button"
            class="rounded-full border border-ncm-divider px-3.5 py-1.5 text-[12px] text-ncm-muted transition-colors hover:bg-ncm-bg disabled:opacity-40"
            :disabled="backupBusy"
            @click="doImport('merge')"
          >恢复并合并</button>
          <button
            type="button"
            class="rounded-full border px-3.5 py-1.5 text-[12px] transition-colors"
            :class="pending === 'restore' ? 'border-red-400 bg-red-50 text-red-600' : 'border-ncm-divider text-ncm-muted hover:bg-ncm-bg'"
            :disabled="backupBusy"
            @click="doImport('replace')"
          >{{ pending === 'restore' ? '再点一次覆盖本机数据' : '恢复并覆盖' }}</button>
        </div>
        <p v-if="backupMsg" class="mt-2 text-[12px] text-emerald-600">{{ backupMsg }}</p>
        <p v-if="backupErr" class="mt-2 text-[12px] text-red-500">{{ backupErr }}</p>
      </div>
    </div>

    <!-- ============ 界面与窗口 ============ -->
    <div class="mt-5 rounded-2xl border border-ncm-divider bg-white p-7">
      <div class="flex items-center gap-2">
        <Monitor :size="19" class="text-ncm-accent" />
        <h2 class="text-lg font-semibold text-ncm-fg">界面与窗口</h2>
      </div>

      <div class="mt-4">
        <div class="flex items-center gap-2">
          <span class="text-[14px] text-ncm-fg">界面大小</span>
          <span class="text-[12px] text-ncm-faint">{{ Math.round(prefs.fontScale * 100) }}%</span>
        </div>
        <div class="mt-2 flex flex-wrap gap-2">
          <button
            v-for="f in FONT_SCALES"
            :key="f.id"
            type="button"
            class="rounded-full border px-3 py-1 text-[12px] transition-colors"
            :class="prefs.fontScale === f.id ? 'border-ncm-accent bg-ncm-accent/5 text-ncm-accent' : 'border-ncm-divider text-ncm-muted hover:bg-ncm-bg'"
            @click="prefs.fontScale = f.id"
          >{{ f.label }}</button>
        </div>
        <p class="mt-2 text-[12px] text-ncm-faint">
          整体等比缩放（文字和控件一起变），不是只放大字。1080p 带 125% 系统缩放时用「小」会更清爽。
        </p>
      </div>

      <div class="mt-5">
        <div class="text-[14px] text-ncm-fg">播放栏进度条</div>
        <div class="mt-2 flex gap-2">
          <button
            v-for="s in PROGRESS_STYLES"
            :key="s.id"
            type="button"
            class="rounded-xl border px-3.5 py-2 text-left transition-colors"
            :class="prefs.progressStyle === s.id ? 'border-ncm-accent bg-ncm-accent/5' : 'border-ncm-divider hover:bg-ncm-bg'"
            @click="prefs.progressStyle = s.id"
          >
            <span class="block text-[13px] text-ncm-fg">{{ s.label }}</span>
            <span class="mt-0.5 block text-[11px] text-ncm-faint">{{ s.desc }}</span>
          </button>
        </div>
      </div>

      <div class="mt-5">
        <div class="text-[14px] text-ncm-fg">窗口尺寸</div>
        <div class="mt-2 flex flex-wrap gap-2">
          <button
            v-for="p in WINDOW_PRESETS"
            :key="p.id"
            type="button"
            class="rounded-full border px-3 py-1 text-[12px] transition-colors"
            :class="prefs.windowPreset === p.id ? 'border-ncm-accent bg-ncm-accent/5 text-ncm-accent' : 'border-ncm-divider text-ncm-muted hover:bg-ncm-bg'"
            @click="prefs.windowPreset = p.id"
          >{{ p.label }}</button>
        </div>
        <p class="mt-2 text-[12px] text-ncm-faint">超出屏幕的预设会被自动夹到工作区内并居中。</p>
      </div>
    </div>

    <!-- ============ 快捷键（6.2） ============ -->
    <HotkeySettings />

    <!-- ============ 系统 ============ -->
    <div class="mt-5 rounded-2xl border border-ncm-divider bg-white p-7">
      <div class="flex items-center gap-2">
        <Download :size="19" class="text-ncm-accent" />
        <h2 class="text-lg font-semibold text-ncm-fg">系统</h2>
      </div>
      <div class="mt-4 divide-y divide-ncm-divider">
        <label class="flex cursor-pointer items-start gap-3 py-3">
          <input v-model="prefs.closeToTray" type="checkbox" class="mt-0.5 size-4 accent-[var(--color-ncm-accent)]" />
          <span class="min-w-0 flex-1">
            <span class="block text-[14px] text-ncm-fg">关闭窗口时最小化到托盘</span>
            <span class="mt-0.5 block text-[12px] leading-[18px] text-ncm-faint">开着时点 × 不会退出，要从托盘菜单里选「退出」。第一次会弹一次提示</span>
          </span>
        </label>
        <label class="flex cursor-pointer items-start gap-3 py-3">
          <input v-model="prefs.startHidden" type="checkbox" class="mt-0.5 size-4 accent-[var(--color-ncm-accent)]" />
          <span class="min-w-0 flex-1">
            <span class="block text-[14px] text-ncm-fg">启动时隐藏窗口</span>
            <span class="mt-0.5 block text-[12px] leading-[18px] text-ncm-faint">配合开机自启用：起来后只在托盘里，不抢焦点</span>
          </span>
        </label>
        <label class="flex cursor-pointer items-start gap-3 py-3">
          <input v-model="prefs.autoSwitchOnDownloadFail" type="checkbox" class="mt-0.5 size-4 accent-[var(--color-ncm-accent)]" />
          <span class="min-w-0 flex-1">
            <span class="block text-[14px] text-ncm-fg">下载失败自动换源</span>
            <span class="mt-0.5 block text-[12px] leading-[18px] text-ncm-faint">原音源下不下来时换其他源再试一次，避免整批任务红一片</span>
          </span>
        </label>
      </div>

      <!-- HTTP 代理（6.8） -->
      <div class="mt-4 rounded-xl border border-ncm-divider p-4">
        <label class="flex cursor-pointer items-start gap-3">
          <input v-model="prefs.proxy.enabled" type="checkbox" class="mt-0.5 size-4 accent-[var(--color-ncm-accent)]" />
          <span class="min-w-0 flex-1">
            <span class="flex items-center gap-1.5 text-[14px] text-ncm-fg"><Globe :size="14" />HTTP 代理</span>
            <span class="mt-0.5 block text-[12px] leading-[18px] text-ncm-faint">整机级别的 session 代理：接口、封面、音频流一起走，不会只通一部分</span>
          </span>
        </label>
        <div v-if="prefs.proxy.enabled" class="mt-3 grid grid-cols-2 gap-2">
          <input v-model="prefs.proxy.host" placeholder="主机 127.0.0.1" class="col-span-2 rounded-[6px] border border-ncm-divider px-2 py-1.5 text-[13px] outline-none focus:border-ncm-accent sm:col-span-1" />
          <input v-model="prefs.proxy.port" placeholder="端口 7890" class="rounded-[6px] border border-ncm-divider px-2 py-1.5 text-[13px] outline-none focus:border-ncm-accent" />
          <input v-model="prefs.proxy.username" placeholder="用户名（可选）" class="rounded-[6px] border border-ncm-divider px-2 py-1.5 text-[13px] outline-none focus:border-ncm-accent" />
          <input v-model="prefs.proxy.password" type="password" placeholder="密码（可选）" class="rounded-[6px] border border-ncm-divider px-2 py-1.5 text-[13px] outline-none focus:border-ncm-accent" />
        </div>
        <p class="mt-2 text-[12px] text-ncm-faint">改完立即生效；localhost 与内网地址自动绕过。</p>
      </div>

      <!-- 开放 API（6.5） -->
      <div class="mt-3 rounded-xl border border-ncm-divider p-4">
        <label class="flex cursor-pointer items-start gap-3">
          <input v-model="prefs.api.enabled" type="checkbox" class="mt-0.5 size-4 accent-[var(--color-ncm-accent)]" />
          <span class="min-w-0 flex-1">
            <span class="flex items-center gap-1.5 text-[14px] text-ncm-fg"><Monitor :size="14" />开放 API</span>
            <span class="mt-0.5 block text-[12px] leading-[18px] text-ncm-faint">只监听 127.0.0.1，给 OBS / 直播工具 / 自己的脚本用</span>
          </span>
        </label>
        <div v-if="prefs.api.enabled" class="mt-3 flex items-center gap-2">
          <span class="text-[12px] text-ncm-faint">端口</span>
          <input v-model.number="prefs.api.port" type="number" min="1024" max="65535" class="w-[92px] rounded-[6px] border border-ncm-divider px-2 py-1 text-[13px] outline-none focus:border-ncm-accent" />
          <button type="button" class="flex items-center gap-1 rounded-full border border-ncm-divider px-2.5 py-1 text-[12px] text-ncm-muted hover:bg-ncm-bg" @click="copy(API_EXAMPLE)">
            <Copy :size="12" />复制示例
          </button>
        </div>
        <p v-if="prefs.api.lastError" class="mt-2 text-[12px] text-red-500">启动失败：{{ prefs.api.lastError }}</p>
        <p v-else-if="prefs.api.enabled" class="mt-2 text-[12px] text-emerald-600">正在 127.0.0.1:{{ prefs.api.port }} 监听</p>
      </div>

      <!-- Scheme URL（6.6） -->
      <div class="mt-3 rounded-xl border border-ncm-divider p-4">
        <span class="flex items-center gap-1.5 text-[14px] text-ncm-fg"><Link2 :size="14" />Scheme URL</span>
        <p class="mt-1 text-[12px] leading-[18px] text-ncm-faint">
          外部程序可以用 <code class="rounded bg-ncm-bg px-1">lxmusic://</code> 唤起播放器：
          <code class="rounded bg-ncm-bg px-1">player/play</code>、
          <code class="rounded bg-ncm-bg px-1">player/skipNext</code>、
          <code class="rounded bg-ncm-bg px-1">music/search?keyword=…</code>、
          <code class="rounded bg-ncm-bg px-1">music/wy/&lt;songmid&gt;</code>。
        </p>
        <button type="button" class="mt-2 flex items-center gap-1 rounded-full border border-ncm-divider px-2.5 py-1 text-[12px] text-ncm-muted hover:bg-ncm-bg" @click="copy(SCHEME_EXAMPLE)">
          <Copy :size="12" />复制示例
        </button>
      </div>

      <div class="mt-4 flex items-center gap-2 border-t border-ncm-divider pt-4">
        <FolderInput :size="16" class="text-ncm-faint" />
        <span class="text-[12px] text-ncm-faint">启动参数：加 <code class="rounded bg-ncm-bg px-1">-hidden</code> 可强制隐藏窗口启动（等价于上面那个开关）</span>
      </div>

      <button
        type="button"
        class="mt-4 flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[12px] transition-colors"
        :class="pending === 'reset' ? 'border-red-400 bg-red-50 text-red-600' : 'border-ncm-divider text-ncm-muted hover:bg-ncm-bg'"
        @click="restoreDefaults"
      >
        <RotateCcw :size="13" />
        {{ pending === 'reset' ? '再点一次恢复默认' : '恢复默认设置' }}
      </button>
    </div>

    <!-- ============ 关于与更新（6.9 / 6.10） ============ -->
    <div class="mt-5 rounded-2xl border border-ncm-divider bg-white p-7">
      <div class="flex items-center gap-2">
        <Info :size="19" class="text-ncm-accent" />
        <h2 class="text-lg font-semibold text-ncm-fg">关于与更新</h2>
        <span class="ml-1 text-[12px] text-ncm-faint">v{{ updater.current }}</span>
      </div>

      <div class="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="flex items-center gap-1.5 rounded-full border border-ncm-divider px-3.5 py-1.5 text-[12px] text-ncm-muted transition-colors hover:bg-ncm-bg disabled:opacity-40"
          :disabled="updater.checking.value"
          @click="updater.check()"
        >
          <RefreshCw :size="13" :class="updater.checking.value ? 'animate-spin' : ''" />
          {{ updater.checking.value ? '检查中…' : '检查更新' }}
        </button>
        <button
          type="button"
          class="flex items-center gap-1.5 rounded-full border border-ncm-divider px-3.5 py-1.5 text-[12px] text-ncm-muted transition-colors hover:bg-ncm-bg"
          @click="updater.openDownload()"
        >
          <ExternalLink :size="13" />打开下载页
        </button>
        <label class="ml-2 flex cursor-pointer items-center gap-2 text-[12px] text-ncm-muted">
          <input v-model="prefs.autoCheckUpdate" type="checkbox" class="size-3.5 accent-[var(--color-ncm-accent)]" />
          启动时自动检查
        </label>
        <label class="flex cursor-pointer items-center gap-2 text-[12px] text-ncm-muted">
          <input v-model="prefs.showChangelogAfterUpdate" type="checkbox" class="size-3.5 accent-[var(--color-ncm-accent)]" />
          升级后弹更新日志
        </label>
      </div>

      <button
        v-if="updater.pendingChangelog.value === null"
        type="button"
        class="mt-2 text-[12px] text-ncm-accent hover:underline"
        @click="updater.maybeShowChangelog(true)"
      >再看一次本版更新日志</button>

      <p v-if="updater.error.value" class="mt-3 text-[12px] text-red-500">检查失败：{{ updater.error.value }}</p>
      <p v-else-if="updater.hasUpdate.value && updater.latest.value" class="mt-3 text-[12px] text-emerald-600">
        有新版本 v{{ updater.latest.value.version }}（当前 v{{ updater.current }}）
      </p>
      <p v-else-if="updater.lastCheckedAt.value" class="mt-3 text-[12px] text-ncm-faint">已经是最新版本。</p>

      <details v-if="updater.latest.value?.notes" class="mt-3 rounded-xl border border-ncm-divider">
        <summary class="cursor-pointer px-3 py-2 text-[12px] text-ncm-muted">更新日志（v{{ updater.latest.value.version }}）</summary>
        <pre class="max-h-[240px] overflow-auto whitespace-pre-wrap px-3 pb-3 text-[12px] leading-[18px] text-ncm-faint">{{ updater.latest.value.notes }}</pre>
      </details>

      <p class="mt-3 text-[12px] leading-[18px] text-ncm-faint">
        安装包未签名，所以不做静默自动更新：检查到新版本后由你决定什么时候装。
      </p>
    </div>
  </div>
</template>
