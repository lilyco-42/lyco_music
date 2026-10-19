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
  onMaximizeChange: (cb: (maximized: boolean) => void) => () => void
}

interface LxmnLyricPayload {
  name?: string
  singer?: string
  lyric?: string
  tlyric?: string
  currentTime?: number
  playing?: boolean
}

interface LxmnLyricApi {
  open: (initial?: LxmnLyricPayload) => Promise<boolean>
  close: () => Promise<boolean>
  isOpen: () => Promise<boolean>
  update: (payload: LxmnLyricPayload) => Promise<boolean>
  setClickThrough: (through: boolean) => Promise<boolean>
  getStyle: () => Promise<{ fontSize: number; color: string; locked: boolean }>
  setStyle: (patch: Record<string, unknown>) => Promise<boolean>
  onData: (cb: (payload: LxmnLyricPayload) => void) => () => void
}

interface Window {
  lxmnNative?: {
    lyric?: LxmnLyricApi
    win?: LxmnWindowControls
    openExternal?: (url: string) => Promise<boolean>
    [key: string]: unknown
  }
}
