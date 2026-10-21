/**
 * 中文简繁转换（PARITY 3.4）。
 *
 * 逐字映射，不做分词 —— 歌词是短句，逐字已经够用；而分词方案要带一份
 * 词典（几百 KB 起）并且初始化有延迟。lx-music 用的是同一套表。
 *
 * 方向：**简体 → 繁体**（与 lx 的 `player.isS2t` 一致）。
 * 反向（繁 → 简）也保留，备份导入这类场景用得上。
 *
 * 注意几个必然的失真，不要在测试里把它们当 bug：
 *   - 一字多繁（发 → 發/髮、干 → 乾/幹/干）只能取表里那一个；
 *   - 「著/着」「里/裡」这类两岸用字差异不处理，只做字形转换。
 */
import { SIMPLIFIED, TRADITIONAL } from './s2t-table'

let stMap: Map<string, string> | null = null
let tsMap: Map<string, string> | null = null

function build(): void {
  if (stMap && tsMap) return
  stMap = new Map()
  tsMap = new Map()
  // 两个字符串理论上一一对应；万一上游改坏了长度，以短的那个为准，
  // 不能越界读到 undefined（那会把字变成 "undefined" 六个字母）
  const n = Math.min(SIMPLIFIED.length, TRADITIONAL.length)
  for (let i = 0; i < n; i++) {
    const s = SIMPLIFIED[i]!
    const t = TRADITIONAL[i]!
    if (!stMap.has(s)) stMap.set(s, t)
    if (!tsMap.has(t)) tsMap.set(t, s)
  }
}

function convert(text: string, map: Map<string, string>): string {
  if (!text) return ''
  let out = ''
  // for...of 按码点迭代：生僻字是代理对，按 UTF-16 下标切会切坏
  for (const ch of text) out += map.get(ch) ?? ch
  return out
}

/** 简体 → 繁体 */
export function toTraditional(text: string): string {
  build()
  return convert(text, stMap!)
}

/** 繁体 → 简体 */
export function toSimplified(text: string): string {
  build()
  return convert(text, tsMap!)
}

/**
 * 按需转换整段歌词（含时间标签）。
 *
 * 时间标签是 `[00:12.34]` 这种纯 ASCII，逐字映射天然不会动它，
 * 所以不需要先解析再拼回去 —— 少一层出错的机会。
 */
export function convertLyric(text: string, traditional: boolean): string {
  return traditional ? toTraditional(text) : text
}
