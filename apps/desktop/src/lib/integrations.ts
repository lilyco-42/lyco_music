/**
 * 系统集成（渲染层）：托盘已由 shell.ts 接好，这里只补三块
 *
 *   - 6.5 开放 API：主进程起 HTTP 服务，命令转给渲染层执行（播放状态只有这一份）
 *   - 6.6 Scheme URL：lxmusic://… 唤起播放/搜索；冷启动、第二实例、macOS 三条路都归这里
 *   - 6.8 HTTP 代理：把偏好同步给 session 级代理（音频流也走代理，不会只通接口）
 *
 * 为什么要归到一个模块：这三块都要读「当前播放状态」，散开写就会出现
 * 三份各自节流的广播，托盘菜单和 API 的状态还会短暂不一致。
 */
import type { Router } from 'vue-router'
import { watch } from 'vue'
import { parseLyric, findLineIndex, type MusicItem } from '@lxmn/core'
import { usePlayer } from './player'
import { library } from './sync'
import { prefs } from './prefs'
import { toast } from './toast'

function native(): Window['lxmnNative'] | undefined {
  return typeof window === 'undefined' ? undefined : window.lxmnNative
}

let installed = false

/** API 的 /status 报文 */
function statusPayload() {
  const p = usePlayer()
  const it = p.current.value
  return {
    playing: p.state.playing,
    loading: p.state.loading,
    name: it?.name ?? '',
    singer: it?.singer ?? '',
    album: it?.albumName ?? '',
    source: it?.source ?? '',
    quality: p.state.quality,
    currentTime: Math.round(p.state.currentTime * 10) / 10,
    duration: Math.round(p.state.duration),
    volume: Math.round(p.state.volume * 100),
    muted: p.state.volume === 0,
    favorite: it ? library.isFavorite(it) : false,
  }
}

/** 当前这一句歌词（/lyric） */
function currentLyric(): { time: number; text: string; index: number } {
  const p = usePlayer()
  const parsed = parseLyric(p.state.lyric, p.state.tlyric)
  const idx = findLineIndex(parsed.lines, p.state.currentTime)
  const line = parsed.lines[idx]
  return { time: line?.time ?? 0, text: line?.text ?? '', index: idx }
}

function lyricAll(): { time: number; text: string }[] {
  const p = usePlayer()
  return parseLyric(p.state.lyric, p.state.tlyric).lines.map(l => ({ time: l.time, text: l.text }))
}

export function installIntegrations(router: Router): void {
  if (installed) return
  installed = true
  if (document.documentElement.dataset.window === 'lyric') return

  const n = native()
  const player = usePlayer()

  /* ---------------- 6.8 代理 ---------------- */

  const applyProxy = (): void => {
    void n?.proxy?.apply({ ...prefs.proxy })
  }
  applyProxy()
  watch(() => [prefs.proxy.enabled, prefs.proxy.host, prefs.proxy.port, prefs.proxy.username, prefs.proxy.password], applyProxy)

  /* ---------------- 6.5 开放 API ---------------- */

  let stateTimer: ReturnType<typeof setTimeout> | undefined
  const pushState = (): void => {
    if (!prefs.api.enabled) return
    if (stateTimer) return
    // 250ms 节流：currentTime 每秒来好几次，原样推过去会让 SSE 通道刷屏
    stateTimer = setTimeout(() => {
      stateTimer = undefined
      void n?.api?.pushState(statusPayload())
    }, 250)
  }
  watch(
    () => [player.state.playing, player.state.index, player.state.currentTime, player.state.volume, player.state.quality, player.state.duration],
    pushState,
  )

  const syncApiServer = async (): Promise<void> => {
    if (!n?.api) return
    if (!prefs.api.enabled) {
      await n.api.setEnabled({ enabled: false })
      return
    }
    const r = await n.api.setEnabled({ enabled: true, port: prefs.api.port })
    if (!r?.running) {
      // 端口被占用等情况：关掉开关并把原因写回偏好，界面上才看得见
      prefs.api.enabled = false
      prefs.api.lastError = r?.error || '端口无法监听'
      return
    }
    prefs.api.lastError = ''
    pushState()
  }
  void syncApiServer()
  watch(() => [prefs.api.enabled, prefs.api.port], () => { void syncApiServer() })

  n?.api?.onCommand(async payload => {
    const { id, cmd, args } = (payload ?? {}) as { id: number; cmd: string; args?: Record<string, unknown> }
    try {
      let result: unknown = { ok: true }
      switch (cmd) {
        case 'play': player.toggle(); break
        case 'pause': if (player.state.playing) player.toggle(); break
        case 'next': await player.next(); break
        case 'prev': await player.prev(); break
        case 'seek': player.seek(Number(args?.time) || 0); break
        case 'volume': player.setVolume(Math.max(0, Math.min(1, (Number(args?.value) || 0) / 100))); break
        // toggleMute 是「切换」语义：只有期望状态和当前不符时才调
        case 'mute': {
          const wantMuted = Boolean(args?.value)
          const isMuted = player.state.volume === 0
          if (wantMuted !== isMuted) player.toggleMute()
          break
        }
        case 'collect': {
          const it = player.current.value
          if (it && library.isFavorite(it) !== Boolean(args?.value)) await library.toggleFavorite(it)
          break
        }
        case 'lyric': result = currentLyric(); break
        case 'lyricAll': result = lyricAll(); break
        default: throw new Error('未知命令: ' + cmd)
      }
      await n?.api?.reply(id, result)
    } catch (e) {
      await n?.api?.reply(id, { ok: false, error: e instanceof Error ? e.message : String(e) })
    }
  })

  /* ---------------- 6.6 Scheme URL ---------------- */

  const playFromLink = (item: { source?: string; songmid?: string; name?: string; singer?: string }): void => {
    const track: MusicItem = {
      id: String(item.songmid ?? ''),
      source: String(item.source ?? 'wy') as MusicItem['source'],
      songmid: String(item.songmid ?? ''),
      name: String(item.name || '未知歌曲'),
      singer: String(item.singer || ''),
    }
    void player.play(track)
  }

  n?.scheme?.onLink(async payload => {
    const p = payload as
      | { kind: 'player'; action: string }
      | { kind: 'search'; keyword: string }
      | { kind: 'searchPlay'; keyword: string }
      | { kind: 'play'; item: { source?: string; songmid?: string; name?: string; singer?: string } }
      | { kind: 'songlist'; id: string }
      | null
    if (!p) return
    /**
     * 歌单导入（6.6 的 songlist/*）。
     *
     * 不做「先跳页面再让用户点确认」：链接本身就是用户的确认动作，
     * 再拦一道只会让人觉得「点了没反应」。导入结果用 toast 说清楚。
     */
    if (p.kind === 'songlist') {
      const id = String(p.id || '').trim()
      if (!id) return
      await router.push({ name: 'my' })
      try {
        const { importWyPlaylist } = await import('./playlist-import')
        const r = await importWyPlaylist(id)
        toast(`已导入「${r.name}」：${r.added} / ${r.total} 首`)
      } catch (e) {
        toast('导入歌单失败：' + (e instanceof Error ? e.message : String(e)))
      }
      return
    }
    if (p.kind === 'search' || p.kind === 'searchPlay') {
      const keyword = String(p.keyword || '').trim()
      if (!keyword) return
      await router.push({ name: 'search', query: { q: keyword } })
      if (p.kind === 'searchPlay') {
        const res = await player.search(keyword)
        const first = res.list[0]
        if (first) void player.play(first, res.list)
      }
      return
    }
    if (p.kind === 'play') {
      playFromLink(p.item)
      return
    }
    switch (p.action) {
      case 'play': if (!player.state.playing) player.toggle(); break
      case 'pause': if (player.state.playing) player.toggle(); break
      case 'toggleplay': player.toggle(); break
      case 'skipnext': await player.next(); break
      case 'skipprev': await player.prev(); break
      case 'collect': {
        const it = player.current.value
        if (it && !library.isFavorite(it)) await library.toggleFavorite(it)
        break
      }
      case 'uncollect': {
        const it = player.current.value
        if (it && library.isFavorite(it)) await library.toggleFavorite(it)
        break
      }
      case 'dislike': {
        const it = player.current.value
        if (it) await library.addDislikes([{ name: it.name, singer: it.singer }])
        break
      }
      default: break
    }
  })
}
