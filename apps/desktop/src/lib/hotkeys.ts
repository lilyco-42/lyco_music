/**
 * 全局快捷键（参考 betterNCM 的键盘操作习惯）。
 *
 * 设计原则：
 *   1. 只在「焦点不在输入控件里」时生效 —— 否则空格会把搜索框变成空格、方向键会挪光标。
 *   2. 组合同一入口注册、统一解绑，避免组件各自 addEventListener 造成重复触发。
 *   3. 每个按键都对应界面上真实存在的操作，不造「文档里有、实际没有」的快捷键。
 *
 * 键位（与网易云桌面端一致）：
 *   Space        播放 / 暂停
 *   ← / →        快退 / 快进 5 秒
 *   Ctrl+← / →   上一首 / 下一首
 *   M            静音开关
 *   L            桌面歌词浮层
 *   Ctrl/⌘+K     聚焦搜索框
 */
import { usePlayer } from './player'

const SEEK_STEP = 5

/** 焦点在可输入元素里时不要抢键 */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return el.isContentEditable === true
}

let installed = false

export function installHotkeys(): void {
  if (installed) return
  installed = true
  const player = usePlayer()

  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.defaultPrevented) return
    if (isTyping(e.target)) return

    const mod = e.ctrlKey || e.metaKey

    // ⌘/Ctrl + K：聚焦搜索
    if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      const input = document.querySelector<HTMLInputElement>('input[type="search"]')
      input?.focus()
      input?.select()
      return
    }

    if (mod && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault()
      if (e.key === 'ArrowLeft') void player.prev()
      else void player.next()
      return
    }

    switch (e.key) {
      case ' ':
        e.preventDefault()
        player.toggle()
        break
      case 'ArrowLeft':
        e.preventDefault()
        player.seek(Math.max(0, player.state.currentTime - SEEK_STEP))
        break
      case 'ArrowRight':
        e.preventDefault()
        player.seek(player.state.currentTime + SEEK_STEP)
        break
      case 'm':
      case 'M':
        e.preventDefault()
        player.toggleMute()
        break
      case 'l':
      case 'L':
        e.preventDefault()
        player.toggleLyric()
        break
      default:
        break
    }
  })
}
