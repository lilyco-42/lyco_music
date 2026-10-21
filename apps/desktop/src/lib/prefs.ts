/**
 * 桌面端本机偏好。
 *
 * 为什么和内核的 SyncSettings 分家：这里的每一项都跟「这台机器」绑死 ——
 * 窗口尺寸、输出设备、托盘行为、代理端口、快捷键。把它们同步到另一台设备上，
 * 用户看到的是「我明明没动过，怎么变了」。
 *
 * 需要跨设备的（添加歌曲位置、歌词字号）留在 SyncSettings 里走云同步。
 *
 * 读写策略：整份 JSON 存一个 localStorage key。字段多了以后逐 key 存
 * 会出现「一半新一半旧」的中间态，读出来更难排查；整份存 + 缺字段补默认，
 * 升级加字段时老数据自然被填上默认值。
 */
import { reactive, watch } from 'vue'

const KEY = 'lxmn.prefs.desktop'

/** 播放栏进度条样式（PARITY 7.6） */
export type ProgressStyle = 'line' | 'thick' | 'dot'

export interface DesktopPrefs {
  /* ---- 系统集成 ---- */
  /** 点关闭按钮时最小化到托盘而不是退出（6.4） */
  closeToTray: boolean
  /** 启动时隐藏窗口，只留托盘（6.7 的 -hidden 等价物） */
  startHidden: boolean
  /** 播放时在任务栏显示进度（2.11） */
  taskbarProgress: boolean
  /** 播放时阻止系统休眠（2.10） */
  preventSleep: boolean
  /** 启动后静默检查更新（6.9） */
  autoCheckUpdate: boolean
  /** 升级后第一次启动时弹一次更新日志（6.10） */
  showChangelogAfterUpdate: boolean

  /* ---- 播放 ---- */
  /** 启动后自动接着播上次的队列（2.12） */
  autoPlayOnStart: boolean
  /** 记住每首歌的播放进度（2.8） */
  rememberProgress: boolean
  /** 音频输出设备 deviceId，空串 = 系统默认（2.5） */
  outputDevice: string
  /** 按设备能处理的最大声道数输出（2.6） */
  maxOutputChannels: boolean

  /* ---- 列表 ---- */
  /** 列表内随机乱序（4.6）：每次点都换一个种子 */
  shuffleSeed: number

  /* ---- 外观 ---- */
  /** 界面字体缩放（7.3），1 = 原始 */
  fontScale: number
  /** 播放栏进度条样式（7.6） */
  progressStyle: ProgressStyle
  /** 窗口尺寸预设 id（7.5） */
  windowPreset: string
  /** 软件内置圆角与阴影（7.7），改完需要重启 */
  roundedWindow: boolean

  /* ---- 歌词 ---- */
  /** 繁体转简体（3.4） */
  lyricS2T: boolean
  /** 全局歌词偏移，秒（3.5）。正数 = 歌词整体延后 */
  lyricOffset: number
  /** 播放详情页歌词字号（3.6） */
  playLyricFontSize: number
  /** 歌词延迟滚动毫秒，0 = 关闭（3.8） */
  lyricScrollDelay: number
  /** 允许拖拽歌词行调整进度（3.7） */
  lyricSeekByDrag: boolean

  /* ---- 下载 ---- */
  /** 原源下载失败时自动换源（1.6） */
  autoSwitchOnDownloadFail: boolean

  /* ---- 网络 / 开放接口 ---- */
  proxy: ProxyPrefs
  api: ApiPrefs

  /* ---- 快捷键（6.2）：action -> 组合键 ---- */
  shortcuts: Record<string, string>
}

export interface ProxyPrefs {
  enabled: boolean
  host: string
  port: string
  username: string
  password: string
}

export interface ApiPrefs {
  enabled: boolean
  port: number
  /** 上次启动失败的原因（端口被占用等），界面上要看得见 */
  lastError?: string
}

export const FONT_SCALES = [
  { id: 0.9, label: '小' },
  { id: 1, label: '标准' },
  { id: 1.08, label: '稍大' },
  { id: 1.16, label: '大' },
  { id: 1.25, label: '更大' },
  { id: 1.35, label: '最大' },
] as const

export const WINDOW_PRESETS = [
  { id: 'mini', label: '迷你', width: 1000, height: 670 },
  { id: 'standard', label: '标准', width: 1280, height: 820 },
  { id: 'wide', label: '宽屏', width: 1440, height: 900 },
  { id: 'large', label: '大屏', width: 1600, height: 1000 },
  { id: 'fhd', label: '全高清', width: 1920, height: 1080 },
  { id: 'auto', label: '适配屏幕', width: 0, height: 0 },
] as const

export const DEFAULT_SHORTCUTS: Record<string, string> = {
  'play-pause': 'Space',
  'prev': 'Ctrl+ArrowLeft',
  'next': 'Ctrl+ArrowRight',
  'seek-back': 'ArrowLeft',
  'seek-forward': 'ArrowRight',
  'mute': 'KeyM',
  'lyric': 'KeyL',
  'search': 'Ctrl+KeyK',
  'volume-up': 'Ctrl+ArrowUp',
  'volume-down': 'Ctrl+ArrowDown',
  'favorite': 'KeyF',
}

function defaults(): DesktopPrefs {
  return {
    closeToTray: false,
    startHidden: false,
    taskbarProgress: true,
    preventSleep: true,
    autoCheckUpdate: true,
    showChangelogAfterUpdate: true,
    autoPlayOnStart: false,
    rememberProgress: true,
    outputDevice: '',
    maxOutputChannels: false,
    shuffleSeed: 0,
    fontScale: 1,
    progressStyle: 'line',
    windowPreset: 'standard',
    roundedWindow: false,
    lyricS2T: false,
    lyricOffset: 0,
    playLyricFontSize: 16,
    lyricScrollDelay: 0,
    lyricSeekByDrag: true,
    autoSwitchOnDownloadFail: true,
    proxy: { enabled: false, host: '', port: '', username: '', password: '' },
    api: { enabled: false, port: 23330 },
    shortcuts: { ...DEFAULT_SHORTCUTS },
  }
}

/**
 * 合并读到的值。
 *
 * 逐个字段校验而不是直接 Object.assign：localStorage 是用户能改的，
 * 也可能是旧版本写的。一个 fontScale: "abc" 传进 CSS 会让整页字号消失，
 * 而界面上看不出任何报错。
 */
function merge(raw: unknown): DesktopPrefs {
  const base = defaults()
  if (!raw || typeof raw !== 'object') return base
  const src = raw as Record<string, unknown>
  const bool = (v: unknown, fb: boolean): boolean => (typeof v === 'boolean' ? v : fb)
  const num = (v: unknown, fb: number, min: number, max: number): number => {
    const n = Number(v)
    if (!Number.isFinite(n)) return fb
    return Math.min(max, Math.max(min, n))
  }
  const str = (v: unknown, fb: string): string => (typeof v === 'string' ? v : fb)

  const proxy = (src.proxy && typeof src.proxy === 'object' ? src.proxy : {}) as Record<string, unknown>
  const api = (src.api && typeof src.api === 'object' ? src.api : {}) as Record<string, unknown>
  const sc = (src.shortcuts && typeof src.shortcuts === 'object' ? src.shortcuts : {}) as Record<string, unknown>

  const shortcuts: Record<string, string> = { ...base.shortcuts }
  for (const k of Object.keys(base.shortcuts)) {
    const v = sc[k]
    // 空串是合法的「这个功能不绑键」
    if (typeof v === 'string') shortcuts[k] = v
  }

  const style = src.progressStyle
  return {
    closeToTray: bool(src.closeToTray, base.closeToTray),
    startHidden: bool(src.startHidden, base.startHidden),
    taskbarProgress: bool(src.taskbarProgress, base.taskbarProgress),
    preventSleep: bool(src.preventSleep, base.preventSleep),
    autoCheckUpdate: bool(src.autoCheckUpdate, base.autoCheckUpdate),
    showChangelogAfterUpdate: bool(src.showChangelogAfterUpdate, base.showChangelogAfterUpdate),
    autoPlayOnStart: bool(src.autoPlayOnStart, base.autoPlayOnStart),
    rememberProgress: bool(src.rememberProgress, base.rememberProgress),
    outputDevice: str(src.outputDevice, base.outputDevice),
    maxOutputChannels: bool(src.maxOutputChannels, base.maxOutputChannels),
    shuffleSeed: num(src.shuffleSeed, 0, 0, Number.MAX_SAFE_INTEGER),
    fontScale: num(src.fontScale, base.fontScale, 0.75, 1.6),
    progressStyle: style === 'thick' || style === 'dot' ? style : 'line',
    windowPreset: str(src.windowPreset, base.windowPreset),
    roundedWindow: bool(src.roundedWindow, base.roundedWindow),
    lyricS2T: bool(src.lyricS2T, base.lyricS2T),
    lyricOffset: num(src.lyricOffset, 0, -10, 10),
    playLyricFontSize: num(src.playLyricFontSize, base.playLyricFontSize, 12, 32),
    lyricScrollDelay: num(src.lyricScrollDelay, 0, 0, 3000),
    lyricSeekByDrag: bool(src.lyricSeekByDrag, base.lyricSeekByDrag),
    autoSwitchOnDownloadFail: bool(src.autoSwitchOnDownloadFail, base.autoSwitchOnDownloadFail),
    proxy: {
      enabled: bool(proxy.enabled, false),
      host: str(proxy.host, ''),
      port: str(proxy.port, ''),
      username: str(proxy.username, ''),
      password: str(proxy.password, ''),
    },
    api: {
      enabled: bool(api.enabled, false),
      port: num(api.port, 23330, 1024, 65535),
    },
    shortcuts,
  }
}

function read(): DesktopPrefs {
  try {
    return merge(JSON.parse(localStorage.getItem(KEY) || 'null'))
  } catch {
    return defaults()
  }
}

export const prefs = reactive<DesktopPrefs>(read())

let saveTimer: ReturnType<typeof setTimeout> | null = null

/** 立即落盘（关窗前/切页时用） */
export function savePrefsNow(): void {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  try { localStorage.setItem(KEY, JSON.stringify(prefs)) } catch { /* 隐私模式写不进去 */ }
}

watch(prefs, () => {
  // 输入框类的改动会连续触发，攒 200ms 再写，避免每敲一个字符写一次 localStorage
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(savePrefsNow, 200)
}, { deep: true })

/** 恢复默认（设置页「恢复默认」按钮） */
export function resetPrefs(): void {
  Object.assign(prefs, defaults())
  savePrefsNow()
}

export function usePrefs() {
  return {
    prefs,
    defaults,
    reset: resetPrefs,
    saveNow: savePrefsNow,
    FONT_SCALES,
    WINDOW_PRESETS,
    DEFAULT_SHORTCUTS,
  }
}
