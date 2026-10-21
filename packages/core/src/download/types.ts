/**
 * 下载任务的数据模型与平台边界
 *
 * 内核只负责「谁先下、谁在等、失败了要不要重试」这些**状态**，
 * 真正的字节写入交给宿主通过 `DownloadTransport` 注入 ——
 * 桌面端是 Electron 主进程的 fs 流，移动端将来可以接 RN 的下载模块。
 *
 * 这样拆的好处：队列、并发、重试、断点续传的规则两端完全一致，
 * 而且能纯逻辑测试，不需要真的下文件。
 */
import type { MusicItem, Quality } from '../types'

export type DownloadStatus = 'waiting' | 'running' | 'paused' | 'completed' | 'error'

export interface DownloadTask {
  /** `source:songmid:quality`，天然去重 */
  id: string
  item: MusicItem
  /** 期望音质（源可能降级，实际以 resolvedQuality 为准） */
  quality: Quality
  /** 源实际给的音质。降级后文件名扩展名要跟着改，否则写出 .flac 实为 mp3 */
  resolvedQuality?: Quality
  ext: string
  fileName: string
  status: DownloadStatus
  downloaded: number
  total: number
  /** 0–100 */
  progress: number
  /** 形如 `1.2 MB/s`，由传输层格式化 */
  speed: string
  error?: string
  /** 来源歌单，用于「按列表名分目录」 */
  listId?: string
  listName?: string
  createdAt: number
  completedAt?: number
}

/** 传给传输层的一次下载请求 */
export interface DownloadRequest {
  id: string
  url: string
  /** 目标目录（绝对路径，由宿主决定） */
  dir: string
  fileName: string
  /** 已下载字节数：> 0 时要求断点续传 */
  offset: number
}

/** 传输层上报的事件 */
export type DownloadEvent =
  | { type: 'start' }
  | { type: 'progress'; downloaded: number; total: number; speed: string }
  | { type: 'complete'; total: number }
  /** fatal=true 表示重试也没用（例如没有写权限、磁盘满） */
  | { type: 'error'; message: string; code?: string; status?: number; fatal?: boolean }

/**
 * 平台下载能力。
 *
 * `start` 必须在下载**结束**（完成 / 失败 / 被取消）时才 resolve ——
 * 管理器靠它释放并发位。提前 resolve 会让并发数失控。
 */
export interface DownloadTransport {
  start(request: DownloadRequest, emit: (event: DownloadEvent) => void): Promise<void>
  pause(id: string): Promise<void>
  remove(id: string): Promise<void>
  /** 目录是否存在、可写；不存在时由宿主创建 */
  ensureDir(dir: string): Promise<boolean>
}

/** 取流结果。源可能把 flac 降成 mp3，所以要把实际音质带回来 */
export interface ResolvedStream {
  url: string
  quality: Quality
  /** 容器类型（flac/mp3/m4a…），缺省时按 quality 推断 */
  type?: string
}

export interface DownloadManagerOptions {
  transport: DownloadTransport
  /** 取流。返回 null 表示这首歌当前拿不到地址 */
  resolveStream: (task: DownloadTask) => Promise<ResolvedStream | null>
  /** 下载目录（宿主决定，通常是用户设置项） */
  directory: () => string
  /** 命名模板（见 naming.ts 的 NAME_FORMATS 或自定义） */
  nameFormat: () => string
  /** 并发数，默认 2 */
  concurrency?: () => number
  /**
   * 按歌单名分目录。默认关。
   *
   * lx 有这个开关：从「某个歌单」批量下载时，文件落到 `<下载目录>/<歌单名>/`，
   * 而不是把几十首歌平铺在下载目录里。任务本身记着 listName，
   * 即使歌单后来改名也不影响已入队的任务。
   */
  subdirPerList?: () => boolean
  /** 本地持久化键，默认 lxmn.downloads */
  storageKey?: string
}
