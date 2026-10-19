/**
 * 质感滤镜（UI 纹理层）。
 *
 * 为什么要有这一层：纯色面板 + 圆角 + 阴影，做到位也只是「干净」，
 * 想再往上走一步（也就是大家说的「高级感」），缺的其实是**材质**。
 * 印刷品之所以耐看，是因为纸有纤维、油墨有网点；屏幕上的纯色反而像塑料。
 * 所以这里在整屏上压一层极淡的纹理，把「塑料感」压掉。
 *
 * 几条实测出来的规矩：
 *   1. 强度必须可调。同一张网点，4% 是高级，15% 就是脏 —— 跟显示器、缩放都有关系。
 *   2. 用正片叠底（multiply）而不是直接盖一层。纹理要「印」在底色上，
 *      直接盖会在深色区域浮出一层灰雾。
 *   3. 半调网点要「有疏密」。等大等距的点只是壁纸；真正的半调是网点沿某个
 *      方向逐渐变粗，所以实现里是三层同网格、不同点径，各自用蒙版圈出区域。
 *   4. 纹理只作用于**背景**。字上带颗粒会糊，正文区域一律不碰。
 */
import { ref } from 'vue'

export type TextureId = 'halftone' | 'grain' | 'dither' | 'grid' | 'none'

export interface TexturePreset {
  id: TextureId
  name: string
  /** 一句话说清它「高级」在哪，设置页直接展示 */
  desc: string
  /** 默认强度 0~100 */
  strength: number
}

/**
 * 默认给「半调网点」：它是这几款里唯一自带**疏密变化**的，
 * 静态看像印刷品，比均匀噪点耐看，也不会像网格那样有「工程图纸」味。
 */
export const TEXTURES: TexturePreset[] = [
  {
    id: 'halftone',
    name: '半调网点',
    desc: '印刷网屏的做法：网点沿角落逐渐变粗，有纸张的呼吸感',
    strength: 58,
  },
  {
    id: 'grain',
    name: '胶片颗粒',
    desc: '细密随机颗粒，压住纯色面板的塑料感',
    strength: 46,
  },
  {
    id: 'dither',
    name: '抖动噪点',
    desc: '1-bit 棋盘抖动，复古显示器的秩序感',
    strength: 42,
  },
  {
    id: 'grid',
    name: '细密网格',
    desc: '1px 细线网格，偏工程/蓝图气质',
    strength: 40,
  },
  {
    id: 'none',
    name: '纯净',
    desc: '完全关闭纹理，最省 GPU，也最适合低分屏',
    strength: 0,
  },
]

const TEXTURE_KEY = 'lxmn.ui.texture'
const STRENGTH_KEY = 'lxmn.ui.texture.strength'

function isTextureId(v: unknown): v is TextureId {
  return TEXTURES.some(t => t.id === v)
}

function readTexture(): TextureId {
  try {
    const saved = localStorage.getItem(TEXTURE_KEY)
    if (isTextureId(saved)) return saved
  } catch {
    // 隐私模式 / 存储被禁用：按默认走
  }
  // 默认就是「高级感」那一款
  return 'halftone'
}

/** 强度按每个纹理自己的默认值恢复，不共用一条：网点 52 和颗粒 26 不是一个量级 */
function defaultStrength(id: TextureId): number {
  return TEXTURES.find(t => t.id === id)?.strength ?? 0
}

function readStrength(id: TextureId): number {
  try {
    const raw = localStorage.getItem(STRENGTH_KEY)
    // 注意：这里必须先判 null。Number(null) 是 0，能通过后面的范围校验，
    // 结果就是「从没设置过的用户强度直接是 0」——纹理等于没开（踩过）。
    if (raw !== null && raw !== '') {
      const n = Number(raw)
      if (Number.isFinite(n) && n >= 0 && n <= 100) return Math.round(n)
    }
  } catch {
    // 同上
  }
  return defaultStrength(id)
}

const textureId = ref<TextureId>(readTexture())
const strength = ref<number>(readStrength(textureId.value))

function apply(): void {
  const root = document.documentElement
  root.dataset.texture = textureId.value
  // 0~100 -> 0~1，CSS 里直接乘到 opacity 上
  root.style.setProperty('--tex-strength', String(strength.value / 100))
}

export function useTexture() {
  function setTexture(id: TextureId): void {
    if (!isTextureId(id)) return
    textureId.value = id
    // 换纹理时强度跟着换到它自己的推荐值，否则「网点 8%」换到颗粒会几乎看不见
    strength.value = defaultStrength(id)
    apply()
    try {
      localStorage.setItem(TEXTURE_KEY, id)
      localStorage.setItem(STRENGTH_KEY, String(strength.value))
    } catch {
      // 只影响下次启动
    }
  }

  function setStrength(v: number): void {
    const n = Math.min(100, Math.max(0, Math.round(Number(v) || 0)))
    strength.value = n
    apply()
    try {
      localStorage.setItem(STRENGTH_KEY, String(n))
    } catch {
      // 同上
    }
  }

  return { textures: TEXTURES, textureId, strength, setTexture, setStrength }
}

/** 启动时立即应用，避免先白一下再出纹理 */
export function initTexture(): void {
  apply()
}
