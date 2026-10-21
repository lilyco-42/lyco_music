/**
 * 云同步数据模型
 *
 * 「服务器同步」要解决的是：同一个会员在 Windows 上收藏的歌，
 * 换到手机上打开应该还在。默认服务器就是 lain42.top（见 client.ts 的
 * DEFAULT_BASE），用户也可以填自建地址。
 *
 * 这里只描述数据结构，不含业务实现 —— 桌面端 / 移动端 / 未来的 Web 端
 * 共用同一份解析与合并逻辑。内核零 DOM 依赖，所以时间、网络、存储
 * 一律走 PlatformAdapter。
 */
import type { MusicItem } from '../types'

/** 一条收藏（比 MusicItem 多一个收藏时间，用于合并时判新旧） */
export interface SyncFavorite extends MusicItem {
  /** 收藏时间，毫秒时间戳 */
  addedAt: number
}

/** 一个用户歌单 */
export interface SyncPlaylist {
  id: string
  name: string
  /** 创建时间，毫秒时间戳 */
  createdAt: number
  /** 最后修改时间，毫秒时间戳；合并时以此判定谁更新 */
  updatedAt: number
  items: MusicItem[]
}

/** 一条播放记录 */
export interface SyncHistoryEntry extends MusicItem {
  /** 最近一次播放时间，毫秒时间戳 */
  playedAt: number
  /** 累计播放次数 */
  playCount: number
}

/** 需要同步的客户端设置（只放跨设备有意义的部分） */
export interface SyncSettings {
  quality?: string
  volume?: number
  /** 播放模式：list / single / random */
  playMode?: string
  /** 歌词字号、是否显示翻译等 */
  lyricFontSize?: number
  showTranslation?: boolean
  theme?: string
  /** 加入试听列表时放头部还是尾部（对应 lx 的 list.addMusicLocationType） */
  addMusicLocationType?: 'top' | 'bottom'
}

/**
 * 一次同步的完整载荷。
 *
 * 刻意做成「整份文档」而不是「逐条增量」：数据量本来就小
 * （几千条收藏也就几百 KB），整份提交让服务端无需理解任何业务语义，
 * 只当一个带版本号的 JSON 盒子 —— 这样加字段不用改服务端。
 */
export interface SyncPayload {
  settings: SyncSettings
  /**
   * settings 的最后修改时间，毫秒时间戳。
   *
   * 设置本身没有逐字段时间戳，如果只做「后者覆盖前者」的字段合并，
   * merge(a,b) 与 merge(b,a) 结果不同 —— 两台设备会来回覆盖对方的
   * 音质/音量设置，永远收敛不了。给它一个整体时间戳，两边就按
   * 「谁的设置更新」整份取胜，交换律成立。
   */
  settingsUpdatedAt?: number
  favorites: SyncFavorite[]
  playlists: SyncPlaylist[]
  history: SyncHistoryEntry[]
  /**
   * 试听列表（对应 lx 的 default 列表），**有序**。
   *
   * 顺序就是用户排的顺序，所以合并时不能像收藏那样按时间重排 ——
   * 见 merge.ts 的 mergeTrial。
   */
  trial?: MusicItem[]
  /** 试听列表最后修改时间，毫秒时间戳；合并时以此判定哪边的顺序更新 */
  trialUpdatedAt?: number
  /**
   * 「不喜欢的歌曲」规则，一行一条（`歌名@艺术家` / `歌名` / `@艺术家`）。
   *
   * 用数组而不是整段文本：合并时要逐条取并集，字符串没法做。
   * 格式与 lx-music 完全一致，从 lx 导出的规则可以直接粘进来。
   */
  dislikes?: string[]
}

/** 服务端返回的同步文档 */
export interface SyncDocument {
  payload: SyncPayload
  /** 服务端单调递增的版本号，用于乐观并发控制 */
  revision: number
  /** 服务端最后更新时间，ISO8601 */
  updatedAt: string
  /** 写入该文档的设备名，便于用户辨认「哪台机器覆盖的」 */
  device?: string
}

/**
 * 一台已认证的设备（PARITY 8.3）。
 *
 * 客户端每次请求都带 `X-Device-Id` / `X-Device-Name`，服务端据此登记。
 * 撤销一台设备后，它再同步会被 403 —— 这才是「设备管理」的意义：
 * 手机丢了，不用改密码把所有设备踢下线，只踢那一台。
 */
export interface SyncDevice {
  id: string
  name: string
  /** 最后一次同步时间，ISO8601 */
  lastSeenAt: string
  /** 该设备最后一次写入的版本号 */
  revision: number
  /** 已撤销：该设备之后的同步请求会被拒绝 */
  revoked: boolean
}

/** 同步结果 */
export type SyncOutcome =  | { state: 'ok'; document: SyncDocument; pushed: boolean }
  | { state: 'conflict'; document: SyncDocument; merged: SyncPayload }
  | { state: 'disabled'; reason: string }
  | { state: 'error'; reason: string }

export interface SyncClientOptions {
  /**
   * 服务端根地址，默认 https://lain42.top/studio
   *
   * 与 SubscriptionClient 同一个前缀规则：pingap 只把 /studio/api/* 反代
   * 到 billing 服务，裸域名 /api/* 会命中前端 SPA 返回 HTML。
   */
  baseUrl?: string
  /** 本地缓存键名 */
  storageKey?: string
  /** 本机设备名，随文档一起上报 */
  deviceName?: string
}

/** 空的同步载荷，用于首次同步 */
export function emptyPayload(): SyncPayload {
  return {
    settings: {},
    settingsUpdatedAt: 0,
    favorites: [],
    playlists: [],
    history: [],
    dislikes: [],
    trial: [],
    trialUpdatedAt: 0,
  }
}
