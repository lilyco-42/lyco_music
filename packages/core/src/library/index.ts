/**
 * 本地曲库：收藏 / 歌单 / 播放记录 / 设置
 *
 * 内核级实现，桌面端与移动端共用 —— 这样「收藏了什么」在两端的行为
 * （去重规则、排序、上限）完全一致，同步时也就不会因为两端规则不同
 * 而互相覆盖。
 *
 * 零 DOM 依赖：持久化走 PlatformAdapter.storage，网络走 SyncClient。
 */
import { getPlatform } from '../registry'
import type { MusicItem } from '../types'
import { SyncClient, DEFAULT_SYNC_BASE } from '../sync/client'
import { mergePayload } from '../sync/merge'
import {
  emptyPayload,
  type SyncFavorite,
  type SyncHistoryEntry,
  type SyncOutcome,
  type SyncPayload,
  type SyncPlaylist,
  type SyncSettings,
} from '../sync/types'

const LIBRARY_KEY = 'lxmn.library'
/** 播放记录上限：超过就丢最旧的。不设上限的话用得越久越大，同步会越来越慢 */
const MAX_HISTORY = 500
/** 收藏上限：足够大，但总得有个头，避免异常数据把存储撑爆 */
const MAX_FAVORITES = 5000
/** 歌单名长度上限：再长在侧边栏里也只是被截断，没有意义 */
const MAX_PLAYLIST_NAME = 40

export interface LibraryState {
  favorites: SyncFavorite[]
  playlists: SyncPlaylist[]
  history: SyncHistoryEntry[]
  settings: SyncSettings
  settingsUpdatedAt: number
}

function initialState(): LibraryState {
  return { favorites: [], playlists: [], history: [], settings: {}, settingsUpdatedAt: 0 }
}

function trackKey(item: { source?: string; songmid?: string | number }): string {
  return String(item.source ?? '') + '::' + String(item.songmid ?? '')
}

function isSameTrack(a: MusicItem, b: MusicItem): boolean {
  return a.source === b.source && String(a.songmid) === String(b.songmid)
}

/** 歌单名归一化：去首尾空白、压掉连续空白、截断到上限 */
function cleanPlaylistName(name: string): string {
  return String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_PLAYLIST_NAME)
}

export class Library {
  private state: LibraryState = initialState()
  private loaded = false
  private readonly sync: SyncClient
  private readonly listeners = new Set<(s: LibraryState) => void>()

  constructor(options: { syncBaseUrl?: string; deviceName?: string } = {}) {
    this.sync = new SyncClient({
      baseUrl: options.syncBaseUrl ?? DEFAULT_SYNC_BASE,
      deviceName: options.deviceName,
    })
  }

  /** 同步服务器地址（默认 lain42.top） */
  get syncServer(): string {
    return this.sync.server
  }

  subscribe(fn: (s: LibraryState) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit(): void {
    // 复制一份再广播：宿主是响应式系统，直接给内部对象会让外部改到内部状态
    const snapshot: LibraryState = {
      favorites: [...this.state.favorites],
      playlists: this.state.playlists.map(p => ({ ...p, items: [...p.items] })),
      history: [...this.state.history],
      settings: { ...this.state.settings },
      settingsUpdatedAt: this.state.settingsUpdatedAt,
    }
    for (const fn of this.listeners) fn(snapshot)
  }

  snapshot(): LibraryState {
    return {
      favorites: [...this.state.favorites],
      playlists: this.state.playlists.map(p => ({ ...p, items: [...p.items] })),
      history: [...this.state.history],
      settings: { ...this.state.settings },
      settingsUpdatedAt: this.state.settingsUpdatedAt,
    }
  }

  /** 从本地存储载入；失败时退回空库而不是抛错（首次启动没有数据是正常的） */
  async load(): Promise<LibraryState> {
    if (this.loaded) return this.snapshot()
    try {
      const raw = await getPlatform().storage.get(LIBRARY_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<LibraryState>
        this.state = {
          favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
          playlists: Array.isArray(parsed.playlists) ? parsed.playlists : [],
          history: Array.isArray(parsed.history) ? parsed.history : [],
          settings: parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {},
          settingsUpdatedAt: Number(parsed.settingsUpdatedAt) || 0,
        }
      }
    } catch {
      this.state = initialState()
    }
    this.loaded = true
    this.emit()
    return this.snapshot()
  }

  /**
   * 写回本地存储。
   *
   * 必须先 load()：如果没读过就写，写下去的是一份空库，会把用户
   * 已经存着的收藏和歌单整个抹掉。播放记录是「播完顺手记一次」，
   * 很容易发生在用户还没进过任何会 load 的页面时，所以这道保险是必要的。
   */
  private async persist(): Promise<void> {
    if (!this.loaded) {
      // 静默跳过而不是抛错：记录失败不该让播放本身失败。
      // 这里宁可丢这一次记录，也不能覆盖掉用户已有的数据。
      return
    }
    try {
      await getPlatform().storage.set(LIBRARY_KEY, JSON.stringify(this.state))
    } catch {
      // 存储失败不影响内存中的使用
    }
  }

  /** 导出成同步载荷 */
  toPayload(): SyncPayload {
    return {
      settings: { ...this.state.settings },
      settingsUpdatedAt: this.state.settingsUpdatedAt,
      favorites: [...this.state.favorites],
      playlists: this.state.playlists.map(p => ({ ...p, items: [...p.items] })),
      history: [...this.state.history],
    }
  }

  /** 用一份载荷替换整个库（同步合并后调用） */
  async replace(payload: SyncPayload): Promise<void> {
    const merged = mergePayload(this.toPayload(), payload)
    this.state = {
      favorites: merged.favorites.slice(0, MAX_FAVORITES),
      playlists: merged.playlists,
      history: merged.history.slice(0, MAX_HISTORY),
      settings: merged.settings,
      settingsUpdatedAt: Number(merged.settingsUpdatedAt) || 0,
    }
    await this.persist()
    this.emit()
  }

  // ------------------------------------------------------------ 收藏

  isFavorite(item: MusicItem): boolean {
    return this.state.favorites.some(f => isSameTrack(f, item))
  }

  /** 切换收藏。返回切换后的状态，便于界面给反馈。 */
  async toggleFavorite(item: MusicItem): Promise<boolean> {
    await this.load()
    const at = this.state.favorites.findIndex(f => isSameTrack(f, item))
    if (at >= 0) {
      this.state.favorites.splice(at, 1)
      await this.persist()
      this.emit()
      return false
    }
    this.state.favorites.unshift({ ...item, addedAt: Date.now() })
    if (this.state.favorites.length > MAX_FAVORITES) {
      this.state.favorites.length = MAX_FAVORITES
    }
    await this.persist()
    this.emit()
    return true
  }

  async removeFavorite(item: MusicItem): Promise<void> {
    await this.load()
    const at = this.state.favorites.findIndex(f => isSameTrack(f, item))
    if (at < 0) return
    this.state.favorites.splice(at, 1)
    await this.persist()
    this.emit()
  }

  // ------------------------------------------------------------ 播放记录

  /** 记一次播放。同一首歌只保留一条，累计次数。 */
  async recordPlay(item: MusicItem): Promise<void> {
    // 先 load：播放记录常常发生在用户还没进过任何会 load 的页面时，
    // 不读就写会把已存的收藏和歌单覆盖成空库。
    await this.load()
    const at = this.state.history.findIndex(h => isSameTrack(h, item))
    const now = Date.now()
    if (at >= 0) {
      const prev = this.state.history[at]
      if (prev) {
        this.state.history.splice(at, 1)
        this.state.history.unshift({ ...prev, ...item, playedAt: now, playCount: (prev.playCount || 0) + 1 })
      }
    } else {
      this.state.history.unshift({ ...item, playedAt: now, playCount: 1 })
    }
    if (this.state.history.length > MAX_HISTORY) {
      this.state.history.length = MAX_HISTORY
    }
    await this.persist()
    this.emit()
  }

  async clearHistory(): Promise<void> {
    await this.load()
    this.state.history = []
    await this.persist()
    this.emit()
  }

  // ------------------------------------------------------------ 歌单

  async createPlaylist(name: string): Promise<SyncPlaylist> {
    await this.load()
    const now = Date.now()
    const pl: SyncPlaylist = {
      id: 'pl-' + now.toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36),
      name: cleanPlaylistName(name) || '新建歌单',
      createdAt: now,
      updatedAt: now,
      items: [],
    }
    this.state.playlists.unshift(pl)
    await this.persist()
    this.emit()
    return pl
  }

  /**
   * 歌单改名。
   *
   * 空白名一律拒绝 —— 歌单靠名字在侧边栏区分，允许改成空串等于把它变成
   * 一条看不见的幽灵记录。同名也拒绝：两个「我的歌单」在界面上无法分辨，
   * 用户点哪个都可能是错的。
   */
  async renamePlaylist(playlistId: string, name: string): Promise<boolean> {
    await this.load()
    const pl = this.state.playlists.find(p => p.id === playlistId)
    if (!pl) return false
    const next = cleanPlaylistName(name)
    if (!next || next === pl.name) return false
    if (this.state.playlists.some(p => p.id !== playlistId && p.name === next)) return false
    pl.name = next
    pl.updatedAt = Date.now()
    await this.persist()
    this.emit()
    return true
  }

  async addToPlaylist(playlistId: string, item: MusicItem): Promise<boolean> {
    await this.load()
    const pl = this.state.playlists.find(p => p.id === playlistId)
    if (!pl) return false
    if (pl.items.some(i => isSameTrack(i, item))) return false
    pl.items.push(item)
    pl.updatedAt = Date.now()
    await this.persist()
    this.emit()
    return true
  }

  async removeFromPlaylist(playlistId: string, item: MusicItem): Promise<void> {
    await this.load()
    const pl = this.state.playlists.find(p => p.id === playlistId)
    if (!pl) return
    const at = pl.items.findIndex(i => isSameTrack(i, item))
    if (at < 0) return
    pl.items.splice(at, 1)
    pl.updatedAt = Date.now()
    await this.persist()
    this.emit()
  }

  async deletePlaylist(playlistId: string): Promise<void> {
    await this.load()
    const at = this.state.playlists.findIndex(p => p.id === playlistId)
    if (at < 0) return
    this.state.playlists.splice(at, 1)
    await this.persist()
    this.emit()
  }

  // ------------------------------------------------------------ 设置

  async updateSettings(patch: SyncSettings): Promise<void> {
    await this.load()
    this.state.settings = { ...this.state.settings, ...patch }
    this.state.settingsUpdatedAt = Date.now()
    await this.persist()
    this.emit()
  }

  // ------------------------------------------------------------ 同步

  /** 是否配置过同步令牌 */
  async syncConfigured(): Promise<boolean> {
    return this.sync.configured()
  }

  /** 用订阅令牌（或自建令牌）开启同步 */
  async configureSync(token: string, baseUrl?: string): Promise<void> {
    await this.sync.configure(token, baseUrl)
  }

  /** 关闭同步并清掉本地同步缓存（本地曲库保留） */
  async disableSync(): Promise<void> {
    await this.sync.clear()
  }

  /** 同步一次：拉远端、合并、必要时推回。 */
  async syncNow(): Promise<SyncOutcome> {
    await this.load()
    const result = await this.sync.sync(this.toPayload())
    if (result.state === 'ok') {
      await this.replace(result.document.payload)
    } else if (result.state === 'conflict') {
      // 两次都撞上并发写：先把合并结果落到本地，下次同步再推
      await this.replace(result.merged)
    }
    return result
  }

  /** 恢复上次同步的载荷（离线也能用） */
  async restoreSync(): Promise<{ configured: boolean; payload: SyncPayload; syncedAt: number }> {
    const r = await this.sync.restore()
    if (r.configured) await this.replace(r.payload)
    return { configured: r.configured, payload: r.payload, syncedAt: r.syncedAt }
  }

  /** 当前同步令牌（用于界面掩码展示） */
  async syncToken(): Promise<string> {
    return this.sync.token()
  }
}

export { emptyPayload, MAX_HISTORY, MAX_FAVORITES, LIBRARY_KEY }
export type { SyncFavorite, SyncHistoryEntry, SyncPlaylist, SyncSettings }
