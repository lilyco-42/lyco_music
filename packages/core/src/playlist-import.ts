/**
 * 网易云歌单导入 → 本地曲库（跨端共用）
 *
 * 桌面端（apps/desktop/src/lib/playlist-import.ts）和移动端（MyMusicScreen）
 * 都要做同一件事：解析用户粘贴的链接/短链 → 拉歌单详情 → 建一个自建歌单 →
 * 逐首塞进去。这段逻辑跟 UI 没关系，放在核心里两端共用，避免两边各写一遍
 * 然后行为慢慢走偏。
 *
 * 刻意**不做**逐首跨源搜索：播放链路本来就有三层兜底（内置源 → 脚本源 →
 * 跨源匹配），导入时再搜一遍既慢又容易把「搜到了但不是这首」写进歌单。
 * 导入要秒级完成，脏数据交给播放时兜底。
 */
import type { MusicItem } from './types'
import { Library } from './library'
import { fetchWyPlaylist, resolvePlaylistId } from './sources/wy/playlist'

export interface WyImportResult {
  /** 歌单名（来自网易云） */
  name: string
  /** 歌单里一共多少首（网易云报的数） */
  total: number
  /** 实际写进曲库多少首（去重后） */
  added: number
  /** 新建的本地歌单 id */
  playlistId: string
}

/**
 * 导入一个网易云歌单到曲库。
 *
 * @param text 用户粘的任意文本：歌单链接、纯数字 id、或客户端分享的
 *             163cn.tv 短链文案都行。
 * @param library 目标曲库（桌面/移动各自持有的那个单例）
 */
export async function importWyPlaylistToLibrary(
  text: string,
  library: Library,
): Promise<WyImportResult> {
  const id = await resolvePlaylistId(text)
  const detail = await fetchWyPlaylist(id)
  if (!detail.tracks.length) {
    throw new Error('这个歌单里没有可读取的歌曲（可能是私密歌单或已下架）')
  }

  // 必须先 load()，否则 persist 会把空库写回去，抹掉用户原有数据
  await library.load()
  const pl = await library.createPlaylist(detail.name.slice(0, 40))
  let added = 0
  for (const item of detail.tracks as MusicItem[]) {
    if (await library.addToPlaylist(pl.id, item)) added++
  }
  return {
    name: pl.name,
    total: detail.total || detail.tracks.length,
    added,
    playlistId: pl.id,
  }
}
