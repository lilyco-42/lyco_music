/**
 * 本地音乐音源
 *
 * 它不是「一个音源」，而是让播放链路能把本机文件当成普通曲目对待：
 * 内核的 resolveStream / loadLyric / loadPic 都只认 `MusicSource`，
 * 给它一个实现，本地歌就和在线歌走完全同一条路径，不需要在播放器里
 * 到处写 `if (source === 'local')`。
 *
 * 三个刻意的取舍：
 *   1. **不发任何网络请求。** url 在导入时就算好了（`lxmn-media://…`），
 *      歌词也是导入时连同文件一起读进来的。
 *   2. **取不到就抛错，不兜底。** 本地文件失败只可能是文件被删了或格式不支持，
 *      跨源去搜一首同名的在线歌，会让用户以为本地文件放出来了。
 *      （fallback.ts 里有对应的短路）
 *   3. **不提供 musicSearch。** 本地库没有搜索语义，列表就是全部。
 */
import type { MusicSource, Quality } from '../types'
import { fileExt } from '../local'
import { registerSource, setSupportQuality } from './registry'

/** 按扩展名推断一个「像样的」音质标签，只影响界面显示 */
function qualityOf(path: string): Quality {
  switch (fileExt(path)) {
    case 'flac':
    case 'ape':
    case 'wav':
    case 'aiff':
    case 'aif':
      return 'flac'
    default:
      return '320k'
  }
}

export const localSource: MusicSource = {
  id: 'local',
  name: '本地音乐',

  async getMusicUrl(item) {
    const url = String(item.url ?? '')
    if (!url) throw new Error('本地文件缺少地址，请重新导入')
    const path = String(item.path ?? '')
    return { url, quality: qualityOf(path), type: fileExt(path) || 'mp3' }
  },

  async getLyric(item) {
    // 导入时读进来的同名 .lrc；没有就是空歌词，不是错误
    return { lyric: String(item.lyric ?? '') }
  },

  async getPic(item) {
    return { url: String(item.picUrl ?? '') }
  },
}

/** 注册进内核音源表 */
export function installLocalSource(): void {
  registerSource('local', localSource)
  setSupportQuality('local', ['flac', '320k'])
}
