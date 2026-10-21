/**
 * 主题色（参考网易云 / betterNCM 的皮肤思路）。
 *
 * 为什么要做：界面里 accent 色之前是硬编码在 CSS 变量里的单一红色，
 * 想换配色只能改样式文件。betterNCM 这类插件生态最受欢迎的功能之一就是主题，
 * 做法也很简单 —— 把颜色收成变量，运行时改这几个变量即可。
 *
 * 这里只覆盖「强调色」相关变量（红/青/蓝/紫/橙/粉），不动结构色，
 * 所以任何配色下对比度都是可以预期的。
 */
import { computed, ref } from 'vue'

export interface ThemePreset {
  id: string
  name: string
  /** 主强调色（导航选中、强调文字、播放按钮） */
  accent: string
  /** 进度条 / 次级强调（比主色浅一点） */
  progress: string
}

export const THEME_PRESETS: ThemePreset[] = [
  { id: 'netease', name: '网易红', accent: '#d43b52', progress: '#de7085' },
  { id: 'teal', name: '清青', accent: '#12a594', progress: '#5cc4b6' },
  { id: 'blue', name: '静谧蓝', accent: '#3f7fe0', progress: '#7ba6ea' },
  { id: 'violet', name: '暮紫', accent: '#7b5bd6', progress: '#a48ce6' },
  { id: 'orange', name: '暖橙', accent: '#e07a2f', progress: '#efa166' },
  { id: 'pink', name: '樱粉', accent: '#e0559b', progress: '#ef8fbe' },
]

const STORAGE_KEY = 'lxmn.theme.accent'
const CUSTOM_KEY = 'lxmn.theme.custom'

/**
 * 自定义主题（7.2）。
 *
 * 只让用户改**强调色**：结构色（背景/文字/分割线）跟着改会立刻出现
 * 对比度问题，而 lx 那种「完整色板编辑器」实际上要求用户有配色能力。
 * 这里从主色自动推导进度条色（混白 32%），保证任何主色下都有层次。
 */
export interface CustomTheme {
  accent: string
  progress: string
}

/** 校验 #rgb / #rrggbb */
export function normalizeHex(input: string): string {
  const raw = String(input || '').trim()
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw)
  if (!m) return ''
  const hex = m[1]!.toLowerCase()
  if (hex.length === 3) return '#' + hex.split('').map(c => c + c).join('')
  return '#' + hex
}

/** 与白色混合，得到同色系的浅色（进度条/次级强调） */
export function lighten(hex: string, amount = 0.32): string {
  const h = normalizeHex(hex)
  if (!h) return hex
  const n = parseInt(h.slice(1), 16)
  const mix = (c: number) => Math.round(c + (255 - c) * amount)
  const r = mix((n >> 16) & 0xff)
  const g = mix((n >> 8) & 0xff)
  const b = mix(n & 0xff)
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('')
}

function readCustom(): CustomTheme | null {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as Partial<CustomTheme>
    const accent = normalizeHex(String(p.accent ?? ''))
    if (!accent) return null
    return { accent, progress: normalizeHex(String(p.progress ?? '')) || lighten(accent) }
  } catch {
    return null
  }
}

const custom = ref<CustomTheme | null>(readCustom())

/** 当前主题 id（从本地存储恢复，默认网易红） */
const currentId = ref<string>(readInitial())

function readInitial(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'custom' && custom.value) return 'custom'
    if (saved && THEME_PRESETS.some(p => p.id === saved)) return saved
  } catch {
    // 隐私模式 / 存储被禁用时按默认走
  }
  return THEME_PRESETS[0]!.id
}

const current = computed<ThemePreset>(() => {
  if (currentId.value === 'custom' && custom.value) {
    return { id: 'custom', name: '自定义', accent: custom.value.accent, progress: custom.value.progress }
  }
  return THEME_PRESETS.find(p => p.id === currentId.value) ?? THEME_PRESETS[0]!
})

/** 把颜色写到根节点：所有 bg-ncm-accent / text-ncm-accent 自动跟着变 */
function applyPreset(preset: ThemePreset): void {
  const root = document.documentElement
  root.style.setProperty('--color-ncm-accent', preset.accent)
  root.style.setProperty('--color-ncm-accent-nav', preset.accent)
  root.style.setProperty('--color-ncm-accent-play', preset.accent)
  root.style.setProperty('--color-ncm-progress', preset.progress)
  // 深色播放页的强调色同步，避免「主界面换了、播放页还是红的」
  root.style.setProperty('--color-ncmd-accent', preset.accent)
  root.dataset.theme = preset.id
}

/* ---------------- 皮肤（结构层，不只是强调色） ---------------- */

/**
 * 皮肤和「主题色」是两件事：
 *   - 主题色只换强调色（accent / progress），结构色不动；
 *   - 皮肤换的是**材质**：面板是否半透明、有没有毛玻璃、背景是不是渐变。
 *
 * 目前两套：
 *   classic —— 原版实色面板；
 *   glass   —— Apple Liquid Glass 风格：半透明 + 背景模糊 + 边缘高光。
 *              参数照 Liquid Glass 的三条原则来：模糊要够（24px+）、
 *              边缘要有 1px 高光、玻璃下面不能是不透明色块（否则等于没用）。
 */
export type SkinId = 'classic' | 'glass'

export const SKINS: Array<{ id: SkinId; name: string }> = [
  { id: 'classic', name: '经典' },
  { id: 'glass', name: '液态玻璃' },
]

const SKIN_KEY = 'lxmn.theme.skin'
const skinId = ref<SkinId>(readSkin())

function readSkin(): SkinId {
  try {
    return localStorage.getItem(SKIN_KEY) === 'glass' ? 'glass' : 'classic'
  } catch {
    return 'classic'
  }
}

function applySkin(id: SkinId): void {
  document.documentElement.dataset.skin = id
}

export function useTheme() {
  function setTheme(id: string): void {
    // 菜单里皮肤项用 skin: 前缀，避免和颜色预设撞 id
    if (id.startsWith('skin:')) {
      const next = id.slice(5) === 'glass' ? 'glass' : 'classic'
      skinId.value = next
      applySkin(next)
      try { localStorage.setItem(SKIN_KEY, next) } catch { /* 忽略 */ }
      return
    }
    const preset = THEME_PRESETS.find(p => p.id === id)
    if (!preset) return
    currentId.value = preset.id
    applyPreset(preset)
    try { localStorage.setItem(STORAGE_KEY, preset.id) } catch { /* 忽略 */ }
  }

  /**
   * 应用自定义主色。
   *
   * 非法输入直接忽略（不动当前主题）：用户可能在取色器里拖到一半。
   */
  function setCustom(accent: string): void {
    const hex = normalizeHex(accent)
    if (!hex) return
    const next = { accent: hex, progress: lighten(hex) }
    custom.value = next
    currentId.value = 'custom'
    applyPreset({ id: 'custom', name: '自定义', ...next })
    try {
      localStorage.setItem(CUSTOM_KEY, JSON.stringify(next))
      localStorage.setItem(STORAGE_KEY, 'custom')
    } catch { /* 忽略 */ }
  }

  return { presets: THEME_PRESETS, current, currentId, setTheme, skins: SKINS, skinId, custom, setCustom }
}

/** 启动时立即应用，避免先闪一下红色再变色 */
export function initTheme(): void {
  applyPreset(current.value)
  applySkin(skinId.value)
}
