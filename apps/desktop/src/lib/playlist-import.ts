/**
 * 网易云歌单导入（9.5）
 *
 * 这里刻意**不做「逐首搜别的源」**：我们的播放链路本来就有三层静默兜底
 * （内置源 → 脚本源 → 跨源匹配），导入时把网易云的元数据原样存下来，
 * 播放时哪家能给流就用哪家。这样：
 *   - 导入是秒级的，不用为 50 首歌发起 50 次搜索；
 *   - 会员/下架歌不会在导入阶段就被判死，播放时还有兜底；
 *   - 歌名/歌手/专辑/封面都与用户在网易云看到的完全一致。
 */
import { fetchWyPlaylist, parsePlaylistId } from '@lxmn/core'
import { library } from './sync'

export interface ImportResult {
  name: string
  /** 歌单里共有多少首 */
  total: number
  /** 实际写进曲库多少首 */
  added: number
  /** 新建歌单的 id，便于界面跳过去 */
  playlistId: string
}

export async function importWyPlaylist(text: string): Promise<ImportResult> {
  const id = parsePlaylistId(text)
  if (!id) throw new Error('没找到歌单 id：请粘歌单链接，或直接粘那串数字')

  const detail = await fetchWyPlaylist(id)
  if (!detail.tracks.length) throw new Error('这个歌单里没有可读取的歌曲（可能是私密歌单）')

  await library.load()
  const pl = await library.createPlaylist(detail.name.slice(0, 40))
  let added = 0
  for (const item of detail.tracks) {
    // 同一首歌重复时 addToPlaylist 返回 false，这里不当作失败
    const ok = await library.addToPlaylist(pl.id, item)
    if (ok) added++
  }
  return { name: pl.name, total: detail.total || detail.tracks.length, added, playlistId: pl.id }
}
