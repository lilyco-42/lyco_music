/**
 * 下载文件名生成
 *
 * 移植自 lx-music-desktop 的 `formatMusicName` / `filterFileName` / `clipFileNameLength`
 * （v2.12.6），但把「中文占位符」换成了花括号模板，同时**保留对 lx 写法的兼容** ——
 * 从 lx 迁移过来的用户，原来填的 `歌名 - 歌手` 仍然有效。
 *
 * 这里只做字符串处理，不碰文件系统，所以能在两端和测试里跑。
 */
import type { MusicItem } from '../types'

/** 内置三种命名方式（与 lx 的选项一一对应） */
export const NAME_FORMATS = [
  { id: 'title-artist', label: '歌曲名 - 艺术家', template: '{title} - {artist}' },
  { id: 'artist-title', label: '艺术家 - 歌曲名', template: '{artist} - {title}' },
  { id: 'title', label: '歌曲名', template: '{title}' },
] as const

export type NameFormatId = (typeof NAME_FORMATS)[number]['id']

/** 文件名主体长度上限（不含扩展名）。Windows 整条路径 260，留足余量 */
const MAX_BASE_LENGTH = 120

/**
 * Windows 保留设备名。
 *
 * `CON.mp3` 这类名字在 Windows 上**根本创建不了** —— 不是报错提示，是
 * 静默失败或直接写到设备上。用户下载一首叫「CON」的歌就会卡在 0%。
 */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

/** 路径分隔符与 Windows 不允许出现在文件名里的字符 */
const ILLEGAL = /[\\/:*?"<>|\u0000-\u001f]/g

/**
 * 清洗文件名。
 *
 * 注意**不能简单地把非法字符删掉**：`AC/DC` 删成 `ACDC` 和另一首 `ACDC`
 * 就撞名了。替换成 `_` 至少保留长度与位置，撞名概率低得多。
 */
export function sanitizeFileName(name: string): string {
  let out = String(name ?? '')
    .replace(ILLEGAL, '_')
    // 连续空白压成一个：`A    B` 在列表里和 `A B` 无法区分
    .replace(/\s+/g, ' ')
    .trim()
    // Windows 不允许文件名以点结尾（`A.` 会被自动截断，导致路径对不上）
    .replace(/[. ]+$/, '')

  if (!out) out = '未命名'
  if (WINDOWS_RESERVED.test(out)) out = '_' + out
  return out
}

/** 按显示宽度截断（中文按 2 个宽度算，否则中文歌名会被截得过短） */
export function clipBaseName(name: string, max = MAX_BASE_LENGTH): string {
  let width = 0
  let out = ''
  for (const ch of name) {
    const w = ch.charCodeAt(0) > 0x2e80 ? 2 : 1
    if (width + w > max) break
    width += w
    out += ch
  }
  return out.trim() || name.slice(0, 20)
}

/**
 * 把模板里的占位符换成实际内容。
 *
 * 同时支持两套写法：
 *   `{title}` / `{artist}` / `{album}`  —— 我们自己的
 *   `歌名` / `歌手`                      —— lx-music 的，兼容迁移用户
 */
export function renderTemplate(template: string, item: Pick<MusicItem, 'name' | 'singer' | 'albumName'>): string {
  const title = String(item.name ?? '')
  const artist = String(item.singer ?? '')
  const album = String(item.albumName ?? '')

  return String(template ?? '')
    .replace(/\{title\}/gi, title)
    .replace(/\{artist\}/gi, artist)
    .replace(/\{album\}/gi, album)
    // lx 的写法：只替换第一次出现，与它的实现一致
    .replace('歌名', title)
    .replace('歌手', artist)
}

/** 解析命名方式：内置 id 或自定义模板 */
export function resolveTemplate(format: string | undefined): string {
  const hit = NAME_FORMATS.find(f => f.id === format)
  if (hit) return hit.template
  const raw = String(format ?? '').trim()
  return raw || NAME_FORMATS[0].template
}

/**
 * 生成最终文件名（含扩展名）。
 *
 * 艺术家为空时不留悬空的分隔符：`晴天 - ` 这种名字在资源管理器里很难看，
 * 而且和 `晴天` 会变成两个不同文件。
 */
export function buildFileName(
  item: Pick<MusicItem, 'name' | 'singer' | 'albumName'>,
  format: string | undefined,
  ext: string,
): string {
  const rendered = renderTemplate(resolveTemplate(format), item)
  const cleaned = rendered
    // 模板渲染后可能出现 `A - ` / ` - B`，把悬空的分隔符收掉
    .replace(/\s*-\s*(?=-|$)/g, '')
    .replace(/^\s*-\s*/, '')
    .trim()

  const base = clipBaseName(sanitizeFileName(cleaned))
  const suffix = String(ext ?? '').replace(/^\./, '').toLowerCase() || 'mp3'
  return `${base}.${suffix}`
}

/**
 * 音质 → 扩展名。
 *
 * 与 lx 一致：ape 保留 ape，flac/flac24bit 都是 flac，其余一律 mp3。
 * 不做「按 URL 猜」—— CDN 地址经常没有后缀，猜错会写出一个
 * 扩展名与实际编码不符的文件，播放器直接打不开。
 */
export function extForQuality(quality: string, type?: string): string {
  const t = String(type ?? '').toLowerCase()
  if (t === 'ape' || t === 'flac' || t === 'wav' || t === 'mp3' || t === 'm4a' || t === 'ogg') return t
  switch (quality) {
    case 'ape': return 'ape'
    case 'flac':
    case 'flac24bit': return 'flac'
    case 'wav': return 'wav'
    default: return 'mp3'
  }
}
