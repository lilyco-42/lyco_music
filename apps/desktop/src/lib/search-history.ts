/**
 * 桌面端搜索历史。
 *
 * 之前顶栏搜过什么就忘了：点进播放器听完再回来，得把关键词重新打一遍。
 * 移动端一直有历史（SearchScreen 的 lxmn.mobile.searchHistory），桌面端漏了。
 *
 * 存 localStorage 整份 JSON，和 prefs 一样：字段少、一次读写、坏数据直接丢弃
 * 比「一半新一半旧」好排查。localStorage 不可用（隐私模式、测试环境）时
 * 退回进程内数组，功能照常，只是关掉应用就没了。
 */

export const SEARCH_HISTORY_KEY = 'lxmn.desktop.searchHistory'

/** 条数上限：再多下拉框会顶到窗口外面去 */
export const SEARCH_HISTORY_MAX = 12

/** 单条最长字符数：整段歌词粘进来会把下拉框撑爆 */
export const SEARCH_HISTORY_MAX_LEN = 60

let memory: string[] = []

function store(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    // 某些环境访问 localStorage 本身就会抛（被策略禁用）
    return null
  }
}

/** 归一化：去首尾空白、合并内部空白、截断长度；空串表示这条不要 */
export function normalizeKeyword(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const one = raw.replace(/\s+/g, ' ').trim()
  return one.length > SEARCH_HISTORY_MAX_LEN ? one.slice(0, SEARCH_HISTORY_MAX_LEN) : one
}

/** 读历史。任何脏数据都当作「没有」，不让一条坏记录废掉整个列表 */
export function readSearchHistory(): string[] {
  const s = store()
  if (!s) return [...memory]
  let raw: string | null = null
  try {
    raw = s.getItem(SEARCH_HISTORY_KEY)
  } catch {
    return [...memory]
  }
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const out: string[] = []
    for (const item of parsed) {
      const q = normalizeKeyword(item)
      if (!q) continue
      if (out.some(x => x.toLowerCase() === q.toLowerCase())) continue
      out.push(q)
      if (out.length >= SEARCH_HISTORY_MAX) break
    }
    return out
  } catch {
    return []
  }
}

function write(list: string[]): string[] {
  const trimmed = list.slice(0, SEARCH_HISTORY_MAX)
  memory = [...trimmed]
  const s = store()
  if (s) {
    try {
      s.setItem(SEARCH_HISTORY_KEY, JSON.stringify(trimmed))
    } catch {
      // 配额满 / 隐私模式：内存里留着，界面照常可用
    }
  }
  return trimmed
}

/**
 * 记一条搜索。
 *
 * 去重按小写比较：搜过 "Taylor Swift" 再搜 "taylor swift" 不该出现两行 ——
 * 但保留用户最后输入的写法（重新搜一次等于把它提到最前面并更新大小写）。
 */
export function pushSearchHistory(raw: string, list?: string[]): string[] {
  const q = normalizeKeyword(raw)
  const base = list ? [...list] : readSearchHistory()
  if (!q) return base
  const rest = base.filter(x => x.toLowerCase() !== q.toLowerCase())
  return write([q, ...rest])
}

/** 删掉一条（下拉框每行的 × ） */
export function removeSearchHistory(raw: string, list?: string[]): string[] {
  const q = normalizeKeyword(raw)
  const base = list ? [...list] : readSearchHistory()
  if (!q) return base
  return write(base.filter(x => x.toLowerCase() !== q.toLowerCase()))
}

/** 清空（下拉框底部「清空搜索历史」） */
export function clearSearchHistory(): string[] {
  return write([])
}
