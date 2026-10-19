/**
 * 桌面歌词桥：把主窗口的播放状态推给独立的歌词窗口。
 *
 * 为什么由主窗口推：歌词窗口是另一个渲染进程，拿不到主窗口的 store。
 * 让它自己再取一次歌词/再算一次进度，会两边不同步（尤其是 seek 之后）。
 *
 * 推送频率：timeupdate 大约 4 次/秒，这里再压到 ~5 次/秒上限，
 * 避免 IPC 把歌词窗口的渲染打满。
 */
import { usePlayer } from './player'

interface Payload {
  name?: string
  singer?: string
  lyric?: string
  tlyric?: string
  currentTime?: number
  playing?: boolean
}

let installed = false
let lastPush = 0

export function installLyricBridge(): void {
  if (installed) return
  const api = typeof window !== 'undefined' ? window.lxmnNative?.lyric : undefined
  if (!api) return
  /**
   * 关键：歌词窗口加载的是同一份前端包，main.ts 也会执行到这里。
   * 如果它自己也装桥，就会用「空的本地 store」每 200ms 推一次空歌词，
   * 把主窗口推来的真实歌词冲掉（现象：歌词窗口一直是空态）。
   */
  if (typeof window !== 'undefined' && window.location.hash.includes('lyric-window')) {
    installed = true
    return
  }
  installed = true

  const player = usePlayer()

  const push = (force = false): void => {
    const now = Date.now()
    if (!force && now - lastPush < 200) return
    lastPush = now
    const payload: Payload = {
      name: player.current.value?.name ?? '',
      singer: player.current.value?.singer ?? '',
      lyric: player.state.lyric,
      tlyric: player.state.tlyric,
      currentTime: player.state.currentTime,
      playing: player.state.playing,
    }
    void api.update(payload)
  }

  // 进度/歌词/切歌都要同步；force 用于「切歌」这类关键变化
  const stop = playerWatch(() => {
    push()
  })
  void stop
  push(true)
}

/**
 * 用轮询而不是 Vue watch：player.state 是 readonly 的 reactive 对象，
 * 逐字段 watch 会漏（比如串源后 lyric 先清空再赋值）。
 * 200ms 轮询对 CPU 几乎无感，且永远不会漏状态。
 */
function playerWatch(cb: () => void): () => void {
  const timer = window.setInterval(cb, 200)
  return () => window.clearInterval(timer)
}
