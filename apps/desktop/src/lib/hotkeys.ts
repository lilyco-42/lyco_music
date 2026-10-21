/**
 * 快捷键（PARITY 6.1 固定键位 → 6.2 可自定义）。
 *
 * 键位存在本机偏好里（prefs.shortcuts），格式是 `Ctrl+Shift+KeyM` 这种
 * **基于 `KeyboardEvent.code`** 的组合：用 code 而不是 key，切到俄文/日文
 * 键盘布局时「M 键」还是同一个物理键，不会突然失灵。
 *
 * 三条一直保留的规矩：
 *   1. 焦点在输入控件里时不抢键（否则空格会把搜索框变成空格）；
 *   2. 同一入口统一注册、统一解绑，避免组件各自 addEventListener 重复触发；
 *   3. 每个键都对应界面上真实存在的操作，不造「文档里有、实际没有」的快捷键。
 */
import { usePlayer } from './player'
import { prefs, DEFAULT_SHORTCUTS } from './prefs'

const SEEK_STEP = 5
const VOLUME_STEP = 0.05

/** 可以绑定的动作（设置页按这个列表渲染） */
export const HOTKEY_ACTIONS: { id: string; label: string }[] = [
  { id: 'play-pause', label: '播放 / 暂停' },
  { id: 'prev', label: '上一首' },
  { id: 'next', label: '下一首' },
  { id: 'seek-back', label: '快退 5 秒' },
  { id: 'seek-forward', label: '快进 5 秒' },
  { id: 'volume-up', label: '音量 +' },
  { id: 'volume-down', label: '音量 −' },
  { id: 'mute', label: '静音开关' },
  { id: 'favorite', label: '收藏 / 取消收藏' },
  { id: 'lyric', label: '桌面歌词开关' },
  { id: 'search', label: '聚焦搜索框' },
]

/** 焦点在可输入元素里时不要抢键 */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return el.isContentEditable === true
}

/**
 * 把键盘事件换成组合键字符串。
 *
 * 只认 Ctrl / Shift / Alt 三个修饰键：Meta（Win 键）在 Windows 上会被系统
 * 抢走，绑了也用不上，干脆不提供。
 */
export function comboFromEvent(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.shiftKey) parts.push('Shift')
  if (e.altKey) parts.push('Alt')
  // 修饰键本身不作为主键
  const code = e.code
  if (!code || /^(Control|Shift|Alt|Meta)/.test(code)) return parts.join('+')
  parts.push(code)
  return parts.join('+')
}

/** 给界面看的可读文本：Ctrl+KeyK → Ctrl + K */
export function comboLabel(combo: string): string {
  if (!combo) return '未绑定'
  return combo
    .split('+')
    .map(p => {
      if (p === 'Ctrl' || p === 'Shift' || p === 'Alt') return p
      if (p.startsWith('Key')) return p.slice(3)
      if (p.startsWith('Digit')) return p.slice(5)
      if (p === 'Space') return '空格'
      if (p === 'ArrowLeft') return '←'
      if (p === 'ArrowRight') return '→'
      if (p === 'ArrowUp') return '↑'
      if (p === 'ArrowDown') return '↓'
      if (p === 'Escape') return 'Esc'
      if (p === 'Backspace') return '退格'
      if (p === 'Enter') return '回车'
      return p
    })
    .join(' + ')
}

let installed = false

export function installHotkeys(): void {
  if (installed) return
  installed = true
  const player = usePlayer()

  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.defaultPrevented) return
    if (isTyping(e.target)) return
    // 正在录键位时不要执行任何动作（设置页会置这个标记）
    if (document.documentElement.dataset.recordingHotkey === '1') return

    const combo = comboFromEvent(e)
    if (!combo) return

    const action = Object.keys(prefs.shortcuts).find(id => prefs.shortcuts[id] === combo)
    if (!action) return

    const run = () => {
      switch (action) {
        case 'play-pause': player.toggle(); break
        case 'prev': void player.prev(); break
        case 'next': void player.next(); break
        case 'seek-back':
          player.seek(Math.max(0, player.state.currentTime - SEEK_STEP))
          break
        case 'seek-forward':
          player.seek(player.state.currentTime + SEEK_STEP)
          break
        case 'volume-up':
          player.setVolume(Math.min(1, player.state.volume + VOLUME_STEP))
          break
        case 'volume-down':
          player.setVolume(Math.max(0, player.state.volume - VOLUME_STEP))
          break
        case 'mute': player.toggleMute(); break
        case 'favorite': {
          const it = player.current.value
          if (it) void (async () => {
            const { library } = await import('./sync')
            await library.toggleFavorite(it)
          })()
          break
        }
        case 'lyric': {
          // 与底栏「词」按钮同一个行为：Electron 里开关独立歌词窗口，
          // 浏览器里退回浮层
          const lyric = typeof window !== 'undefined' ? window.lxmnNative?.lyric : undefined
          if (!lyric) { player.toggleLyric(); break }
          void (async () => {
            if (await lyric.isOpen()) {
              // 锁定状态下窗口鼠标穿透，键盘是另一条逃生通道
              if (await lyric.isLocked().catch(() => false)) await lyric.setLock(false).catch(() => false)
              else await lyric.close()
            } else {
              await lyric.open({
                name: player.current.value?.name ?? '',
                singer: player.current.value?.singer ?? '',
                lyric: player.state.lyric,
                tlyric: player.state.tlyric,
                currentTime: player.state.currentTime,
                playing: player.state.playing,
              })
            }
          })()
          break
        }
        case 'search': {
          const input = document.querySelector<HTMLInputElement>('input[type="search"]')
          input?.focus()
          input?.select()
          break
        }
        default: break
      }
    }

    // 空格会滚动页面、方向键会挪焦点，认出来的组合都要拦掉默认行为
    e.preventDefault()
    run()
  })
}

/** 恢复默认键位（设置页按钮） */
export function resetHotkeys(): void {
  prefs.shortcuts = { ...DEFAULT_SHORTCUTS }
}
