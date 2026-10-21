/**
 * 下载（桌面端）
 *
 * 内核的 `DownloadManager` 负责调度，这里只做三件事：
 *   1. 把 transport 接到 Electron 主进程（IPC）
 *   2. 把任务列表接到 Vue 的响应式系统
 *   3. 读设置（目录 / 命名 / 并发）并持久化
 *
 * 与 `download.ts`（单曲「另存为」）的区别：那个是「弹框选位置存一份」，
 * 这个是有队列、能暂停、能续传、有进度条的正式下载。
 */
import { ref, computed } from 'vue'
import {
  DownloadManager,
  getPlatform,
  getSource,
  type DownloadEvent,
  type DownloadRequest,
  type DownloadTask,
  type DownloadTransport,
  type MusicItem,
  type Quality,
  type ResolvedStream,
} from '@lxmn/core'
import { ensureDesktopPlatform } from './platform'

ensureDesktopPlatform()

interface NativeDownload {
  start: (request: DownloadRequest) => Promise<boolean>
  pause: (id: string) => Promise<boolean>
  remove: (id: string) => Promise<boolean>
  ensureDir: (dir: string) => Promise<boolean>
  defaultDir: () => Promise<string>
  pickDir: () => Promise<string>
  openDir: (dir: string) => Promise<boolean>
  onEvent: (cb: (payload: { id: string } & DownloadEvent) => void) => () => void
}

function nativeDownload(): NativeDownload | null {
  const w = window as unknown as { lxmnNative?: { download?: NativeDownload } }
  return w.lxmnNative?.download ?? null
}

/** 任务 id → 内核的 emit / resolve。IPC 是单向推送，靠这张表接回对应的任务 */
const pendingEmit = new Map<string, (event: DownloadEvent) => void>()
const pendingResolve = new Map<string, () => void>()

const transport: DownloadTransport = {
  async ensureDir(dir) {
    const api = nativeDownload()
    if (!api) return false
    return Boolean(await api.ensureDir(dir))
  },

  start(request, emit) {
    const api = nativeDownload()
    if (!api) {
      emit({ type: 'error', message: '当前环境不支持下载', fatal: true })
      return Promise.resolve()
    }
    return new Promise<void>(resolve => {
      pendingEmit.set(request.id, emit)
      pendingResolve.set(request.id, resolve)
      api.start(request).catch(e => {
        emit({ type: 'error', message: e instanceof Error ? e.message : String(e) })
        pendingEmit.delete(request.id)
        pendingResolve.delete(request.id)
        resolve()
      })
    })
  },

  async pause(id) {
    pendingEmit.delete(id)
    pendingResolve.get(id)?.()
    pendingResolve.delete(id)
    await nativeDownload()?.pause(id)
  },

  async remove(id) {
    pendingEmit.delete(id)
    pendingResolve.get(id)?.()
    pendingResolve.delete(id)
    await nativeDownload()?.remove(id)
  },
}

/* ---------- 设置 ---------- */

const SETTINGS_KEY = 'lxmn.download.settings'

interface DownloadSettings {
  dir: string
  nameFormat: string
  concurrency: number
  /** 从歌单批量下载时，落到 `<目录>/<歌单名>/` 里 */
  subdirPerList: boolean
  /** 目标文件已存在时跳过，不覆盖 */
  skipExisting: boolean
}

const settings = ref<DownloadSettings>({ dir: '', nameFormat: 'title-artist', concurrency: 2, subdirPerList: false, skipExisting: false })

async function loadSettings(): Promise<void> {
  try {
    const raw = await getPlatform().storage.get(SETTINGS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DownloadSettings>
      settings.value = {
        dir: typeof parsed.dir === 'string' ? parsed.dir : '',
        nameFormat: typeof parsed.nameFormat === 'string' ? parsed.nameFormat : 'title-artist',
        concurrency: Math.min(6, Math.max(1, Number(parsed.concurrency) || 2)),
        subdirPerList: parsed.subdirPerList === true,
        skipExisting: parsed.skipExisting === true,
      }
    }
  } catch {
    // 设置读不出来就用默认值，不该阻断下载页
  }
  if (!settings.value.dir) {
    const api = nativeDownload()
    if (api) settings.value.dir = await api.defaultDir().catch(() => '')
  }
}

async function saveSettings(patch: Partial<DownloadSettings>): Promise<void> {
  settings.value = { ...settings.value, ...patch }
  try {
    await getPlatform().storage.set(SETTINGS_KEY, JSON.stringify(settings.value))
  } catch {
    // 存不下不影响本次会话
  }
}

/* ---------- 管理器 ---------- */

const manager = new DownloadManager({
  transport,
  directory: () => settings.value.dir,
  nameFormat: () => settings.value.nameFormat,
  concurrency: () => settings.value.concurrency,
  subdirPerList: () => settings.value.subdirPerList,
  skipExisting: () => settings.value.skipExisting,
  /**
   * 取流。源可能降级（flac 无权限给 mp3），把实际音质带回去，
   * 内核据此改文件扩展名 —— 否则会写出后缀是 .flac 的 mp3。
   */
  resolveStream: async (task): Promise<ResolvedStream | null> => {
    const source = getSource(task.item.source)
    if (!source?.getMusicUrl) return null
    try {
      const info = await source.getMusicUrl(task.item, task.quality)
      if (!info?.url) return null
      return { url: info.url, quality: info.quality, type: info.type }
    } catch {
      return null
    }
  },
})

const tasks = ref<DownloadTask[]>([])
manager.subscribe(list => { tasks.value = list })

let wired = false
function ensureWired(): void {
  if (wired) return
  wired = true
  const api = nativeDownload()
  api?.onEvent(payload => {
    const { id, ...event } = payload
    const emit = pendingEmit.get(id)
    if (!emit) return
    emit(event as DownloadEvent)
    if (event.type === 'complete' || event.type === 'error') {
      pendingEmit.delete(id)
      pendingResolve.get(id)?.()
      pendingResolve.delete(id)
    }
  })
  void loadSettings()
  void manager.load().then(list => { tasks.value = list })
}

/* ---------- 对外 ---------- */

export function useDownloads() {
  ensureWired()

  const activeCount = computed(() => tasks.value.filter(t => t.status === 'running').length)
  const waitingCount = computed(() => tasks.value.filter(t => t.status === 'waiting').length)
  const completedCount = computed(() => tasks.value.filter(t => t.status === 'completed').length)
  const hasActive = computed(() => activeCount.value > 0 || waitingCount.value > 0)

  /** 下载若干首。listName 用于「按列表名分目录」 */
  async function download(
    items: readonly MusicItem[],
    quality: Quality,
    list?: { id?: string; name?: string },
  ): Promise<number> {
    const added = await manager.add(items, quality, { listId: list?.id, listName: list?.name })
    return added.length
  }

  return {
    tasks,
    settings,
    activeCount, waitingCount, completedCount, hasActive,
    download,
    pause: (id: string) => manager.pause(id),
    resume: (id: string) => manager.resume(id),
    remove: (id: string) => manager.remove(id),
    pauseAll: () => manager.pauseAll(),
    resumeAll: () => manager.resumeAll(),
    clearCompleted: () => manager.clearCompleted(),
    saveSettings,
    pickDir: async () => {
      const dir = await nativeDownload()?.pickDir()
      if (dir) await saveSettings({ dir })
      return dir ?? ''
    },
    openDir: () => nativeDownload()?.openDir(settings.value.dir),
  }
}

/** 给「我的音乐」等页面用：不订阅响应式，直接往队列里塞 */
export async function enqueueDownload(
  items: readonly MusicItem[],
  quality: Quality,
  list?: { id?: string; name?: string },
): Promise<number> {
  ensureWired()
  const added = await manager.add(items, quality, { listId: list?.id, listName: list?.name })
  return added.length
}
