import { Platform, StatusBar } from 'react-native'

/** 与桌面端 DESIGN.md 实测色值一致（accent 可被主题覆盖，见文件末尾） */
export const colors = {
  bg: '#101010',
  surface: '#202020',
  elevated: '#303030',
  bottombar: '#1d1d1d',
  accent: '#E83A45',
  fg: '#f0f0f0',
  muted: '#9a9a9a',
  fainter: '#6b6b6b',
  divider: '#2a2a2a',
} as const

export type ThemeColor = keyof typeof colors

/**
 * 顶部安全区高度。
 * 用 StatusBar.currentHeight 代替 react-native-safe-area-context，
 * 少一个原生依赖。
 */
export const topInset = Platform.OS === 'android' ? StatusBar.currentHeight ?? 24 : 44

/** 底部标签栏高度 */
export const TAB_BAR_HEIGHT = 56

/* ---------------- 主题强调色 ---------------- */

/**
 * 主题色。
 *
 * 和桌面端同一套预设（桌面端改 CSS 变量，这里改 colors.accent）。
 * RN 没有 CSS 变量，所以做法是「改对象 + 通知订阅者重渲染」：
 * 根组件订阅后整棵树重算样式，所有用到 colors.accent 的地方自动跟着变。
 */
export interface AccentPreset { id: string; name: string; color: string }

export const ACCENT_PRESETS: AccentPreset[] = [
  { id: 'netease', name: '网易红', color: '#E83A45' },
  { id: 'teal', name: '清青', color: '#12A594' },
  { id: 'blue', name: '静谧蓝', color: '#3F7FE0' },
  { id: 'violet', name: '暮紫', color: '#7B5BD6' },
  { id: 'orange', name: '暖橙', color: '#E07A2F' },
  { id: 'pink', name: '樱粉', color: '#E0559B' },
]

const accentListeners = new Set<() => void>()
let currentAccent = ACCENT_PRESETS[0]!.color

export function getAccent(): string {
  return currentAccent
}

/** 切换强调色（组件不需要自己存状态，订阅即可） */
export function setAccent(hex: string): void {
  currentAccent = hex
  ;(colors as { accent: string }).accent = hex
  for (const l of accentListeners) l()
}

/** 订阅强调色变化；返回值给根组件强制重渲染用 */
export function subscribeAccent(fn: () => void): () => void {
  accentListeners.add(fn)
  return () => { accentListeners.delete(fn) }
}
