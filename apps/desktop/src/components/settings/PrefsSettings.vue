<script setup lang="ts">
/**
 * 设置页的「播放 / 列表 / 系统」分区。
 *
 * 从 Settings.vue 里拆出来的原因：那边是外观与音源，改一次要滚很久；
 * 而且这几项都写在本机偏好里（prefs.ts），和云同步的字段不是一回事，
 * 放在一起容易让人以为改了会同步到另一台设备。
 */
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import {
  Download, ListOrdered, Monitor, Music2, RotateCcw, Trash2, Volume2, FolderInput,
} from 'lucide-vue-next'
import {
  prefs, resetPrefs, FONT_SCALES, WINDOW_PRESETS, type ProgressStyle,
} from '@/lib/prefs'
import { clearResumePositions, shuffleQueue, usePlayer } from '@/lib/player'
import { library, useSync } from '@/lib/sync'
import { toast } from '@/lib/toast'

const player = usePlayer()
const { favorites, history, playlists, trial } = useSync()

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
  </div>
</template>
