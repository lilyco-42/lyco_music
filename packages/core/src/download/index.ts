/**
 * 下载队列管理器
 *
 * 参照 lx-music-desktop 的 `store/download` + `worker/download`（v2.12.6），
 * 但把「字节怎么落盘」抽成 `DownloadTransport`，内核只保留调度逻辑。
 *
 * 队列规则（与 lx 一致，这些是用户能感知的）：
 *   - 同时最多 N 个任务（默认 2）。lx 默认也是小并发，因为源会按 IP 限流
 *   - 失败自动重试 2 次，退避 1s / 2s；第 3 次才标红
 *   - 链接失效（401/403/410）不算失败，先重新取一次流再试
 *   - 没有写权限 / 磁盘满这类错误**不重试**，重试只是浪费用户的时间
 *
 * 状态机：waiting → running → completed
 *                 ↘ paused ↗        ↘ error（可重试 → waiting）
 */
import { getPlatform } from '../registry'
import type { MusicItem, Quality } from '../types'
import { buildFileName, extForQuality, sanitizeFileName } from './naming'
import type {
  DownloadEvent,
  DownloadManagerOptions,
  DownloadStatus,
  DownloadTask,
} from './types'

export const DOWNLOAD_KEY = 'lxmn.downloads'
/** 默认并发。调大容易触发源站限流，lx 的设置项里也专门警告过这一点 */
const DEFAULT_CONCURRENCY = 2
/** 自动重试次数（不含首次） */
const MAX_RETRY = 2
/** 进度广播最小间隔：每 200ms 一次足够，再密只会让界面白刷 */
const EMIT_INTERVAL = 200
/** 超过这个大小的半截文件才值得保留（断点续传）。太小的直接重下 */
const RESUME_MIN_BYTES = 1024

function taskId(item: MusicItem, quality: Quality): string {
  return `${item.source}:${String(item.songmid ?? item.id)}:${quality}`
}

/** 只持久化「下次启动还需要」的字段，进度类的一律不存 */
interface StoredTask {
  id: string
  item: MusicItem
  quality: Quality
  resolvedQuality?: Quality
  ext: string
  fileName: string
  status: DownloadStatus
  downloaded: number
  total: number
  error?: string
  listId?: string
  listName?: string
  createdAt: number
  completedAt?: number
}

export class DownloadManager {
  private tasks: DownloadTask[] = []
  private loaded = false
  /** 正在跑的并发位 */
  private active = 0
  private retry = new Map<string, number>()
  /**
   * 正在退避冷却的任务。
   *
   * 没有这个集合的话，`fail()` 把状态改回 waiting 之后，`runTask` 的
   * finally 立刻调 `pump()` 会把它重新拉起来 —— 退避形同虚设，
   * 失败的任务会以 0 延迟连打三次，反而更容易被源站封 IP。
   */
  private cooldown = new Set<string>()
  private readonly listeners = new Set<(tasks: DownloadTask[]) => void>()
  private lastEmit = 0
  private emitTimer: number | null = null
  private disposed = false

  constructor(private readonly options: DownloadManagerOptions) {}

  // ------------------------------------------------------------ 订阅与快照

  subscribe(fn: (tasks: DownloadTask[]) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  snapshot(): DownloadTask[] {
    return this.tasks.map(t => ({ ...t, item: { ...t.item } }))
  }

  /** 立即广播（状态变化时用），进度则走节流版本 */
  private emit(): void {
    this.lastEmit = Date.now()
    const list = this.snapshot()
    for (const fn of this.listeners) fn(list)
  }

  private emitThrottled(): void {
    if (this.disposed) return
    const now = Date.now()
    const wait = EMIT_INTERVAL - (now - this.lastEmit)
    if (wait <= 0) {
      this.emit()
      return
    }
    if (this.emitTimer != null) return
    this.emitTimer = getPlatform().timer.setTimeout(() => {
      this.emitTimer = null
      this.emit()
    }, wait)
  }

  dispose(): void {
    this.disposed = true
    if (this.emitTimer != null) {
      getPlatform().timer.clearTimeout(this.emitTimer)
      this.emitTimer = null
    }
  }

  // ------------------------------------------------------------ 持久化

  async load(): Promise<DownloadTask[]> {
    if (this.loaded) return this.snapshot()
    this.loaded = true
    try {
      const raw = await getPlatform().storage.get(this.options.storageKey ?? DOWNLOAD_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as StoredTask[]
        if (Array.isArray(parsed)) {
          this.tasks = parsed.map(t => ({
            ...t,
            // 上次退出时正在跑的，进程没了，下载其实已经断了。
            // 标成 paused 让用户自己点继续，不要一启动就偷偷重下 ——
            // 用户可能是流量计费的网络。
            status: t.status === 'running' ? 'paused' : t.status,
            progress: t.total > 0 ? Math.min(100, (t.downloaded / t.total) * 100) : 0,
            speed: '',
            downloaded: Number(t.downloaded) || 0,
            total: Number(t.total) || 0,
          }))
        }
      }
    } catch {
      this.tasks = []
    }
    this.emit()
    return this.snapshot()
  }

  private async persist(): Promise<void> {
    if (!this.loaded) return
    const stored: StoredTask[] = this.tasks.map(t => ({
      id: t.id, item: t.item, quality: t.quality, resolvedQuality: t.resolvedQuality,
      ext: t.ext, fileName: t.fileName, status: t.status,
      downloaded: t.downloaded, total: t.total, error: t.error,
      listId: t.listId, listName: t.listName,
      createdAt: t.createdAt, completedAt: t.completedAt,
    }))
    try {
      await getPlatform().storage.set(this.options.storageKey ?? DOWNLOAD_KEY, JSON.stringify(stored))
    } catch {
      // 存储失败不影响正在进行的下载
    }
  }

  // ------------------------------------------------------------ 增删

  /**
   * 把歌曲加入队列。
   *
   * 同一首（同源同 id 同音质）已经在列表里就跳过 —— 用户重复点两次
   * 「下载」不该出现两条一模一样、还互相抢并发的任务。
   * 已完成的允许重新下载（可能之前下的是降级音质）。
   */
  async add(
    items: readonly MusicItem[],
    quality: Quality,
    meta: { listId?: string; listName?: string } = {},
  ): Promise<DownloadTask[]> {
    await this.load()
    const added: DownloadTask[] = []
    const format = this.options.nameFormat()

    for (const item of items) {
      const id = taskId(item, quality)
      const exist = this.tasks.find(t => t.id === id)
      if (exist) {
        // 失败/暂停的重新点一次，视为重试
        if (exist.status === 'error' || exist.status === 'paused') {
          exist.status = 'waiting'
          exist.error = undefined
          this.retry.delete(id)
          this.cooldown.delete(id)
          added.push(exist)
        }
        continue
      }
      const ext = extForQuality(quality)
      const task: DownloadTask = {
        id,
        item: { ...item },
        quality,
        ext,
        fileName: buildFileName(item, format, ext),
        status: 'waiting',
        downloaded: 0,
        total: 0,
        progress: 0,
        speed: '',
        listId: meta.listId,
        listName: meta.listName,
        createdAt: Date.now(),
      }
      this.tasks.unshift(task)
      added.push(task)
    }

    if (added.length) {
      await this.persist()
      this.emit()
      this.pump()
    }
    return added
  }

  /** 暂停。等待中的直接标暂停，正在跑的要让传输层真的停下来 */
  async pause(id: string): Promise<void> {
    const task = this.tasks.find(t => t.id === id)
    if (!task || task.status === 'completed') return
    if (task.status === 'running') {
      try {
        await this.options.transport.pause(id)
      } catch {
        // 停不下来也要改状态：否则界面会一直显示「下载中」
      }
    }
    task.status = 'paused'
    task.speed = ''
    await this.persist()
    this.emit()
    this.pump()
  }

  /** 继续（暂停 → 等待） */
  async resume(id: string): Promise<void> {
    const task = this.tasks.find(t => t.id === id)
    if (!task) return
    if (task.status !== 'paused' && task.status !== 'error') return
    task.status = 'waiting'
    task.error = undefined
    this.retry.delete(id)
    this.cooldown.delete(id)
    await this.persist()
    this.emit()
    this.pump()
  }

  /**
   * 删除任务。
   *
   * 已下载但没完成的半截文件交给传输层清掉 —— 留着只会在下次
   * 重新下载时被断点续传接上，而用户删任务的意思就是「不要了」。
   */
  async remove(id: string): Promise<void> {
    const at = this.tasks.findIndex(t => t.id === id)
    if (at < 0) return
    const task = this.tasks[at]!
    if (task.status === 'running') {
      try {
        await this.options.transport.remove(id)
      } catch { /* 尽力而为 */ }
    } else if (task.status !== 'completed' && task.downloaded > RESUME_MIN_BYTES) {
      try {
        await this.options.transport.remove(id)
      } catch { /* 尽力而为 */ }
    }
    this.tasks.splice(at, 1)
    this.retry.delete(id)
    this.cooldown.delete(id)
    await this.persist()
    this.emit()
    this.pump()
  }

  /** 清空已完成 */
  async clearCompleted(): Promise<void> {
    this.tasks = this.tasks.filter(t => t.status !== 'completed')
    await this.persist()
    this.emit()
  }

  /** 全部暂停 */
  async pauseAll(): Promise<void> {
    for (const t of [...this.tasks]) {
      if (t.status === 'running' || t.status === 'waiting') await this.pause(t.id)
    }
  }

  /** 全部继续 */
  async resumeAll(): Promise<void> {
    for (const t of this.tasks) {
      if (t.status === 'paused' || t.status === 'error') {
        t.status = 'waiting'
        t.error = undefined
        this.retry.delete(t.id)
        this.cooldown.delete(t.id)
      }
    }
    await this.persist()
    this.emit()
    this.pump()
  }

  // ------------------------------------------------------------ 调度

  /**
   * 按并发上限把等待中的任务推起来。
   *
   * runTask 在第一个 await 之前就把 status 改成 running 并占位，
   * 所以这个 while 循环不会把同一个任务挑两次（JS 单线程）。
   */
  private pump(): void {
    if (this.disposed) return
    const limit = Math.max(1, this.options.concurrency?.() ?? DEFAULT_CONCURRENCY)
    while (this.active < limit) {
      const next = this.tasks.find(t => t.status === 'waiting' && !this.cooldown.has(t.id))
      if (!next) return
      void this.runTask(next)
    }
  }

  private async runTask(task: DownloadTask): Promise<void> {
    task.status = 'running'
    task.error = undefined
    task.speed = ''
    this.active++
    this.emit()

    try {
      const dir = this.targetDir(task)
      const ok = await this.options.transport.ensureDir(dir)
      if (!ok) {
        this.fail(task, { type: 'error', message: '下载目录不可写，请到设置里换一个位置', fatal: true })
        return
      }

      const stream = await this.options.resolveStream(task)
      if (!stream?.url) {
        this.fail(task, { type: 'error', message: '这首歌当前没有可用地址' })
        return
      }

      // 源可能把 flac 降成 mp3：扩展名和文件名必须跟着改，
      // 否则写出一个后缀是 .flac、内容却是 mp3 的文件，播放器打不开
      if (stream.quality !== task.quality || stream.type) {
        const ext = extForQuality(stream.quality, stream.type)
        if (ext !== task.ext) {
          task.ext = ext
          task.resolvedQuality = stream.quality
          task.fileName = buildFileName(task.item, this.options.nameFormat(), ext)
        } else if (stream.quality !== task.quality) {
          task.resolvedQuality = stream.quality
        }
        this.emit()
      }

      // 半截文件太小时不值得续传，从头来更稳
      const offset = task.downloaded > RESUME_MIN_BYTES ? task.downloaded : 0
      if (!offset) {
        task.downloaded = 0
        task.progress = 0
      }

      await this.options.transport.start(
        {
          id: task.id,
          url: stream.url,
          dir,
          fileName: task.fileName,
          offset,
          skipIfExists: this.options.skipExisting?.() ?? false,
        },
        event => this.onEvent(task, event),
      )
    } catch (e) {
      this.fail(task, { type: 'error', message: e instanceof Error ? e.message : String(e) })
    } finally {
      this.active--
      // 任务可能已经被删掉了，此时不必再推
      this.pump()
    }
  }

  /**
   * 落盘目录。
   *
   * 分目录只在「从歌单批量下载」时有意义：单曲下载没有 listName，
   * 落到根目录才不会让用户在一堆歌单文件夹里找不到刚下的那首。
   */
  private targetDir(task: DownloadTask): string {
    const base = this.options.directory()
    if (!this.options.subdirPerList?.()) return base
    const name = sanitizeFileName(task.listName ?? '')
    if (!name || name === '.' || name === '..') return base
    // 用 / 拼接：Windows 的 fs 与 Linux/macOS 都认，path.join 在内核里没有平台对象
    return base.replace(/[\\/]+$/, '') + '/' + name
  }

  private onEvent(task: DownloadTask, event: DownloadEvent): void {
    switch (event.type) {
      case 'start':
        task.status = 'running'
        this.emit()
        break

      case 'progress':
        task.downloaded = event.downloaded
        task.total = event.total
        task.speed = event.speed
        task.progress = event.total > 0
          ? Math.min(100, (event.downloaded / event.total) * 100)
          : 0
        this.emitThrottled()
        break

      case 'complete':
        task.status = 'completed'
        task.total = event.total || task.total
        task.downloaded = task.total
        task.progress = 100
        task.speed = ''
        task.error = undefined
        task.completedAt = Date.now()
        this.retry.delete(task.id)
        void this.persist()
        this.emit()
        break

      case 'error':
        this.fail(task, event)
        break
    }
  }

  /**
   * 失败处理。
   *
   * 链接失效（401/403/410）和网络抖动都值得重试，但**没有写权限、
   * 磁盘满**这类错误重试三次只是让用户多等 3 秒再看到同一句话。
   */
  private fail(task: DownloadTask, event: Extract<DownloadEvent, { type: 'error' }>): void {
    const linkExpired = event.status === 401 || event.status === 403 || event.status === 410
    const n = (this.retry.get(task.id) ?? 0) + 1

    if (!event.fatal && n <= MAX_RETRY) {
      this.retry.set(task.id, n)
      task.status = 'waiting'
      task.error = event.message
      task.speed = ''
      this.cooldown.add(task.id)
      this.emit()
      // 退避：1s、2s。链接失效（401/403/410）先刷新地址，不必等 ——
      // 下次 runTask 会重新 resolveStream，拿到的是新签名
      const delay = linkExpired ? 0 : 1000 * n
      getPlatform().timer.setTimeout(() => {
        this.cooldown.delete(task.id)
        const cur = this.tasks.find(t => t.id === task.id)
        if (cur?.status === 'waiting') this.pump()
      }, delay)
      return
    }

    task.status = 'error'
    task.error = event.message
    task.speed = ''
    this.retry.delete(task.id)
    void this.persist()
    this.emit()
  }
}
