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
  reserve: (extra: number) => Promise<boolean>
  release: () => Promise<boolean>
  dragStart: () => Promise<{ x: number; y: number; width: number; height: number } | null>
  dragEnd: () => Promise<boolean>
  seek: (time: number) => Promise<boolean>
  onSeekRequest: (cb: (time: number) => void) => () => void
  onData: (cb: (payload: LxmnLyricPayload) => void) => () => void
}

interface Window {
  lxmnNative?: {
    lyric?: LxmnLyricApi
    win?: LxmnWindowControls
    tray?: LxmnTrayApi
    taskbar?: LxmnTaskbarApi
    power?: LxmnPowerApi
    openExternal?: (url: string) => Promise<boolean>
    [key: string]: unknown
  }
}
