import { useSafeAreaInsets } from 'react-native-safe-area-context'

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
 * 顶部安全区高度（dp），供**主窗口**里的页面使用。
 *
 * **不要用 `StatusBar.currentHeight`。** 它是 `StatusBar.js` 里的静态类字段：
 *
 * ```js
 * static currentHeight = NativeStatusBarManagerAndroid.getConstants().HEIGHT
 * ```
 *
 * 也就是模块首次求值时把原生常量拷一份**冻住**。而那个原生模块在 ReactHost
 * 启动阶段就构造好了，此时 Activity 的窗口往往还没布局完成，`HEIGHT` 就是 0。
 *
 * 关键点：**它是个竞态，不是稳定复现的 bug。** 同一个 APK 反复冷启动，
 * 有时读到 48.76、有时读到 0 —— 所以「改成函数、渲染期重读」这种修法是无效的
 * （读到的还是同一个冻结值），必须换数据源。
 *
 * 实测（模拟器 1080×2400 / API 36 / 420dpi）：
 * - `StatusBar.currentHeight` 在启动竞态下为 0；
 * - `NativeModules.StatusBarManager.getConstants().HEIGHT` 同源，同样为 0，
 *   且在原生模块构造期就缓存了，轮询也没用；
 * - `Dimensions.screen.height - window.height` = 72，是「状态栏 48.76 + 手势条
 *   23.24」的和，拆不开，也不能用。
 *
 * 只有视图层级（WindowInsets）是可靠的，由 SafeAreaProvider 提供。
 *
 * **注意这个值在主窗口里通常是 0**：Android 系统本来就会把窗口让到状态栏下面，
 * 再自己加 padding 就是双重缩进（实测标题被顶低 128px）。播放页那个
 * `statusBarTranslucent` 的全屏 Modal 才是真正 edge-to-edge 的窗口，它在
 * 自己的 SafeAreaProvider 里取 inset（见 PlayerScreen）。
 */
export function useTopInset(): number {
  return useSafeAreaInsets().top
}

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
