/**
 * 播放器状态（桌面端）
 *
 * 把 @lxmn/core 的音源能力接到 Vue 的响应式系统上：
 *   search() -> getMusicUrl() -> <audio> 播放 -> getLyric() 取词
 *
 * 设计上刻意**不把 <audio> 放进这个模块**：内核要保持零 DOM 依赖
 * （移动端 tsconfig 里 types: []，连 DOM lib 都没有），
 * 所以这里只维护数据，真正的播放元素由组件持有并回灌进度。
 */
import { computed, reactive, readonly } from 'vue'
import {
  getSource,
  hasSource,
  listSources,
  qualityOrder,
  type MusicItem,
  type Quality,
} from '@lxmn/core'
import { library } from './sync'
import { resolveWithFallback } from './fallback'

/** 播放模式：顺序 / 列表循环 / 单曲循环 / 随机 */
export type PlayMode = 'order' | 'loop' | 'single' | 'shuffle'

export interface PlayerState {
  /** 当前播放列表 */
  queue: MusicItem[]
  /** 当前索引 */
  index: number
  playing: boolean
  /** 秒 */
  currentTime: number
  duration: number
  volume: number
  quality: Quality
  loading: boolean
  error: string
  /** 当前曲目的歌词行（原始 LRC） */
  lyric: string
  tlyric: string
  picUrl: string
  url: string
  /** 实际在播的曲目：串源后可能与队列里的那条不同 */
  playingItem: MusicItem | null
  /** 播放模式（点底栏那个循环图标切换，以前它点了没反应就是缺这个） */
  mode: PlayMode
  /** 桌面歌词浮层是否展开（底栏「词」按钮和 L 快捷键共用） */
  lyricOpen: boolean
  /** 静音前的音量，取消静音时还原 */
  volumeBeforeMute: number
}

const state = reactive<PlayerState>({
  queue: [],
  index: -1,
  playing: false,
  currentTime: 0,
  duration: 0,
  volume: 0.7,
  quality: '320k',
  loading: false,
  error: '',
  lyric: '',
  tlyric: '',
  picUrl: '',
  url: '',
  playingItem: null,
  mode: 'loop',
  lyricOpen: false,
  volumeBeforeMute: 0.7,
})

/** 播放地址的获取方式由组件注入（内核不认识 <audio>） */
let playUrl: ((url: string) => Promise<void>) | null = null
export function setPlaybackHandler(fn: ((url: string) => Promise<void>) | null): void {
  playUrl = fn
}

/** 跳转播放位置的方式同样由组件注入（内核不认识 <audio>） */
let seekHandler: ((time: number) => void) | null = null
export function setSeekHandler(fn: ((time: number) => void) | null): void {
  seekHandler = fn
}

const current = computed<MusicItem | null>(() => state.queue[state.index] ?? null)

/** 已安装的音源里，哪个能搜（用于提示用户当前可用范围） */
export const availableSources = computed(() => listSources().filter(id => hasSource(id)))

/**
 * 取流并交给宿主播放。
 *
 * 内核的 getMusicUrl 已经内置降档回退（高音质被锁时自动往低试），
 * 这里只负责把最终结果交给 <audio> 并回填封面。
 */
async function resolveAndPlay(item: MusicItem): Promise<void> {
  state.loading = true
  state.error = ''
  state.url = ''
  try {
    // 取流失败时静默换音源：网易标 VIP 的歌，酷我/酷狗/咪咕常常能放。
    // 故意**不提示**用户 —— 用户要的是「能听」，不是「我们换了哪个接口」。
    const outcome = await resolveWithFallback(item, state.quality)
    const info = outcome.info
    state.url = info.url
    // 实际拿到的音质可能与请求的不同（降档了），如实回填
    state.quality = info.quality
    // 串源后封面/歌词都跟着实际播放的那条走，
    // 否则会出现「听着酷狗的歌、显示网易的封面」。
    const played = outcome.switched ? outcome.item : item
    state.playingItem = played
    if (!state.picUrl && played.picUrl) state.picUrl = played.picUrl
    if (playUrl) await playUrl(info.url)
    state.playing = true
    // 播放记录：只有真的拿到流才记，避免把取流失败的歌也算进「最近播放」。
    // 失败不影响播放本身。
    void library.recordPlay(played).catch(() => undefined)
  } catch (e) {
    state.error = e instanceof Error ? e.message : String(e)
    state.playing = false
  } finally {
    state.loading = false
  }
}

/** 取歌词（失败不阻断播放：没有歌词也应该能听） */
async function loadLyric(item: MusicItem): Promise<void> {
  state.lyric = ''
  state.tlyric = ''
  try {
    const target = state.playingItem && state.playingItem.id === item.id ? state.playingItem : item
    const info = await getSource(target.source).getLyric(target)
    state.lyric = info.lyric ?? ''
    state.tlyric = info.tlyric ?? ''
  } catch {
    // 歌词是可选的，静默失败
  }
}

/** 取封面（同样不阻断） */
async function loadPic(item: MusicItem): Promise<void> {
  const target = state.playingItem && state.playingItem.id === item.id ? state.playingItem : item
  state.picUrl = target.picUrl ?? ''
  if (state.picUrl) return
  try {
    const info = await getSource(target.source).getPic(target)
    state.picUrl = info.url ?? ''
  } catch {
    // 忽略
  }
}

export function usePlayer() {
  /**
   * 搜索。
   *
   * 原来只查 wy 一家。内核现在有 wy/kw/mg/kg 四个能真取到音频的音源，
   * 只查一家等于把另外三家的曲库白白丢掉 —— 尤其 wy 大量 VIP 曲目
   * 拿不到地址，而同一首歌在 kw/mg 上往往是免费的。
   *
   * 并发查所有已注册的音源，按 (source, songmid) 去重后合并。
   * 单个音源失败不影响其它（搜「自由听歌」时最怕一个源超时就整页报错）。
   */
  async function search(keyword: string, page = 1, limit = 30) {
    const kw = keyword.trim()
    if (!kw) return { list: [], total: 0, page, limit, source: 'wy' as const }

    // 只挑真正实现了搜索的音源（有些音源只有榜单/歌单）
    const ids = listSources().filter(id => hasSource(id) && Boolean(getSource(id).musicSearch))
    if (!ids.length) throw new Error('当前没有可用的音源')

    const results = await Promise.all(
      ids.map(id =>
        getSource(id).musicSearch!(kw, page, limit).catch(() => null),
      ),
    )

    const seen = new Set<string>()
    const list: MusicItem[] = []
    let total = 0
    for (const r of results) {
      if (!r) continue
      total += r.total
      for (const it of r.list) {
        const key = it.source + '-' + String(it.songmid)
        if (seen.has(key)) continue
        seen.add(key)
        list.push(it)
      }
    }
    if (!list.length && results.every(r => r === null)) {
      throw new Error('所有音源都没有响应，请检查网络')
    }
    return { list, total, limit, page, source: 'wy' as const }
  }

  /** 播放指定曲目：把它插入队列并立即播放 */
  async function play(item: MusicItem, queue?: MusicItem[]): Promise<void> {
    if (queue?.length) {
      state.queue = queue
      state.index = queue.findIndex(x => x.songmid === item.songmid && x.source === item.source)
      if (state.index < 0) {
        state.queue = [item, ...queue]
        state.index = 0
      }
    } else {
      const at = state.queue.findIndex(x => x.songmid === item.songmid && x.source === item.source)
      if (at >= 0) state.index = at
      else {
        state.queue = [...state.queue, item]
        state.index = state.queue.length - 1
      }
    }
    state.currentTime = 0
    state.duration = 0
    await Promise.all([resolveAndPlay(item), loadLyric(item), loadPic(item)])
  }

  /**
   * 播下一首。
   *
   * auto=true 表示是「一首放完了自动进下一首」，这时要遵守播放模式：
   * 单曲循环重放当前、随机抽一首、顺序播到末尾就停。
   */
  async function next(auto = false): Promise<void> {
    if (!state.queue.length) return

    if (auto && state.mode === 'single') {
      const item = state.queue[state.index]
      if (item) {
        // 重取一次流再播：某些 CDN 地址带时效，直接 seek(0) 可能已经过期
        seek(0)
        if (state.url) { state.playing = true; return }
        await play(item)
      }
      return
    }

    if (state.mode === 'shuffle' && state.queue.length > 1) {
      let n = state.index
      while (n === state.index) n = Math.floor(Math.random() * state.queue.length)
      state.index = n
      const picked = state.queue[state.index]
      if (picked) await play(picked)
      return
    }

    const atEnd = state.index >= state.queue.length - 1
    if (auto && state.mode === 'order' && atEnd) {
      // 顺序播放：播完最后一首就停，不要偷偷回到第一首
      state.playing = false
      return
    }

    state.index = (state.index + 1) % state.queue.length
    const item = state.queue[state.index]
    if (item) await play(item)
  }

  async function prev(): Promise<void> {
    if (!state.queue.length) return
    state.index = (state.index - 1 + state.queue.length) % state.queue.length
    const item = state.queue[state.index]
    if (item) await play(item)
  }

  /** 播放模式循环切换：顺序 -> 列表循环 -> 单曲循环 -> 随机 */
  const MODE_ORDER: PlayMode[] = ['order', 'loop', 'single', 'shuffle']
  const MODE_LABEL: Record<PlayMode, string> = {
    order: '顺序播放',
    loop: '列表循环',
    single: '单曲循环',
    shuffle: '随机播放',
  }

  function cycleMode(): PlayMode {
    const at = MODE_ORDER.indexOf(state.mode)
    state.mode = MODE_ORDER[(at + 1) % MODE_ORDER.length] ?? 'loop'
    return state.mode
  }

  function modeLabel(): string {
    return MODE_LABEL[state.mode]
  }

  /** 桌面歌词浮层开关（底栏「词」+ L 快捷键） */
  function toggleLyric(): void {
    state.lyricOpen = !state.lyricOpen
  }

  /** 静音：记住原音量，再按还原 */
  function toggleMute(): void {
    if (state.volume > 0) {
      state.volumeBeforeMute = state.volume
      state.volume = 0
    } else {
      state.volume = state.volumeBeforeMute || 0.7
    }
  }

  /**
   * 播放 / 暂停。
   *
   * 关键点：**不要在这里直接翻转 state.playing**，而是只在"当前没有曲目"时
   * 才需要真正去取流播放。有曲目时交给 <audio> 的 play/pause 事件回灌，
   * 否则会和 AudioHost 的 watch 形成互相打架的两个真相来源 ——
   * 点了暂停、watch 又看到 playing=true 把音频播回去。
   */
  function toggle(): void {
    const item = current.value
    if (!item) return
    if (!state.url) {
      // 还没取到地址（比如首次点播放），走完整的取流流程
      void play(item)
      return
    }
    state.playing = !state.playing
  }

  /** 跳转到指定秒数；由 <audio> 宿主真正执行 */
  function seek(time: number): void {
    const t = Math.max(0, Number(time) || 0)
    state.currentTime = t
    if (seekHandler) seekHandler(t)
  }

  /** 切换音质后立刻用新音质重取当前曲目 */
  async function setQuality(q: Quality): Promise<void> {
    state.quality = q
    const item = current.value
    if (item) await resolveAndPlay(item)
  }

  return {
    state: readonly(state) as Readonly<PlayerState>,
    current,
    availableSources,
    qualityOrder,
    search, play, next, prev, toggle, seek, setQuality,
    cycleMode, modeLabel, MODE_LABEL,
    toggleLyric, toggleMute,
    /** 组件回灌：<audio> 的进度/时长 */
    reportTime: (t: number) => { state.currentTime = t },
    reportDuration: (d: number) => { state.duration = d },
    setVolume: (v: number) => { state.volume = v },
    setPlaying: (p: boolean) => { state.playing = p },
    setError: (msg: string) => { state.error = msg },
    clearError: () => { state.error = '' },
  }
}
