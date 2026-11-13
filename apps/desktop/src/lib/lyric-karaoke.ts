/**
 * 歌词「逐字高亮」的字块计算。
 *
 * 之前的做法：没有逐字时间轴（yrc）时，把整行按字数均分，用「当前行已过去
 * 的时间占比 × 字数」估算唱到第几个字。问题是那只是匀速猜测 —— 长音、停顿、
 * 拉长句全都会错位，用户看到的是「字亮了但人还没唱」，当成「已读标记」自然
 * 觉得不准。
 *
 * 现在的规则：
 *   1. 默认**不做**逐字高亮，只把当前整行提亮（准确、也不晃眼）；
 *   2. 用户显式打开「逐字高亮」且该行确实有网易云的逐字时间轴时，
 *      才按 word.time 上色 —— 那是平台给的真实时间，不会猜错；
 *   3. 没有逐字时间轴时即使开关打开也不猜（返回 null，退回整行高亮）。
 */

export interface KaraokeWord {
  time: number
  duration?: number
  text: string
}

export interface KaraokeSpan {
  text: string
  /** 这个字/词是否已经唱到 */
  sung: boolean
}

/**
 * 计算当前行的字块。
 *
 * @returns 需要逐字上色的字块；返回 null 表示「不做逐字」，交给整行高亮
 */
export function karaokeSpans(
  text: string,
  words: readonly KaraokeWord[] | null | undefined,
  time: number,
  enabled: boolean,
): KaraokeSpan[] | null {
  if (!enabled) return null
  if (!words || !words.length) return null
  const t = Number.isFinite(time) ? time : 0
  const spans: KaraokeSpan[] = []
  for (const w of words) {
    const piece = typeof w?.text === 'string' ? w.text : ''
    if (!piece) continue
    spans.push({ text: piece, sung: t >= w.time })
  }
  // 全是空字（脏数据）时也别把整行吃掉
  if (!spans.length) return null
  return spans
}

/**
 * 这一行能不能做逐字：有真实时间轴且开关打开。
 *
 * 模板里用它决定「整行高亮」还是「逐字上色」，与 karaokeSpans 保持一致 ——
 * 两处判断分开写迟早会不同步。
 */
export function canKaraoke(words: readonly KaraokeWord[] | null | undefined, enabled: boolean): boolean {
  return enabled && !!words && words.length > 0
}
