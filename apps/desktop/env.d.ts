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

interface Window {
  lxmnNative?: {
    win?: LxmnWindowControls
    openExternal?: (url: string) => Promise<boolean>
    [key: string]: unknown
  }
}
