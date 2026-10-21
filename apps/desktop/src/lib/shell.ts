/**
 * 系统集成（托盘 / 任务栏进度 / 防休眠 / 窗口尺寸 / 界面缩放）。
 *
 * 为什么集中在一个模块而不是散在各组件里：
 *   - 这几项都依赖「播放状态」这一个来源，散开会变成每个组件各订阅一次，
 *     任务栏进度这种高频信号很容易被写十几遍；
 *   - 浏览器里跑（vite dev 直接用 Chrome 打开）时 `window.lxmnNative` 不存在，
 *     集中在这里判断一次，组件里不用到处写 `if (electron)`。
 *
 * 全部是幂等的：装一次就够，重复调用直接返回。
 */
import { watch } from 'vue'
import { restoreQueue, usePlayer } from './player'
import { prefs, WINDOW_PRESETS } from './prefs'
import { library, useSync } from './sync'
import { useUpdater } from './update'

function native(): Window['lxmnNative'] | undefined {
  return typeof window === 'undefined' ? undefined : window.lxmnNative
}

let installed = false

export function installShellIntegration(): void {
  if (installed) return
  installed = true
  // 桌面歌词窗口是另一个渲染进程，它不需要托盘/任务栏这些
  if (document.documentElement.dataset.window === 'lyric') return

  const player = usePlayer()
  const { favorites } = useSync()
  const n = native()

  /* ---------------- 界面大小（7.3） ---------------- */

  /**
   * 用 CSS zoom 而不是改根字号。
   *
   * 全站字号是 px 字面量（`text-[13px]`），改 html 的 font-size 一点用都没有；
   * 改成 rem 要动几百处、还得重新校一遍视觉。zoom 是 Chromium 原生支持的
   * 整体缩放，布局跟着一起缩放，正是「界面变大」的预期 —— 代价是它不是
   * 只放大字，这一点在设置页的说明里写清楚了。
   */
  const applyScale = (): void => {
    document.documentElement.style.zoom = String(prefs.fontScale || 1)
  }
  applyScale()
  watch(() => prefs.fontScale, applyScale)

  /* ---------------- 窗口尺寸预设（7.5） ---------------- */

  const applyWindow = (): void => {
    const p = WINDOW_PRESETS.find(x => x.id === prefs.windowPreset) ?? WINDOW_PRESETS[1]!
    void n?.win?.setSize({ width: p.width, height: p.height })
  }
  // 只在用户主动改的时候动窗口：启动时抢一次窗口尺寸会让「上次拖到哪」
  // 这类系统记忆失效，用户会觉得窗口位置自己乱跑。
  watch(() => prefs.windowPreset, applyWindow)

  /* ---------------- 托盘（6.3 / 6.4） ---------------- */

  watch(() => prefs.closeToTray, on => { void n?.tray?.setCloseToTray(on) }, { immediate: true })

  const pushTrayState = (): void => {
    const it = player.state.queue[player.state.index] ?? null
    void n?.tray?.setState({
      playing: player.state.playing,
      name: it?.name ?? '',
      singer: it?.singer ?? '',
      favorite: it ? library.isFavorite(it) : false,
    })
  }
  watch(
    () => [
      player.state.playing,
      player.state.index,
      player.state.queue.length,
      favorites.value.length,
    ],
    pushTrayState,
    { immediate: true },
  )

  n?.tray?.onCommand(cmd => {
    switch (cmd) {
      case 'toggle': player.toggle(); break
      case 'prev': void player.prev(); break
      case 'next': void player.next(); break
      case 'favorite': {
        const it = player.current.value
        if (it) void library.toggleFavorite(it)
        break
      }
      case 'lyric': player.toggleLyric(); break
      default: break
    }
  })

  /* ---------------- 任务栏进度（2.11） ---------------- */

  let lastPushed = -2
  watch(
    () => [player.state.playing, player.state.currentTime, player.state.duration],
    () => {
      const { duration, currentTime, playing } = player.state
      let value = -1
      if (prefs.taskbarProgress && playing && duration > 0) {
        value = Math.min(1, Math.max(0, currentTime / duration))
      }
      // 量化到 1%：timeupdate 每秒会来好几次，原值推过去就是每秒几十次 IPC
      const q = value < 0 ? -1 : Math.round(value * 100) / 100
      if (q === lastPushed) return
      lastPushed = q
      void n?.taskbar?.setProgress(q)
    },
  )

  /* ---------------- 防休眠（2.10） ---------------- */

  const applyKeepAwake = (): void => {
    void n?.power?.keepAwake(Boolean(prefs.preventSleep && player.state.playing))
  }
  applyKeepAwake()
  watch(() => [player.state.playing, prefs.preventSleep], applyKeepAwake)

  /* ---------------- 启动自动播放（2.12） ---------------- */

  /**
   * 只在用户开了这个开关时才恢复队列。
   *
   * 关着的时候不恢复：一个「没点过播放却自己出声」的应用比什么都吓人。
   * 但队列本身仍然在 play() 之后被持久化，下次手动点播放还是接得上。
   */
  // 静默检查更新（6.9）：不弹窗、不自动下载，只在有新版本时提示一下
  useUpdater().maybeAutoCheck()

  if (prefs.autoPlayOnStart && restoreQueue()) {
    const item = player.state.queue[player.state.index]
    if (item) void player.play(item)
  }
}
