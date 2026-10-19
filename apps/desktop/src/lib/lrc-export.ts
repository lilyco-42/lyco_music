/**
 * 歌词导出为 LRC
 *
 * 纯函数，方便单测。要处理的只有两件容易出错的事：
 *   1. 时间戳格式 —— 必须是 `[mm:ss.xx]`，分钟要补两位，超过 99 分钟也不能截断；
 *   2. 翻译/罗马音 —— 用**同一时间戳另起一行**，这是 LRC 的通行写法
 *      （同一时间戳两行，播放器会把它们一起显示）。塞在同一行用 `/` 拼接
 *      反而会被一些播放器当成歌词正文。
 */
import type { LyricLine } from '@lxmn/core'

export interface LrcMeta {
  title?: string
  artist?: string
  album?: string
  /** 导出者标识，写在 [by:] 里 */
  by?: string
}

/** 秒 -> [mm:ss.xx] */
export function lrcTime(seconds: number): string {
  const t = Math.max(0, Number(seconds) || 0)
  const m = Math.floor(t / 60)
  const s = t - m * 60
  // 两位分钟不够就自然进位成三位，不要截断
  return `[${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}]`
}

/**
 * 生成 LRC 文本。
 *
 * 纯文本歌词（没有时间轴）也能导出：这时不打时间标签，按原样逐行输出，
 * 至少让用户拿到能看的词。
 */
export function buildLrc(meta: LrcMeta, lines: LyricLine[], plain = false): string {
  const head: string[] = []
  if (meta.title) head.push(`[ti:${meta.title}]`)
  if (meta.artist) head.push(`[ar:${meta.artist}]`)
  if (meta.album) head.push(`[al:${meta.album}]`)
  head.push(`[by:${meta.by || 'Lyco Music'}]`)

  const body: string[] = []
  for (const line of lines) {
    if (plain) {
      body.push(line.text)
      continue
    }
    const tag = lrcTime(line.time)
    body.push(`${tag}${line.text}`)
    // 罗马音在前、翻译在后：日文歌两者都有时，读者先看读音再看意思
    if (line.romaji) body.push(`${tag}${line.romaji}`)
    if (line.translation) body.push(`${tag}${line.translation}`)
  }

  return head.join('\n') + '\n' + body.join('\n') + '\n'
}
