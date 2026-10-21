/**
 * 评论正文解析（PARITY 9.1）。
 *
 * 网易云的评论正文不是纯文本，里面混着三种东西：
 *   1. 表情码 —— `[大笑]`、`[爱心]`，客户端要换成图片/字符；
 *   2. 图片 —— `![图片](https://p1.music.126.net/xxx.jpg)`；
 *   3. 普通文字（含换行）。
 *
 * 直接 `{{ content }}` 渲染的结果就是「[大笑] 这歌真好听 ![图片](https://...)」，
 * 一行天书。这里把它切成段，界面按段渲染。
 *
 * 表情只覆盖常见的那批（见 EMOJI）：网易云的表情有一百多个，
 * 全量映射要配一百多张图；用 Unicode 字符代替既不用下载资源、
 * 又不会因为 CDN 挂了整条评论变成空白。表里没有的 `[xxx]` 原样保留 ——
 * 用户至少还能看懂字面意思。
 */

export type CommentSegment =
  | { type: 'text'; text: string }
  | { type: 'image'; url: string }
  | { type: 'emoji'; name: string; char: string }

/**
 * 常见表情码 → Unicode。
 *
 * 只收「看得懂、且不会认错情绪」的那些；[可爱]/[害羞] 这类
 * 没有唯一对应的字符，宁可原样保留也不乱猜。
 */
export const COMMENT_EMOJI: Record<string, string> = {
  大笑: '😄', 可爱: '😊', 憨笑: '😁', 开心: '😃', 微笑: '🙂',
  色: '😍', 亲亲: '😘', 喜欢: '😍', 爱意: '🥰',
  哭: '😭', 大哭: '😭', 流泪: '😢', 难过: '😔', 悲伤: '😞',
  怒: '😡', 生气: '😠', 发火: '🤬',
  惊讶: '😲', 惊恐: '😱', 疑问: '❓', 晕: '😵',
  汗: '😅', 尴尬: '😅', 无语: '😑', 白眼: '🙄',
  睡觉: '😴', 困: '😪', 口罩: '😷',
  笑哭: '😂', 滑稽: '😏', 奸笑: '😏', 坏笑: '😏',
  赞: '👍', 强: '👍', 鼓掌: '👏', 握手: '🤝', 抱拳: '🙏', 拜托: '🙏',
  弱: '👎', 鄙视: '👎',
  爱心: '❤️', 心碎: '💔', 两颗心: '💕',
  星星: '⭐', 月亮: '🌙', 太阳: '☀️', 火: '🔥', 雪花: '❄️',
  玫瑰: '🌹', 花: '🌸', 蛋糕: '🎂', 啤酒: '🍺', 咖啡: '☕',
  音乐: '🎵', 耳机: '🎧', 吉他: '🎸', 麦克风: '🎤',
  狗: '🐶', 猫: '🐱', 猪: '🐷', 兔子: '🐰',
   OK: '👌', 耶: '✌️', 拳头: '✊',
}

/** 图片：markdown 形式，或裸的图片链接（网易云两种都会出现） */
const IMAGE_MD = /!\[[^\]]*\]\(\s*(https?:\/\/[^\s)]+)\s*\)/g
const IMAGE_BARE = /(https?:\/\/[^\s]+?\.(?:jpe?g|png|gif|webp)(?:\?[^\s]*)?)/gi
/** 表情码：中括号里 1–4 个字符，避免把 `[00:12]` 这类歌词标记吃掉 */
const EMOJI_CODE = /\[([\u4e00-\u9fa5A-Za-z]{1,4})\]/g

const IMAGE_EXT = /\.(?:jpe?g|png|gif|webp)(?:\?|$)/i

/**
 * 把一段评论正文切成可渲染的片段。
 *
 * 一次扫描同时处理三种标记，而不是「先替换图片再替换表情」：
 * 分步替换很容易把刚生成的 HTML/占位符再匹配一次，越改越乱。
 */
export function parseCommentContent(content: string): CommentSegment[] {
  const text = String(content ?? '')
  if (!text) return []

  const out: CommentSegment[] = []
  let cursor = 0
  /** 收集普通文字，遇到标记时先把它冲出去 */
  const flushText = (end: number): void => {
    if (end > cursor) {
      const piece = text.slice(cursor, end)
      if (piece) out.push({ type: 'text', text: piece })
    }
  }

  // 用一个合并的扫描：每次找「最靠前的那个标记」
  const findNext = (from: number): { start: number; end: number; seg: CommentSegment } | null => {
    let best: { start: number; end: number; seg: CommentSegment } | null = null

    IMAGE_MD.lastIndex = from
    const md = IMAGE_MD.exec(text)
    if (md) best = { start: md.index, end: md.index + md[0].length, seg: { type: 'image', url: md[1]! } }

    IMAGE_BARE.lastIndex = from
    const bare = IMAGE_BARE.exec(text)
    if (bare && (!best || bare.index < best.start)) {
      best = { start: bare.index, end: bare.index + bare[0].length, seg: { type: 'image', url: bare[1] ?? bare[0] } }
    }

    EMOJI_CODE.lastIndex = from
    let em: RegExpExecArray | null
    while ((em = EMOJI_CODE.exec(text))) {
      const char = COMMENT_EMOJI[em[1]!]
      // 表里没有的码不当标记：原样留在文字里，比切成一个空片段好
      if (!char) continue
      const seg: CommentSegment = { type: 'emoji', name: em[1]!, char }
      if (!best || em.index < best.start) best = { start: em.index, end: em.index + em[0].length, seg }
      break
    }

    return best
  }

  for (let guard = 0; guard < 500; guard++) {
    const next = findNext(cursor)
    if (!next) break
    flushText(next.start)
    out.push(next.seg)
    cursor = next.end
  }
  flushText(text.length)

  return out
}

/** 评论里是否含图片（界面据此决定要不要预留更高的行高） */
export function commentHasImage(content: string): boolean {
  const text = String(content ?? '')
  if (!text) return false
  IMAGE_MD.lastIndex = 0
  if (IMAGE_MD.test(text)) return true
  IMAGE_BARE.lastIndex = 0
  return IMAGE_BARE.test(text) && IMAGE_EXT.test(text)
}
