/**
 * 桌面歌词 / 播放页歌词的样式与滚动规则。
 *
 * 为什么单独抽出来：这些规则（描边怎么画、字号怎么夹、居中还是逐行怎么算偏移）
 * 是纯函数，抽出来才能写单测 —— 歌词窗口是独立的 Electron 窗口，
 * 在 jsdom 里根本跑不起来，而这几条恰恰是最容易算错的地方。
 */

/** 桌面歌词可调的字号范围（与 lx-music 的 10~80 对齐，留一点边距） */
export const LYRIC_FONT_MIN = 18
export const LYRIC_FONT_MAX = 72

/** 描边档位：0 只有阴影，1~3 是 1/2/3px 的黑色描边 */
export const LYRIC_STROKES = [
  { level: 0, name: '无' },
  { level: 1, name: '细' },
  { level: 2, name: '中' },
  { level: 3, name: '粗' },
] as const

/** 字体预设。用 CSS font stack 而不是让用户填字体名：填错就是「没生效但没报错」 */
export const LYRIC_FONTS = [
  { id: 'default', name: '默认', stack: '' },
  { id: 'yahei', name: '雅黑', stack: '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif' },
  { id: 'kai', name: '楷体', stack: 'KaiTi, "Kaiti SC", STKaiti, "Noto Serif SC", serif' },
  { id: 'round', name: '圆体', stack: '"YouYuan", "Yuanti SC", "Microsoft YaHei", sans-serif' },
  { id: 'mono', name: '等宽', stack: 'ui-monospace, Consolas, "Cascadia Mono", monospace' },
] as const

/** 歌词配色。前 8 个是 lx-music 的默认盘，最后一个沿用本项目原来的绿色 */
export const LYRIC_COLORS = [
  '#ffffff',
  '#ffec90',
  '#90ffce',
  '#20ff84',
  '#39cbff',
  '#d939ff',
  '#ff3947',
  '#4ade80',
] as const

export interface LyricStyle {
  fontSize: number
  /** 正在唱的那一行 */
  playedColor: string
  /** 下一行 / 未唱 */
  unplayedColor: string
  /** CSS font stack，'' 表示跟随系统 */
  fontFamily: string
  /** 描边档位 0~3 */
  stroke: number
  /** 单行 / 双行 */
  lines: 1 | 2
}

export const DEFAULT_LYRIC_STYLE: LyricStyle = {
  fontSize: 34,
  // 默认沿用 0.2.16 的观感：两行同色、下一行靠透明度区分
  playedColor: '#4ade80',
  unplayedColor: '#4ade80',
  fontFamily: '',
  stroke: 1,
  lines: 2,
}

const HEX = /^#[0-9a-f]{6}$/i

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

function pickColor(v: unknown, fallback: string): string {
  return typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : fallback
}

/**
 * 把「落盘里读到的东西」或「渲染层传来的 patch」归一化。
 *
 * 为什么要归一化：这些值会直接写进 style，外部数据一旦是 NaN / 空串 /
 * 非法颜色，表现是「歌词突然消失或变成透明」，排查起来极其费时。
 * 所有入口（读盘、IPC、默认值）都过这一个函数。
 */
export function normalizeLyricStyle(raw: unknown, base: LyricStyle = DEFAULT_LYRIC_STYLE): LyricStyle {
  const src = (raw ?? {}) as Partial<Record<keyof LyricStyle | 'color', unknown>>
  const stack = typeof src.fontFamily === 'string' ? src.fontFamily : ''
  const knownFont = LYRIC_FONTS.some(f => f.stack === stack)
  return {
    fontSize: clampInt(src.fontSize, LYRIC_FONT_MIN, LYRIC_FONT_MAX, base.fontSize),
    // 旧版本只有一个 color 字段，两个色都继承它，避免升级后突然变白
    playedColor: pickColor(src.playedColor ?? src.color, base.playedColor),
    unplayedColor: pickColor(src.unplayedColor ?? src.color, base.unplayedColor),
    fontFamily: knownFont ? stack : base.fontFamily,
    stroke: clampInt(src.stroke, 0, 3, base.stroke),
    lines: Number(src.lines) === 1 ? 1 : Number(src.lines) === 2 ? 2 : base.lines,
  }
}

/**
 * 描边的画法。
 *
 * 一开始用 text-shadow 在 8 个方向叠黑色影子，字号一大就露馅：
 * 8 个方向之间是空的，边缘出现一圈「锯齿/毛刺」，而且加粗档位越明显。
 * 现在改成 `-webkit-text-stroke` + `paint-order: stroke fill`：
 * Chromium 会先画描边再画字形填充，边缘是连续的曲线，没有毛刺。
 *
 * 注意 text-stroke 是**居中**描边（一半压在字形里面），
 * 所以宽度取 2 倍，靠 paint-order 让填充盖住内侧，最终得到 s px 的外描边。
 */
export interface LyricTextPaint {
  textShadow: string
  webkitTextStroke?: string
  paintOrder?: string
}

const SOFT_SHADOW = '0 2px 10px rgba(0,0,0,.85)'

export function strokePaint(level: number): LyricTextPaint {
  const s = clampInt(level, 0, 3, 0)
  if (s === 0) return { textShadow: SOFT_SHADOW }
  return {
    textShadow: SOFT_SHADOW,
    webkitTextStroke: `${s * 2}px rgba(0,0,0,.9)`,
    paintOrder: 'stroke fill',
  }
}

/** 播放页歌词的滚动方式 */
export type LyricScrollMode = 'center' | 'line'

/** 逐行模式：当前行距顶部留一点空白，读起来不会贴边 */
export const LYRIC_LINE_PIN = 8

/**
 * 当前行应该滚到哪儿（相对当前 scrollTop 的增量）。
 *
 * - center：当前行停在可视区正中（原来的行为）
 * - line：当前行钉在顶部往下 8px，一行一行往下推 —— 长歌词不会每句都「跳一下」
 */
export function lyricScrollDelta(
  mode: LyricScrollMode,
  m: { boxHeight: number; lineTop: number; lineHeight: number },
): number {
  if (mode === 'line') return m.lineTop - LYRIC_LINE_PIN
  return m.lineTop - m.boxHeight / 2 + m.lineHeight / 2
}
