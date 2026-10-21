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
/**
 * 下载完成后要写进文件（或写在旁边）的元数据（PARITY 5.6 / 5.7）。
 *
 * 为什么由**内核**定义、宿主填：这些字段来自曲目本身（歌名/歌手/专辑/歌词/封面），
 * 内核手里全都有；宿主只负责决定「写不写、用什么编码」以及真的去写盘。
 */
export interface DownloadTags {
  title?: string
  artist?: string
  album?: string
  /** 原文歌词（LRC 文本） */
  lyric?: string
  /** 翻译歌词：写进文件时拼在原文行后面 */
  tlyric?: string
  /** 封面地址（http/https）。宿主负责抓取，抓不到就不写封面 */
  coverUrl?: string
  /** 把歌词/封面写进音频文件本身 */
  embed?: boolean
  /** 额外在音频旁边存一份同名 .lrc */
  sidecar?: boolean
  /** sidecar 的编码（5.7）：车机/老播放器要 GBK */
  lyricEncoding?: 'utf8' | 'gbk'
}

export interface DownloadRequest {
  id: string
  url: string
  /** 目标目录（绝对路径，由宿主决定） */
  dir: string
  fileName: string
  /** 已下载字节数：> 0 时要求断点续传 */
  offset: number
  /**
   * 目标文件已存在时直接跳过（不覆盖）。
   *
   * 与 lx 的「同名文件跳过」一致：用户第二次下同一首时，不该把已经整理好
   * 标签/重命名过的文件覆盖掉。传输层负责判断「存在」，内核不认识文件系统。
   */
  skipIfExists?: boolean
  /**
   * 落盘后要写入的元数据。
   *
   * 由传输层在 rename 之后执行 —— 顺序很重要：先有完整文件，再改它的标签。
   * 反过来（边下边拼标签）会在续传时把标签写进音频中间，文件直接坏掉。
   */
  tags?: DownloadTags
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
  /** 同名文件跳过（默认关，关=覆盖） */
  skipExisting?: () => boolean
  /**
   * 落盘后要写的元数据（5.6 / 5.7）。返回 undefined 表示不写。
   *
   * 做成异步回调而不是普通字段：歌词要现取（音源接口），封面地址也可能
   * 需要再查一次。放在这里而不是传输层做，是因为只有内核知道怎么取歌词。
   */
  prepareTags?: (task: DownloadTask) => Promise<DownloadTags | undefined>
  /** 本地持久化键，默认 lxmn.downloads */
  storageKey?: string
}
