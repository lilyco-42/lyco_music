/**
 * 记住列表滚动位置（PARITY 4.11）。
 *
 * 场景：从「我的音乐」往下翻了几十首，点进详情再退回来 —— 回到顶部
 * 是很多桌面应用的默认行为，但列表长的时候非常烦人。
 *
 * 为什么按 `route.fullPath` 存：同一个页面带不同 query（搜索词、歌单 id）
 * 就是不同的列表，位置不能串。为什么不存 DOM 而存数字：内容高度会变
 * （封面加载、分页追加），存像素值在内容变短时会跳到底部，所以恢复时
 * 还要夹一次上限。
 */
import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import { useRoute } from 'vue-router'

const KEY = 'lxmn.scroll.positions'
/** 最多记这么多条路由，避免长期使用后 localStorage 里堆几百条 */
const MAX_ENTRIES = 60

function read(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, unknown>
    if (!raw || typeof raw !== 'object') return {}
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(raw)) {
      const n = Number(v)
      if (Number.isFinite(n) && n > 0) out[k] = n
    }
    return out
  } catch {
    return {}
  }
}

export function useScrollMemory(el: Ref<HTMLElement | null>): void {
  const route = useRoute()
  const positions = read()

  let saveTimer: ReturnType<typeof setTimeout> | null = null
  /** 恢复过程中触发的 scroll 事件不能当成用户行为，否则会把记录冲成 0 */
  let restoring = false

  function flush(): void {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
    const keys = Object.keys(positions)
    if (keys.length > MAX_ENTRIES) {
      for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) delete positions[k]
    }
    try { localStorage.setItem(KEY, JSON.stringify(positions)) } catch { /* 配额满 */ }
  }

  function restore(path: string): void {
    const box = el.value
    if (!box) return
    const target = positions[path] ?? 0
    restoring = true
    // 两帧：第一帧让路由内容挂上去，第二帧才量得到真实高度
    requestAnimationFrame(() => {
      if (el.value) el.value.scrollTop = target
      requestAnimationFrame(() => { restoring = false })
    })
  }

  function onScroll(): void {
    const box = el.value
    if (!box || restoring) return
    const top = box.scrollTop
    if (top > 0) positions[route.fullPath] = top
    else delete positions[route.fullPath]
    if (!saveTimer) saveTimer = setTimeout(flush, 400)
  }

  onMounted(() => {
    el.value?.addEventListener('scroll', onScroll, { passive: true })
    restore(route.fullPath)
  })

  onBeforeUnmount(() => {
    el.value?.removeEventListener('scroll', onScroll)
    flush()
  })

  watch(() => route.fullPath, to => {
    flush()
    restore(to)
  })
}

/** 供设置页「清空播放进度」时一起清（滚动位置也算本机数据） */
export function clearScrollPositions(): void {
  try { localStorage.removeItem(KEY) } catch { /* ignore */ }
}

/** 当前记录了多少条（设置页显示用） */
export function scrollPositionCount(): number {
  return Object.keys(read()).length
}

/** 给测试/调试用：暴露内部 key，避免测试里写死字符串 */
export const SCROLL_MEMORY_KEY = KEY
