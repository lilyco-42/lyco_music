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
  intervalSeconds,
  isTrialClip,
  type MusicItem,
  type Quality,
  type SourceId,
} from '@lxmn/core'
import { library } from './sync'
import { resolveWithFallback } from './fallback'
import { findSameSong } from './same-song'
import { describePlayError, isRetriablePlayError } from './play-error'

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
  /** 罗马音歌词（日文歌用；只有网易云提供） */
  romalrc: string
  /** 逐字歌词（只有网易云提供），用于逐字染色 */
  ylyric: string
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
  /** 本曲是否已经因为「只给试听」重取过，避免来回换源 */
  trialRetried: boolean
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
  romalrc: '',
  ylyric: '',
  picUrl: '',
  url: '',
  playingItem: null,
  mode: 'loop',
  lyricOpen: false,
  volumeBeforeMute: 0.7,
  trialRetried: false,
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
 * 一次播放最多重试几次。
 *
 * 这个数字是「其他源」可用性的核心：酷狗/酷我给的地址带时效签名
 * （sharefs.kugou.com 的路径里就有时间戳），CDN 还会按 IP 限流，
 * 同一首歌上一分钟能播、下一分钟就 403 —— 实测复现过。
 * 拿到地址 ≠ 能播，而 <audio> 只会在真正加载时才发现，所以必须留重试。
 */
const MAX_STREAM_RETRY = 2

/** 这次播放已经重试到第几级（0=首次，1=原源重取，2=跨源） */
let streamAttempt = 0

/**
 * 本轮播放里「地址取到了但放不出来」的音源。
 *
 * 重试时把它们从串源候选里剔掉，否则三级阶梯会连着三次踩同一个坏地址 ——
 * 酷我的占位音频、酷狗限流后的 403 都属于这种「每次都一样坏」的情况。
 */
const badSources = new Set<SourceId>()

/**
 * 取流并交给宿主播放。
 *
 * 内核的 getMusicUrl 已经内置降档回退（高音质被锁时自动往低试），
 * 这里负责把最终结果交给 <audio>，并处理「地址拿到了但打不开」。
 *
 * 三级阶梯（全程静默，用户只看到「在加载」）：
 *   0. 正常取流（原源 -> 脚本池 -> 跨源，fallback 内部已经串好）
 *   1. 原源重取一次 —— 地址过期是最常见的原因，重取就是换一张新签名
 *   2. 排除原源，直接跨源 —— 这个源确实放不了这首歌
 */
async function resolveAndPlay(item: MusicItem, from = 0): Promise<void> {
  state.loading = true
  state.error = ''
  state.url = ''
  let lastErr: unknown = null

  for (let attempt = from; attempt <= MAX_STREAM_RETRY; attempt++) {
    streamAttempt = attempt
    try {
      // 第 2 级才排除原源：前两级留着它，是因为「重新签一次名」经常就好了
      const exclude = attempt >= MAX_STREAM_RETRY ? item.source : undefined
      // 取流失败时静默换音源：网易标 VIP 的歌，酷我/酷狗/咪咕常常能放。
      // 故意**不提示**用户 —— 用户要的是「能听」，不是「我们换了哪个接口」。
      const outcome = await resolveWithFallback(item, state.quality, { exclude, avoid: [...badSources] })
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
      streamAttempt = 0
      // 播放记录：只有真的拿到流才记，避免把取流失败的歌也算进「最近播放」。
      // 失败不影响播放本身。
      void library.recordPlay(played).catch(() => undefined)
      state.loading = false
      return
    } catch (e) {
      lastErr = e
      state.url = ''
      // 地址已经设给 <audio> 才失败 -> 这个源给的地址是坏的，后面别再用
      if (state.playingItem) badSources.add(state.playingItem.source)
      if (!isRetriablePlayError(e)) break
      // 换源要重搜，稍微等一下，别把几个音源的接口一起打爆
      if (attempt < MAX_STREAM_RETRY) await new Promise(r => setTimeout(r, 260))
    }
  }

  state.error = describePlayError(lastErr)
  state.playing = false
  state.loading = false
}

/**
 * 拿一条「现在就能用」的流地址，用于下载这类不进播放器的场景。
 *
 * 不直接读 state.url 是因为它可能是几分钟前取的、签名已经过期；
 * 也不复用 resolveAndPlay 是因为下载不该顺手把歌播起来。
 */
async function ensureStreamUrl(): Promise<string> {
  const item = state.playingItem ?? current.value
  if (!item) throw new Error('没有正在播放的歌曲')
  const outcome = await resolveWithFallback(item, state.quality)
  return outcome.info.url
}

/**
 * 播放中途失败时的自愈入口（AudioHost 的 @error 和加载看门狗都调它）。
 *
 * 和 resolveAndPlay 的区别：这时地址已经设给 <audio> 了，属于「播到一半断了」
 * 或「迟迟加载不出来」，所以从第 1 级（原源重取）接着往下走，不重头来。
 */
async function recoverStreamError(): Promise<void> {
  const item = state.playingItem ?? current.value
  if (!item) return
  // 已经在重试链里就别插队，否则会和正在跑的那次互相覆盖 url
  if (state.loading) return
  await resolveAndPlay(item, Math.max(1, streamAttempt))
}

/** 时长工具与试听判定都放在内核（纯函数，可被单测覆盖） */
function looksLikeTrialClip(duration: number): boolean {
  // 串源后 playingItem 可能来自搜索结果、没有时长字段，回落到队列里那条的时长
  const expected = Math.max(
    intervalSeconds(state.playingItem?.interval),
    intervalSeconds(current.value?.interval),
  )
  if (!expected || expected < 60) return false
  if (!Number.isFinite(duration) || duration <= 0) return false
  return isTrialClip(duration, expected)
}

/** 发现试听片段后，排除这个源，换别的源重取一次 */
async function retryAfterTrialClip(): Promise<void> {
  if (state.trialRetried) return
  const item = state.playingItem ?? current.value
  if (!item) return
  state.trialRetried = true
  try {
    const outcome = await resolveWithFallback(item, state.quality, { exclude: item.source })
    state.url = outcome.info.url
    state.quality = outcome.info.quality
    state.playingItem = outcome.switched ? outcome.item : item
    if (state.playingItem.picUrl) state.picUrl = state.playingItem.picUrl
    if (playUrl) await playUrl(outcome.info.url)
    state.playing = true
    state.error = ''
  } catch {
    state.error = '该音源只提供试听片段，完整版需要在对应平台开通会员'
    state.playing = false
  }
}

/**
 * 歌词加载的世代号。
 *
 * 跨源补词要发好几次请求，用户很可能中途就切歌了；
 * 没有这个令牌的话，上一首的歌词会在几秒后盖掉当前这首的。
 */
let lyricToken = 0

/**
 * 取歌词。失败不阻断播放 —— 没有歌词也应该能听。
 *
 * 但「当前音源没词」是常态而不是异常：实测酷我同一首歌的多个版本里，
 * 大部分版本的歌词接口返回 0 行（DJ 版、纯音乐、翻唱尤其明显），
 * 而同一首歌在别的平台上往往有完整词。所以这里做两次补全：
 *   1. 没词 -> 按「歌名 + 歌手」去别的音源找同一首，取它的词；
 *   2. 有词但没有翻译/罗马音 -> 去网易云找同一首，借它的 tlyric / romalrc。
 *      酷狗、酷我、咪咕都没有翻译和罗马音接口，网易云是唯一来源。
 */
async function loadLyric(item: MusicItem): Promise<void> {
  const token = ++lyricToken
  state.lyric = ''
  state.tlyric = ''
  state.romalrc = ''
  state.ylyric = ''
  const target = state.playingItem && state.playingItem.id === item.id ? state.playingItem : item

  /** 只有还是同一世代才写回，避免串歌 */
  const commit = (lyric: string, tlyric: string, romalrc: string, ylyric: string): boolean => {
    if (token !== lyricToken) return false
    state.lyric = lyric
    state.tlyric = tlyric
    state.romalrc = romalrc
    state.ylyric = ylyric
    return true
  }

  let lyric = ''
  let tlyric = ''
  let romalrc = ''
  let ylyric = ''

  try {
    const info = await getSource(target.source).getLyric(target)
    lyric = info.lyric ?? ''
    tlyric = info.tlyric ?? ''
    romalrc = info.romalrc ?? ''
    ylyric = info.ylyric ?? ''
  } catch {
    // 原音源没词或接口失败，都继续往下找
  }

  // 第一层补全：整首词都没有，换一家拿词
  if (!lyric.trim()) {
    const alt = await findSameSong(target)
    if (alt) {
      try {
        const info = await getSource(alt.source).getLyric(alt)
        lyric = info.lyric ?? ''
        tlyric = tlyric || (info.tlyric ?? '')
        romalrc = romalrc || (info.romalrc ?? '')
        ylyric = ylyric || (info.ylyric ?? '')
      } catch {
        // 这家也没词
      }
    }
  }

  // 第二层补全：有词但缺翻译/罗马音/逐字，去网易云借
  if (lyric.trim() && (!tlyric || !romalrc || !ylyric) && target.source !== 'wy') {
    const wyItem = await findSameSong(target, 'wy')
    if (wyItem) {
      try {
        const info = await getSource('wy').getLyric(wyItem)
        tlyric = tlyric || (info.tlyric ?? '')
        romalrc = romalrc || (info.romalrc ?? '')
        ylyric = ylyric || (info.ylyric ?? '')
      } catch {
        // 网易云也没这首的翻译
      }
    }
  }

  commit(lyric, tlyric, romalrc, ylyric)
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
    state.trialRetried = false
    streamAttempt = 0
    badSources.clear()
    await Promise.all([resolveAndPlay(item), loadLyric(item), loadPic(item)])
  }

  /**
   * 从 start 出发按 step 找下一首「没被标记不喜欢」的歌。
   *
   * 整队列都被屏蔽时返回 -1 —— 调用方必须停下，不能退回去放第一首：
   * 继续放就是放用户明确说过不想听的东西。宁可静音也不要自作聪明。
   */
  function findPlayable(start: number, step: 1 | -1): number {
    const total = state.queue.length
    for (let k = 1; k <= total; k++) {
      const i = (((start + step * k) % total) + total) % total
      const item = state.queue[i]
      if (item && !library.isDisliked(item)) return i
    }
    return -1
  }

  /**
   * 播下一首。
   *
   * auto=true 表示是「一首放完了自动进下一首」，这时要遵守播放模式：
   * 单曲循环重放当前、随机抽一首、顺序播到末尾就停。
   *
   * 无论自动还是手动，都会跳过「不喜欢」的歌 —— 与 lx-music 一致。
   * 从列表里直接点某首歌不受限制：那是用户的明确选择，不该拦。
   */
  async function next(auto = false): Promise<void> {
    if (!state.queue.length) return

    if (auto && state.mode === 'single') {
      const item = state.queue[state.index]
      // 当前这首刚被标记不喜欢：不再重播，按列表往下走
      if (item && !library.isDisliked(item)) {
        // 重取一次流再播：某些 CDN 地址带时效，直接 seek(0) 可能已经过期
        seek(0)
        if (state.url) { state.playing = true; return }
        await play(item)
        return
      }
    }

    if (state.mode === 'shuffle' && state.queue.length > 1) {
      // 先把可播的候选挑出来再随机，而不是「抽到屏蔽的再重抽」——
      // 后者在屏蔽比例高时会连着抽很多次，切歌手感变卡。
      const candidates: number[] = []
      for (let i = 0; i < state.queue.length; i++) {
        if (i === state.index) continue
        const item = state.queue[i]
        if (item && !library.isDisliked(item)) candidates.push(i)
      }
      if (!candidates.length) {
        state.playing = false
        return
      }
      state.index = candidates[Math.floor(Math.random() * candidates.length)]!
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

    const target = findPlayable(state.index, 1)
    if (target < 0) {
      state.playing = false
      return
    }
    state.index = target
    const item = state.queue[state.index]
    if (item) await play(item)
  }

  async function prev(): Promise<void> {
    if (!state.queue.length) return
    const target = findPlayable(state.index, -1)
    if (target < 0) return
    state.index = target
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
    if (item) {
      streamAttempt = 0
      await resolveAndPlay(item)
    }
  }

  return {
    state: readonly(state) as Readonly<PlayerState>,
    current,
    availableSources,
    qualityOrder,
    search, play, next, prev, toggle, seek, setQuality,
    cycleMode, modeLabel, MODE_LABEL,
    toggleLyric, toggleMute,
    /** 流地址失效/加载超时后的自愈（AudioHost 调用，用户无感） */
    recoverStreamError,
    /** 取一条当前可用的流地址（下载用，不触发播放） */
    ensureStreamUrl,
    /** 用户手动「重试」：从头再走一遍取流阶梯 */
    retry: async () => {
      const item = state.playingItem ?? current.value
      if (!item) return
      streamAttempt = 0
      badSources.clear()
      await resolveAndPlay(item, 0)
    },
    /** 组件回灌：<audio> 的进度/时长 */
    reportTime: (t: number) => { state.currentTime = t },
    reportDuration: (d: number) => {
      state.duration = d
      // 拿到真实时长后才可能发现「只给了试听片段」
      if (looksLikeTrialClip(d)) void retryAfterTrialClip()
    },
    setVolume: (v: number) => { state.volume = v },
    setPlaying: (p: boolean) => { state.playing = p },
    setError: (msg: string) => { state.error = msg },
    clearError: () => { state.error = '' },
  }
}
