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
import { dedupeTracks, isSameTrack, trackKey } from '../track'
import {
  trialAdd,
  trialIndexOf,
  trialHas,
  trialRemove,
  trialRemoveKeys,
  trialMoveTo,
  trialShift,
  trialTakeOut,
  TRIAL_MAX,
  type AddLocation,
} from '../trial'
import { SyncClient, DEFAULT_SYNC_BASE } from '../sync/client'
import { mergePayload } from '../sync/merge'
import {
  addDislikeRules,
  hasDislike as matchDislike,
  linesToRules,
  parseDislikeRules,
  removeDislikeRule,
  ruleLines,
  type DislikeIndex,
  type DislikeTarget,
} from '../dislike'
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
  /** 试听列表（对应 lx 的 default 列表），有序 */
  trial: MusicItem[]
  /** 试听列表最后修改时间，合并时判定顺序归属 */
  trialUpdatedAt: number
  /** 「不喜欢的歌曲」规则，一行一条。格式与 lx-music 兼容 */
  dislikes: string[]
  settings: SyncSettings
  settingsUpdatedAt: number
}

function initialState(): LibraryState {
  return {
    favorites: [],
    playlists: [],
    history: [],
    trial: [],
    trialUpdatedAt: 0,
    dislikes: [],
    settings: {},
    settingsUpdatedAt: 0,
  }
}

/** 歌单名归一化：去首尾空白、压掉连续空白、截断到上限 */
function cleanPlaylistName(name: string): string {
  return String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_PLAYLIST_NAME)
}

/**
 * 构造同步客户端，配置非法时退回默认服务器。
 *
 * Library 是在模块顶层 `new Library()` 的（移动端 src/sync.ts），
 * 构造函数一抛错，那个模块就加载失败，所有 `import { library }` 拿到
 * undefined —— 表现为「每个页面都报 Cannot read property 'library' of undefined」。
 * 同步地址填错是用户输入问题，不该让整个曲库不可用。
 */
function createSyncClient(options: { syncBaseUrl?: string; deviceName?: string }): SyncClient {
  try {
    return new SyncClient({
      baseUrl: options.syncBaseUrl ?? DEFAULT_SYNC_BASE,
      deviceName: options.deviceName,
    })
  } catch {
    return new SyncClient({ deviceName: options.deviceName })
  }
}

export class Library {
  private state: LibraryState = initialState()
  private loaded = false
  private readonly sync: SyncClient
  private readonly listeners = new Set<(s: LibraryState) => void>()
  /**
   * 规则解析结果缓存。
   *
   * 每次判断「这首歌要不要跳过」都重新解析整份规则文本是浪费 ——
   * 随机播放时每切一首歌都要问一次。规则只在增删时变，重建一次就够。
   */
  private dislikeIdx: DislikeIndex = parseDislikeRules('')

  constructor(options: { syncBaseUrl?: string; deviceName?: string } = {}) {
    this.sync = createSyncClient(options)
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
    const snapshot = this.view()
    for (const fn of this.listeners) fn(snapshot)
  }

  /**
   * 复制一份状态给外部。
   *
   * 宿主是响应式系统（Vue 的 ref / React 的 setState），直接把内部对象
   * 交出去，外部改到数组就会绕过 persist 改坏内部状态。
   */
  private view(): LibraryState {
    return {
      favorites: [...this.state.favorites],
      playlists: this.state.playlists.map(p => ({ ...p, items: [...p.items] })),
      history: [...this.state.history],
      trial: [...this.state.trial],
      trialUpdatedAt: this.state.trialUpdatedAt,
      dislikes: [...this.state.dislikes],
      settings: { ...this.state.settings },
      settingsUpdatedAt: this.state.settingsUpdatedAt,
    }
  }

  snapshot(): LibraryState {
    return this.view()
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
          // 老库里没有 trial 字段，缺省成空数组即可；
          // 顺便去一次重 —— 早期版本没有试听列表，数据只能来自同步，
          // 而同步合并的历史上有过重复写入的可能
          trial: Array.isArray(parsed.trial) ? dedupeTracks(parsed.trial).slice(0, TRIAL_MAX) : [],
          trialUpdatedAt: Number(parsed.trialUpdatedAt) || 0,
          // 老版本的库里没有 dislikes 字段，缺省成空数组即可，不需要迁移
          dislikes: Array.isArray(parsed.dislikes) ? parsed.dislikes.map(String) : [],
          settings: parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {},
          settingsUpdatedAt: Number(parsed.settingsUpdatedAt) || 0,
        }
      }
    } catch {
      this.state = initialState()
    }
    this.rebuildDislikeIndex()
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
      dislikes: [...this.state.dislikes],
      trial: [...this.state.trial],
      trialUpdatedAt: this.state.trialUpdatedAt,
    }
  }

  /** 用一份载荷替换整个库（同步合并后调用） */
  async replace(payload: SyncPayload): Promise<void> {
    const merged = mergePayload(this.toPayload(), payload)
    this.state = {
      favorites: merged.favorites.slice(0, MAX_FAVORITES),
      playlists: merged.playlists,
      history: merged.history.slice(0, MAX_HISTORY),
      trial: dedupeTracks(merged.trial ?? []).slice(0, TRIAL_MAX),
      trialUpdatedAt: Number(merged.trialUpdatedAt) || 0,
      dislikes: linesToRules(merged.dislikes ?? []).split('\n').filter(Boolean),
      settings: merged.settings,
      settingsUpdatedAt: Number(merged.settingsUpdatedAt) || 0,
    }
    this.rebuildDislikeIndex()
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

  /**
   * 清空全部收藏（PARITY 4.9 列表数据清理）。
   *
   * 不做「逐条 removeFavorite」的循环：那样每次都要 persist + emit，
   * 几千条收藏会把 localStorage 写几千遍。整体替换一次就够。
   */
  async clearFavorites(): Promise<number> {
    await this.load()
    const n = this.state.favorites.length
    if (!n) return 0
    this.state.favorites = []
    await this.persist()
    this.emit()
    return n
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

  // ------------------------------------------------------------ 试听列表

  /** 试听列表快照（有序） */
  get trial(): MusicItem[] {
    return [...this.state.trial]
  }

  /**
   * 是否已在试听列表里。
   *
   * 与 isDisliked 一样做成**同步**：搜索页每渲染一行都要问一次，
   * 做成 async 会让列表出现「先没有标记、再闪出一个点」的跳动。
   */
  isInTrial(item: MusicItem): boolean {
    return trialHas(this.state.trial, item)
  }

  /** 在试听列表里的位置，没有返回 -1 */
  trialIndexOf(item: MusicItem): number {
    return trialIndexOf(this.state.trial, item)
  }

  /**
   * 加入试听列表。
   *
   * 返回「是否真的有新增」—— 播放链路用它决定要不要重建队列：
   * 重复点同一首歌时列表没变，重建队列会让正在播的那首被打断。
   */
  async addToTrial(items: readonly MusicItem[] | MusicItem, location?: AddLocation): Promise<boolean> {
    await this.load()
    const list = Array.isArray(items) ? items : [items]
    if (!list.some(it => !trialHas(this.state.trial, it))) return false
    const at = location ?? this.state.settings.addMusicLocationType ?? 'top'
    this.state.trial = trialAdd(this.state.trial, list, at)
    await this.touchTrial()
    return true
  }

  async removeFromTrial(items: readonly MusicItem[] | MusicItem): Promise<void> {
    await this.load()
    const list = Array.isArray(items) ? items : [items]
    const next = trialRemove(this.state.trial, list)
    if (next.length === this.state.trial.length) return
    this.state.trial = next
    await this.touchTrial()
  }

  /** 按键删除（界面里拿到的是 `source::songmid`） */
  async removeTrialKeys(keys: readonly string[]): Promise<void> {
    await this.load()
    const next = trialRemoveKeys(this.state.trial, keys)
    if (next.length === this.state.trial.length) return
    this.state.trial = next
    await this.touchTrial()
  }

  async clearTrial(): Promise<void> {
    await this.load()
    if (!this.state.trial.length) return
    this.state.trial = []
    await this.touchTrial()
  }

  /** 把选中的曲目移到 position（拖拽排序），keys 的顺序即目标顺序 */
  async moveInTrial(position: number, keys: readonly string[]): Promise<void> {
    await this.load()
    if (!keys.length) return
    const next = trialMoveTo(this.state.trial, position, keys)
    if (next.length === this.state.trial.length && next.every((x, i) => trackKey(x) === trackKey(this.state.trial[i]!))) {
      return
    }
    this.state.trial = next
    await this.touchTrial()
  }

  /** 上移 / 下移一首，delta 为 -1 / +1 */
  async shiftInTrial(key: string, delta: number): Promise<void> {
    await this.load()
    const next = trialShift(this.state.trial, key, delta)
    if (next.every((x, i) => trackKey(x) === trackKey(this.state.trial[i]!))) return
    this.state.trial = next
    await this.touchTrial()
  }

  /**
   * 把试听列表里的若干首转存到自建歌单（对应 lx 的跨列表移动）。
   *
   * 顺序跟着试听列表走 —— 用户是「把这几首整体存进去」，
   * 不是「随便塞进去」，顺序反了等于没存对。
   * 返回真正加进歌单的条数（已在歌单里的会被跳过）。
   */
  async moveTrialToPlaylist(keys: readonly string[], playlistId: string): Promise<number> {
    await this.load()
    const pl = this.state.playlists.find(p => p.id === playlistId)
    if (!pl || !keys.length) return 0
    const { moved, rest } = trialTakeOut(this.state.trial, keys)
    if (!moved.length) return 0
    const have = new Set(pl.items.map(trackKey))
    let added = 0
    for (const item of moved) {
      const key = trackKey(item)
      if (have.has(key)) continue
      have.add(key)
      pl.items.push(item)
      added++
    }
    if (added) pl.updatedAt = Date.now()
    if (rest.length !== this.state.trial.length) {
      this.state.trial = rest
      this.state.trialUpdatedAt = Date.now()
    }
    await this.persist()
    this.emit()
    return added
  }

  /** 落盘 + 广播，并推进 trialUpdatedAt（同步时用来判定顺序归属） */
  private async touchTrial(): Promise<void> {
    this.state.trialUpdatedAt = Date.now()
    await this.persist()
    this.emit()
  }

  // ------------------------------------------------------------ 不喜欢的歌曲

  private rebuildDislikeIndex(): void {
    this.dislikeIdx = parseDislikeRules(this.state.dislikes.join('\n'))
  }

  /** 规则索引（只读）。界面用它显示「已屏蔽 N 条」 */
  get dislikeIndex(): DislikeIndex {
    return this.dislikeIdx
  }

  /** 规则原文，一行一条 */
  get dislikes(): string[] {
    return [...this.state.dislikes]
  }

  /**
   * 这首歌是否被标记为「不喜欢」。
   *
   * 刻意做成**同步**方法：随机播放时每切一首歌都要判断一次，
   * 做成 async 会让播放链路多一个 await，切歌手感变钝。
   * 前提是调用方已经 `load()` 过（应用启动时会做）。
   */
  isDisliked(item: DislikeTarget | null | undefined): boolean {
    return matchDislike(this.dislikeIdx, item)
  }

  /** 标记不喜欢，可一次传多首 */
  async addDislikes(targets: readonly DislikeTarget[]): Promise<void> {
    await this.load()
    await this.applyDislikeText(addDislikeRules(this.state.dislikes.join('\n'), targets))
  }

  /** 取消不喜欢 */
  async removeDislike(target: DislikeTarget): Promise<void> {
    await this.load()
    await this.applyDislikeText(removeDislikeRule(this.state.dislikes.join('\n'), target))
  }

  /** 整体替换规则（设置页的文本框保存时调用） */
  async setDislikeRules(text: string): Promise<void> {
    await this.load()
    await this.applyDislikeText(text)
  }

  /** 清空全部规则 */
  async clearDislikes(): Promise<void> {
    await this.load()
    await this.applyDislikeText('')
  }

  /**
   * 落盘 + 广播。
   *
   * 先比对再写：规则没变就不 emit —— 否则设置页每次失焦保存都会
   * 触发一次全应用重渲染，正在播的歌单列表会白闪一下。
   */
  private async applyDislikeText(text: string): Promise<void> {
    const lines = ruleLines(text)
    const prev = this.state.dislikes
    if (lines.length === prev.length && lines.every((line, i) => line === prev[i])) return
    this.state.dislikes = lines
    this.rebuildDislikeIndex()
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
