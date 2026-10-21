/**
 * 歌词的「展示态」。
 *
 * 原始歌词（LRC 文本）和用户想看到的东西之间隔着一层用户设置：
 * 繁简转换（3.4）与时间偏移（3.5）。三个界面（播放栏、播放页、桌面歌词）
 * 都要走这一步，所以集中在这里 —— 任何一处漏掉，表现就是
 * 「同一个设置在这个页面生效、在另一个页面不生效」。
 */
import { parseLyric, shiftLyric, toTraditional, type ParsedLyric } from '@lxmn/core'
import { prefs } from './prefs'

export function viewLyric(
  lyric: string | null | undefined,
  tlyric?: string | null,
  romalrc?: string | null,
  yrc?: string | null,
): ParsedLyric {
  const s2t = prefs.lyricS2T
  const parsed = parseLyric(
    s2t ? toTraditional(lyric ?? '') : lyric,
    s2t && tlyric ? toTraditional(tlyric) : tlyric,
    // 罗马音是拉丁字母，转换没有意义，但混排里偶尔有汉字注音，一起转了更一致
    s2t && romalrc ? toTraditional(romalrc) : romalrc,
    // yrc 只提供逐字时间轴，文本仍以 lrc 为准（见 core/lyric.ts 的说明），
    // 所以不转换它 —— 转了反而会让时间轴和文本对不上
    yrc,
  )
  return prefs.lyricOffset ? shiftLyric(parsed, prefs.lyricOffset) : parsed
}
