/**
 * 移动端播放器 store。
 *
 * 与桌面端 apps/desktop/src/lib/player.ts 一一对应，差别只在「谁来放声音」：
 *   - 桌面端：组件持有 <audio>，通过 setPlaybackHandler 注入
 *   - 移动端：react-native-track-player（原生 ExoPlayer / AVPlayer），
 *     支持后台播放、通知栏、锁屏控制
 *
 * 两边共用同一个 @lxmn/core：取流、降档回退、歌词解析都在内核里，
 * 所以「哪首能放、放到什么音质」的行为在两端是一致的。
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import TrackPlayer, {
  AppKilledPlaybackBehavior,
  Capability,
  State,
  useProgress,
  usePlaybackState,
  Event,
} from 'react-native-track-player'
import {
  getSource,
  parseLyric,
  findLineIndex,
  resolveWithFallback,
  type LyricLine,
  type MusicItem,
  type Quality,
} from '@lxmn/core'
import { library } from './sync'

/** 播放模式：顺序 / 列表循环 / 单曲循环 / 随机（与桌面端一致） */
export type PlayMode = 'order' | 'loop' | 'single' | 'shuffle'

export interface MobilePlayerState {
  queue: MusicItem[]
  index: number
  playing: boolean
  loading: boolean
  error: string
  quality: Quality
  lyric: string
  tlyric: string
  picUrl: string
  mode: PlayMode
}

let state: MobilePlayerState = {
  queue: [],
  index: -1,
  playing: false,
  loading: false,
  error: '',
  quality: '320k',
  lyric: '',
  tlyric: '',
  picUrl: '',
  mode: 'loop',
}

const listeners = new Set<() => void>()

function emit(): void {
  state = { ...state }
  for (const l of listeners) l()
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

function snapshot(): MobilePlayerState {
  return state
}

export function usePlayerState(): MobilePlayerState {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

export function currentItem(): MusicItem | null {
  return state.queue[state.index] ?? null
}

/** 音质循环顺序（与内核 qualityOrder 一致，从高到低） */
const QUALITY_ORDER: Quality[] = ['master', 'atmos', 'hires', 'flac24bit', 'flac', '320k', '128k']

let ready: Promise<void> | null = null
let nativePlayerReady = false

/** 避免播放器原生异常穿透 onPress，导致未处理的 Promise rejection。 */
function reportPlayerError(action: string, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error)
  state.error = `${action}失败：${detail}`
  state.loading = false
  console.warn(`[Lyco Music] ${action} failed`, error)
  emit()
}

async function safePlayerAction(action: string, task: () => Promise<void>): Promise<void> {
  try {
    await task()
  } catch (error) {
    reportPlayerError(action, error)
  }
}

/**
 * 初始化 TrackPlayer。
 *
 * 只做一次：setupPlayer 在重复调用时会抛 "player already initialized"。
 * 通知栏能力按「有上一首/下一首/进度条」的最小集声明，避免声明了却
 * 没实现的按钮变成死键。
 */
export function setupPlayer(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      if (!nativePlayerReady) {
        await TrackPlayer.setupPlayer({ autoHandleInterruptions: true })
        nativePlayerReady = true
      }
      await TrackPlayer.updateOptions({
        // 从最近任务划掉应用后继续播放（否则系统会连通知一起撤掉）
        android: { appKilledPlaybackBehavior: AppKilledPlaybackBehavior.ContinuePlayback },
        capabilities: [
          Capability.Play,
          Capability.Pause,
          Capability.SkipToNext,
          Capability.SkipToPrevious,
          Capability.SeekTo,
          Capability.Stop,
        ],
        compactCapabilities: [Capability.Play, Capability.Pause, Capability.SkipToNext],
        progressUpdateEventInterval: 1,
      })
    })().catch(error => {
      // 前台服务暂时不可用时允许用户下次点击重新初始化。
      // 已完成原生 setup 的场景不会重复调用 setupPlayer。
      ready = null
      throw error
    })
  }
  return ready
}


/**
 * 确保原生播放器已就绪。
 *
 * TrackPlayer 的每个方法都要求先 setupPlayer()；冷启动时用户如果先点了
 * 播放/暂停/进度条，原生侧会抛异常。RN 的 release 包里未捕获的原生异常
 * 会杀掉进程 —— 这就是「点按钮闪退」的主要来源之一。
 */
async function ensureReady(): Promise<boolean> {
  try {
    await setupPlayer()
    return true
  } catch (error) {
    reportPlayerError('播放器初始化', error)
    return false
  }
}

/**
 * 播放地址统一升级到 https。
 *
 * 网易云给的直链是 `http://m701.music.126.net/...`。Android 从 targetSdk 28
 * 起默认禁止明文流量，ExoPlayer 会直接拒绝这个地址 —— 而它的报错**不会**
 * 冒到 JS 层（我们没监听 PlaybackError 之前），表现就是
 * 「进度条在走、封面在转、一点声音都没有」。
 *
 * 这几个 CDN 实测都支持 https（同一路径换协议返回 200 且是完整音频），
 * 所以直接升级，比在 manifest 里放开明文更干净。
 */
function toSecureUrl(url: string): string {
  return String(url ?? '').replace(/^http:\/\//i, 'https://')
}

/**
 * 取流并播放。
 *
 * 走内核的 resolveWithFallback，而不是直接 getMusicUrl：
 * 搜索里大量网易曲目是 VIP 专享 / 无版权，原源取不到流。
 * 桌面端一直有跨源兜底（去酷狗酷我咪咕找正主），移动端之前漏了，
 * 表现就是「搜得到、点播放就报 VIP 专享」。
 */
async function resolveAndPlay(item: MusicItem): Promise<void> {
  state.loading = true
  state.error = ''
  emit()
  try {
    const { info, item: played } = await resolveWithFallback(item, state.quality)
    // 实际拿到的音质可能与请求的不同（高音质被锁时降档了），如实回填
    state.quality = info.quality
    // 串源时封面也跟着换：原曲封面可能取不到，串到的那个源有
    if (played.picUrl) state.picUrl = played.picUrl
    else if (!state.picUrl && item.picUrl) state.picUrl = item.picUrl

    const url = toSecureUrl(info.url)
    await TrackPlayer.reset()
    await TrackPlayer.add({
      id: String(played.songmid ?? played.id ?? url),
      url,
      title: played.name,
      artist: played.singer,
      album: played.albumName ?? '',
      artwork: toSecureUrl(played.picUrl ?? '') || undefined,
    })
    await TrackPlayer.play()
    state.playing = true
    // 播放记录：只有真的出流了才记，避免把取流失败的歌也算进「最近播放」。
    // 失败不影响播放本身。
    void library.recordPlay(played).catch(() => undefined)
  } catch (e) {
    state.error = e instanceof Error ? e.message : String(e)
    state.playing = false
  } finally {
    state.loading = false
    emit()
  }
}

/** 歌词与封面：失败都不阻断播放 */
async function loadMeta(item: MusicItem): Promise<void> {
  state.lyric = ''
  state.tlyric = ''
  state.picUrl = item.picUrl ?? ''
  try {
    const info = await getSource(item.source).getLyric(item)
    state.lyric = info.lyric ?? ''
    state.tlyric = info.tlyric ?? ''
  } catch {
    // 没有歌词也应该能听
  }
  emit()
}

export async function play(item: MusicItem, queue?: MusicItem[]): Promise<void> {
  try {
    await setupPlayer()
  } catch (error) {
    reportPlayerError('播放器初始化', error)
    return
  }
  if (queue?.length) {
    state.queue = queue
    const at = queue.findIndex(x => x.songmid === item.songmid && x.source === item.source)
    state.index = at >= 0 ? at : 0
    if (at < 0) state.queue = [item, ...queue]
  } else {
    const at = state.queue.findIndex(x => x.songmid === item.songmid && x.source === item.source)
    if (at >= 0) state.index = at
    else { state.queue = [...state.queue, item]; state.index = state.queue.length - 1 }
  }
  emit()
  await Promise.all([resolveAndPlay(item), loadMeta(item)])
}

/**
 * 下一首。
 *
 * auto=true 表示「一首放完了自动进下一首」，这时要遵守播放模式：
 * 单曲循环重放当前、随机抽一首、顺序播到末尾就停。
 */
/**
 * 从 start 出发按 step 找下一首「没被标记不喜欢」的歌。
 * 整队列都被屏蔽时返回 -1 —— 调用方停下，不要退回去放第一首。
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
 * 下一首。
 *
 * auto=true 表示「一首放完了自动进下一首」，这时要遵守播放模式：
 * 单曲循环重放当前、随机抽一首、顺序播到末尾就停。
 *
 * 无论自动还是手动，都跳过「不喜欢」的歌 —— 与 lx-music 一致。
 * 从列表里直接点某首不受限制：那是用户的明确选择。
 */
export async function next(auto = false): Promise<void> {
  if (!state.queue.length) return

  if (auto && state.mode === 'single') {
    const current = state.queue[state.index]
    // 当前这首刚被标记不喜欢：不再重播，按列表往下走
    if (current && !library.isDisliked(current)) {
      await seek(0)
      await safePlayerAction('单曲循环', async () => { await TrackPlayer.play() })
      return
    }
  }

  if (state.mode === 'shuffle' && state.queue.length > 1) {
    // 先挑出可播候选再随机：屏蔽比例高时「抽到就重抽」会连抽很多次
    const candidates: number[] = []
    for (let i = 0; i < state.queue.length; i++) {
      if (i === state.index) continue
      const item = state.queue[i]
      if (item && !library.isDisliked(item)) candidates.push(i)
    }
    if (!candidates.length) return
    state.index = candidates[Math.floor(Math.random() * candidates.length)]!
    const picked = state.queue[state.index]
    if (picked) await play(picked)
    return
  }

  if (auto && state.mode === 'order' && state.index >= state.queue.length - 1) return

  const target = findPlayable(state.index, 1)
  if (target < 0) return
  state.index = target
  const item = state.queue[state.index]
  if (item) await play(item)
}

/* ---------------- 播放模式 ---------------- */

const MODE_ORDER: PlayMode[] = ['order', 'loop', 'single', 'shuffle']
const MODE_LABEL: Record<PlayMode, string> = {
  order: '顺序播放',
  loop: '列表循环',
  single: '单曲循环',
  shuffle: '随机播放',
}

export function cycleMode(): PlayMode {
  const at = MODE_ORDER.indexOf(state.mode)
  state.mode = MODE_ORDER[(at + 1) % MODE_ORDER.length] ?? 'loop'
  emit()
  return state.mode
}

export function modeLabel(): string {
  return MODE_LABEL[state.mode]
}

/** 当前播放模式（给测试与非 React 场景用） */
export function getMode(): PlayMode {
  return state.mode
}

export async function prev(): Promise<void> {
  if (!state.queue.length) return
  const target = findPlayable(state.index, -1)
  if (target < 0) return
  state.index = target
  const item = state.queue[state.index]
  if (item) await play(item)
}

export async function toggle(): Promise<void> {
  if (!currentItem()) return
  await safePlayerAction('播放控制', async () => {
    const s = await TrackPlayer.getPlaybackState()
    if (s.state === State.Playing) await TrackPlayer.pause()
    else await TrackPlayer.play()
  })
}

export async function seek(seconds: number): Promise<void> {
  if (!currentItem()) return
  await safePlayerAction('进度跳转', async () => {
    await TrackPlayer.seekTo(Math.max(0, seconds))
  })
}

/** 换音质后用新音质重取当前曲目 */
export async function setQuality(q: Quality): Promise<void> {
  state.quality = q
  emit()
  const item = currentItem()
  if (item) await resolveAndPlay(item)
}

export function cycleQuality(): void {
  const at = QUALITY_ORDER.indexOf(state.quality)
  const nextQ = QUALITY_ORDER[(at + 1) % QUALITY_ORDER.length]
  if (nextQ) void setQuality(nextQ)
}

/**
 * 进度与播放状态。
 *
 * 用 RNTP 的 hooks 而不是自己轮询：hooks 内部订阅原生事件，
 * 比 setInterval 更省电，也不会在后台被系统节流。
 */
export function useProgressState() {
  const progress = useProgress(0.5)
  const playback = usePlaybackState()
  return {
    position: progress.position,
    duration: progress.duration,
    playing: playback.state === State.Playing || playback.state === State.Buffering,
  }
}

/**
 * 解析歌词并跟随进度高亮。
 *
 * 返回的行数做上限保护：个别音源的 LRC 会带上几千行纯空行，
 * 全部渲染会让 FlatList 卡住。
 */
export function useLyricLines(limit = 400): { lines: LyricLine[]; activeIndex: number } {
  const st = usePlayerState()
  const { position } = useProgressState()
  const parsed = parseLyric(st.lyric, st.tlyric)
  const lines = parsed.lines.slice(0, limit)
  return { lines, activeIndex: findLineIndex(lines, position) }
}

/** 全局事件：原生侧切歌（通知栏 / 耳机）时同步 JS 状态 */
export function useTrackPlayerEvents(): void {
  const [n, setN] = useState(0)
  useEffect(() => {
    const subs = [
      TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, () => setN(x => x + 1)),
      TrackPlayer.addEventListener(Event.PlaybackState, e => {
        // 原生侧的真实状态要同步回 JS：暂停、被其他 App 抢焦点、
        // 缓冲中都要反映到按钮和进度上，不能只认我们手动设的 playing。
        const playing = e.state === State.Playing
        if (state.playing !== playing) {
          state.playing = playing
          emit()
        }
        setN(x => x + 1)
      }),
      /**
       * 播放失败必须让用户看见。
       *
       * 之前没监听这个事件：ExoPlayer 拒掉地址（明文 / 404 / 解码失败）后
       * 什么都不做，JS 侧还停在 playing=true ——
       * 界面上「正在播放」，实际一点声音都没有，用户只能猜。
       */
      TrackPlayer.addEventListener(Event.PlaybackError, e => {
        state.playing = false
        state.loading = false
        state.error = describePlaybackError(e)
        emit()
      }),
      // 播完自动下一首：走 next(true)，由播放模式决定是重放还是换歌
      TrackPlayer.addEventListener(Event.PlaybackQueueEnded, () => { void next(true) }),
      // 单曲结束时 RNTP 触发的是 PlaybackActiveTrackChanged/State，不再额外处理
    ]
    return () => { for (const s of subs) s.remove() }
  }, [])
  useEffect(() => { if (n) emit() }, [n])
}

/** 把 ExoPlayer 的错误码翻译成能行动的中文 */
function describePlaybackError(e: { code?: string; message?: string }): string {
  const raw = String(e?.message ?? '')
  const code = String(e?.code ?? '')
  if (/cleartext|Cleartext/i.test(raw)) return '播放地址被系统拦截（明文 http），请更新到最新版本'
  if (/SSL|Certificate|handshake/i.test(raw)) return '音频服务器证书校验失败，换一首试试'
  if (/404|Not Found/i.test(raw)) return '音频地址已失效（这类直链有时效），重新点一次播放'
  if (/403|Forbidden/i.test(raw)) return '音源拒绝了这个播放地址，换一首或换音源试试'
  if (/timeout|timed out/i.test(raw)) return '连接音频服务器超时，检查网络后重试'
  if (/Decoder|codec|Unsupported/i.test(raw)) return '这台设备解不了这个音频格式'
  if (raw) return '播放失败：' + raw.slice(0, 120)
  return code ? '播放失败（' + code + '）' : '播放失败，换一首试试'
}
