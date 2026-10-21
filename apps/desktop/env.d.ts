/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

/** preload.cjs 暴露的原生能力（只声明桌面端实际用到的部分） */
interface LxmnWindowControls {
  minimize: () => Promise<boolean>
  toggleMaximize: () => Promise<boolean>
  close: () => Promise<boolean>
  isMaximized: () => Promise<boolean>
  /** 窗口尺寸预设（7.5）：传 0 表示适配屏幕 */
  setSize: (size: { width: number; height: number }) => Promise<{
    x: number; y: number; width: number; height: number
  } | null>
  hide: () => Promise<boolean>
  onMaximizeChange: (cb: (maximized: boolean) => void) => () => void
}

interface LxmnTrayState {
  playing: boolean
  name: string
  singer: string
  favorite: boolean
}

interface LxmnTrayApi {
  setCloseToTray: (on: boolean) => Promise<boolean>
  setState: (state: LxmnTrayState) => Promise<boolean>
  show: () => Promise<boolean>
  /** 托盘菜单命令：toggle / prev / next / favorite / lyric */
  onCommand: (cb: (cmd: string) => void) => () => void
}

/** 系统集成（6.5 / 6.6 / 6.8） */
interface LxmnProxyApi {
  apply: (cfg: { enabled: boolean; host: string; port: string; username: string; password: string }) => Promise<{ mode: string; rules?: string }>
}

interface LxmnApiServer {
  setEnabled: (cfg: { enabled: boolean; port?: number }) => Promise<{ running: boolean; port?: number; error?: string }>
  reply: (id: number, result: unknown) => Promise<boolean>
  pushState: (state: Record<string, unknown>) => Promise<boolean>
  onCommand: (cb: (payload: unknown) => void) => () => void
}

type LxmnSchemePayload =
  | { kind: 'player'; action: string }
  | { kind: 'search'; keyword: string }
  | { kind: 'searchPlay'; keyword: string }
  | { kind: 'play'; item: { source?: string; songmid?: string; name?: string; singer?: string } }

interface LxmnSchemeApi {
  onLink: (cb: (payload: LxmnSchemePayload) => void) => () => void
}

interface LxmnOpenFileResult {
  canceled?: boolean
  ok?: boolean
  name?: string
  path?: string
  content?: string
  error?: string
}

interface LxmnTaskbarApi {
  /** 0..1 正常进度；-1 清除；2 不确定态 */
  setProgress: (value: number) => Promise<boolean>
}

interface LxmnPowerApi {
  keepAwake: (on: boolean) => Promise<boolean>
}

interface LxmnLyricPayload {
  name?: string
  singer?: string
  lyric?: string
  tlyric?: string
  romalrc?: string
  currentTime?: number
  duration?: number
  playing?: boolean
}

interface LxmnLyricStyle {
  fontSize: number
  playedColor: string
  unplayedColor: string
  fontFamily: string
  stroke: number
  lines: 1 | 2
  /** 3.12 加粗 */
  boldLines: boolean
  boldTranslation: boolean
  /** 3.14 不换行 */
  noWrap: boolean
  /** 3.15 行距倍数 */
  lineHeight: number
  /** 3.16 竖排 */
  vertical: boolean
  /** 3.17 当前行位置 */
  scrollAt: 'top' | 'center'
  /** 3.18 暂停时调淡 */
  dimWhenPaused: boolean
  dimOpacity: number
  /** 3.22 任务栏显示 */
  showInTaskbar: boolean
  /** 3.21 主窗口全屏时隐藏 */
  hideOnFullscreen: boolean
  /** 3.20 频谱可视化 */
  showSpectrum: boolean
}

interface LxmnLyricApi {
  open: (initial?: LxmnLyricPayload) => Promise<boolean>
  close: () => Promise<boolean>
  isOpen: () => Promise<boolean>
  update: (payload: LxmnLyricPayload) => Promise<boolean>
  setClickThrough: (through: boolean) => Promise<boolean>
  isLocked: () => Promise<boolean>
  setLock: (locked: boolean) => Promise<boolean>
  getStyle: () => Promise<LxmnLyricStyle & { locked: boolean }>
  setStyle: (patch: Partial<LxmnLyricStyle>) => Promise<LxmnLyricStyle>
  resetWindow: () => Promise<boolean>
  reserve: (extra: number) => Promise<boolean>
  release: () => Promise<boolean>
  dragStart: () => Promise<{ x: number; y: number; width: number; height: number } | null>
  dragEnd: () => Promise<boolean>
  seek: (time: number) => Promise<boolean>
  onSeekRequest: (cb: (time: number) => void) => () => void
  /** 主窗口推送频谱数据（3.20） */
  pushSpectrum: (bars: number[]) => void
  /** 歌词窗口订阅频谱 */
  onSpectrum: (cb: (bars: number[]) => void) => () => void
  onData: (cb: (payload: LxmnLyricPayload) => void) => () => void
}

interface Window {
  lxmnNative?: {
    lyric?: LxmnLyricApi
    win?: LxmnWindowControls
    tray?: LxmnTrayApi
    proxy?: LxmnProxyApi
    api?: LxmnApiServer
    scheme?: LxmnSchemeApi
    taskbar?: LxmnTaskbarApi
    power?: LxmnPowerApi
    openExternal?: (url: string) => Promise<boolean>
    openFile?: (options?: { title?: string; filters?: { name: string; extensions: string[] }[] }) => Promise<LxmnOpenFileResult>
    saveFile?: (payload: { filename: string; content?: string; url?: string; dir?: string }) => Promise<{ ok?: boolean; canceled?: boolean; path?: string; size?: number; error?: string }>
    [key: string]: unknown
  }
}
