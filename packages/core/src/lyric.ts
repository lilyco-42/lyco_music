/**
 * LRC 歌词解析（零 DOM 依赖）
 *
 * 放在内核而不是 UI 层，是因为桌面端和移动端都要用，而且它纯粹是字符串处理，
 * 没有任何平台 API —— 移动端的 Hermes 没有 TextEncoder，能在这里跑的东西
 * 就一定能在两边跑。
 *
 * 覆盖实际会遇到的几种写法：
 *   [00:12.34]文本          —— 标准
 *   [00:12.340]文本         —— 毫秒三位
 *   [00:12]文本             —— 没有小数
 *   [00:12.34][01:20.00]文本 —— 一行多个时间戳（副歌复用）
 *   [offset:-500]           —— 全局偏移，毫秒
 *   [ti:]/[ar:]/[al:]/[by:] —— 元信息，忽略
 *   [00:12.34]              —— 空行，用来做间奏占位
 */

/** 一行歌词 */
export interface LyricLine {
  /** 该行开始时间，秒 */
  time: number
  /** 原文 */
  text: string
  /** 翻译（来自 tlyric，按时间戳对齐） */
  translation?: string
}

export interface ParsedLyric {
  lines: LyricLine[]
  /** 有翻译行时为 true，UI 可以据此决定要不要留第二行的高度 */
  hasTranslation: boolean
  /**
   * 纯文本歌词（没有任何时间标签）。
   *
   * 网易云对播客、翻唱、纯词作品只回一段无时间戳的文本。以前这种响应会被
   * 解析成 0 行，界面就一直停在「歌词解析中…」——用户看到的是永远转圈。
   * 现在按行造行并打上这个标记，UI 静态展示即可（不做高亮、不可点击跳转）。
   */
  plain?: boolean
}

/** [mm:ss.fff] / [mm:ss:fff] / [mm:ss] —— 冒号和小数点都见过 */
const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g
const META_TAG = /^\[(ti|ar|al|by|offset|length|re|ve):(.*)\]$/i

function toSeconds(min: string, sec: string, frac?: string): number {
  const m = Number(min)
  const s = Number(sec)
  let ms = 0
  if (frac) {
    // "5" -> 500ms，"34" -> 340ms，"340" -> 340ms
    ms = Number(frac.padEnd(3, '0').slice(0, 3))
  }
  return m * 60 + s + ms / 1000
}

/**
 * 解析 LRC 文本。
 *
 * 返回的行**按时间升序**，并且同一时间戳只会出现一次 —— 后面解析出来的
 * 相同时间戳会覆盖前面的，这样 tlyric 合并进来时行为是可预期的。
 */
export function parseLrc(raw: string | null | undefined): ParsedLyric {
  if (!raw) return { lines: [], hasTranslation: false }

  const byTime = new Map<number, LyricLine>()
  let offsetMs = 0

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue

    // 元信息：offset 要真正生效，其余忽略
    const meta = META_TAG.exec(line)
    if (meta) {
      if ((meta[1] ?? '').toLowerCase() === 'offset') {
        const v = Number((meta[2] ?? '').trim())
        if (Number.isFinite(v)) offsetMs = v
      }
      continue
    }

    // 取出这一行开头所有的时间标签
    TIME_TAG.lastIndex = 0
    const times: number[] = []
    let m: RegExpExecArray | null
    let lastEnd = 0
    while ((m = TIME_TAG.exec(line)) !== null) {
      // 时间标签必须连续出现在行首，否则 "歌词里有 [00:01] 这种字样" 会被误判
      if (m.index !== lastEnd) break
      times.push(toSeconds(m[1] ?? '0', m[2] ?? '0', m[3]))
      lastEnd = m.index + m[0].length
    }
    if (!times.length) continue

    const text = line.slice(lastEnd).trim()
    for (const t of times) {
      const time = Math.max(0, t - offsetMs / 1000)
      byTime.set(time, { time, text })
    }
  }

  const lines = [...byTime.values()].sort((a, b) => a.time - b.time)
  if (lines.length) return { lines, hasTranslation: false }

  // 一条时间标签都没有：当作纯文本歌词，按行造出等距时间轴。
  // 这样 UI 至少能把词显示出来，而不是卡在「解析中」。
  const plain: LyricLine[] = []
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    if (META_TAG.test(line)) continue
    plain.push({ time: plain.length, text: line })
  }
  return { lines: plain, hasTranslation: false, plain: plain.length > 0 }
}

/**
 * 把翻译歌词按时间戳合并进原文。
 *
 * 翻译行的时间戳与原文**未必逐字相等**（各家音源精度不同），所以用
 * 一个容差去匹配；匹配不上就丢弃，绝不硬塞 —— 错位的翻译比没有翻译更糟。
 */
export function mergeTranslation(parsed: ParsedLyric, tlyric: string | null | undefined, tolerance = 0.35): ParsedLyric {
  // 纯文本歌词没有有意义的时间轴，套翻译只会错位
  if (parsed.plain) return parsed
  if (!parsed.lines.length || !tlyric) return parsed
  const tr = parseLrc(tlyric)
  if (!tr.lines.length) return parsed

  const used = new Set<number>()
  let has = false
  for (const line of parsed.lines) {
    let best = -1
    let bestDelta = Infinity
    for (let i = 0; i < tr.lines.length; i++) {
      if (used.has(i)) continue
      const cand = tr.lines[i]
      if (!cand) continue
      const d = Math.abs(cand.time - line.time)
      if (d < bestDelta) { bestDelta = d; best = i }
    }
    if (best >= 0 && bestDelta <= tolerance) {
      const text = tr.lines[best]?.text
      if (text) { line.translation = text; used.add(best); has = true }
    }
  }
  return { lines: parsed.lines, hasTranslation: has }
}

/** 一次性解析原文 + 翻译 */
export function parseLyric(lyric: string | null | undefined, tlyric?: string | null): ParsedLyric {
  return mergeTranslation(parseLrc(lyric), tlyric)
}

/**
 * 二分找出「当前时间正在唱第几行」。
 *
 * 返回 -1 表示还没到第一行（前奏），UI 通常显示成"即将开始"。
 */
export function findLineIndex(lines: LyricLine[], time: number): number {
  if (!lines.length) return -1
  const first = lines[0]
  if (!first || time < first.time) return -1
  let lo = 0
  let hi = lines.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    const at = lines[mid]
    if (at && at.time <= time) lo = mid
    else hi = mid - 1
  }
  return lo
}
