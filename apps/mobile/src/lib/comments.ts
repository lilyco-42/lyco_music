/**
 * 移动端评论的辅助逻辑。
 *
 * 之前移动端只调 getComments(item, page, 20)：没有热门/最新排序，
 * 非网易云音源直接显示「当前音源不提供评论」。桌面端早就有
 * 「借网易云同名歌曲的评论」，这里把同一套能力搬到手机。
 */
import type { MusicItem, MusicSource, SourceId } from '@lxmn/core'

export type CommentSort = 'hot' | 'new'

export interface CommentTarget {
  source: SourceId
  item: MusicItem
  /** 评论实际来自网易云的同名歌曲，界面上必须如实标注 */
  borrowed: boolean
}

/** 1.2 万 → "1.2万"，999 → "999"；脏值返回空串而不是 NaN */
export function fmtLikes(n: number | undefined | null): string {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return ''
  if (n < 10000) return String(n)
  const w = n / 10000
  return (w < 10 ? w.toFixed(1).replace(/\.0$/, '') : Math.round(w).toString()) + '万'
}

/** 评论时间：今天显示 HH:mm，今年显示 M月d日，跨年显示 YYYY/M/d */
export function fmtCommentTime(time: number | undefined | null, now = Date.now()): string {
  if (typeof time !== 'number' || !Number.isFinite(time) || time <= 0) return ''
  const d = new Date(time)
  const n = new Date(now)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (x: number) => String(x).padStart(2, '0')
  const hm = pad(d.getHours()) + ':' + pad(d.getMinutes())
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()
  if (sameDay) return hm
  if (d.getFullYear() === n.getFullYear()) return (d.getMonth() + 1) + '月' + d.getDate() + '日'
  return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate()
}

/** 歌名去空白、去常见括注，用于跨源同名匹配 */
function norm(s: unknown): string {
  return String(s ?? '').toLowerCase().replace(/\s+/g, '').replace(/[（(【\[].*?[)）】\]]/g, '')
}

/** 歌手有交集即认为同一首（"A/B" 与 "A" 也算） */
function sameArtist(a: unknown, b: unknown): boolean {
  const x = String(a ?? '').toLowerCase().replace(/\s+/g, '')
  const y = String(b ?? '').toLowerCase().replace(/\s+/g, '')
  if (!x || !y) return true
  const xs = x.split(/[/、,，&]/).filter(Boolean)
  const ys = y.split(/[/、,，&]/).filter(Boolean)
  return xs.some(p => ys.some(q => p.includes(q) || q.includes(p)))
}

/**
 * 找评论来源：当前音源有评论接口就直接用；否则去网易云搜同名歌。
 *
 * 匹配只认「歌名完全相同 + 歌手有交集」，宁可显示「暂无评论」，
 * 也不能把另一首歌的评论挂到当前歌曲下面（这是桌面端踩过的坑）。
 * musicSearch 不存在时直接放弃借源，测试桩/精简音源不会因此崩。
 */
export async function resolveCommentTarget(
  item: MusicItem | null,
  getSource: (id: SourceId) => MusicSource,
  hasSource: (id: SourceId) => boolean,
): Promise<CommentTarget | null> {
  if (!item) return null
  try {
    if (hasSource(item.source) && getSource(item.source).getComments) {
      return { source: item.source, item, borrowed: false }
    }
  } catch {
    // 音源尚未注册：继续尝试借源
  }
  if (item.source === 'wy' || !hasSource('wy')) return null
  const wy = getSource('wy')
  if (!wy.musicSearch) return null
  const keyword = (String(item.name ?? '') + ' ' + String(item.singer ?? '')).trim()
  if (!keyword) return null
  try {
    const res = await wy.musicSearch(keyword, 1, 10)
    const name = norm(item.name)
    const hit = (res.list ?? []).find(x => norm(x.name) === name && sameArtist(item.singer, x.singer))
    if (hit) return { source: 'wy', item: hit, borrowed: true }
  } catch {
    // 搜索失败就当作没有评论，不阻断界面
  }
  return null
}
