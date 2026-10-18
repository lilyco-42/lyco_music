/**
 * MusicItem -> 脚本要的 musicInfo
 *
 * 两边字段名对不上，这是必须显式处理的差异：
 *
 *   我们的 MusicItem        lx 脚本期望的 musicInfo
 *   ------------------      ----------------------
 *   id / songmid            songmid, songId, id, musicId
 *   hash                    hash
 *   contentId (mg)          songId, id
 *   copyrightId (mg)        copyrightId
 *   albumId                 albumId
 *
 * 脚本作者各写各的，同一个字段在不同脚本里叫法不同（songId / musicId /
 * musicrid / rid）。与其猜，不如把已知别名一次性铺满 —— 脚本按自己的
 * 习惯取值都能命中，而多余的字段它不会看。
 *
 * 有一个坑：酷我脚本常用 musicrid，且格式是 "MUSIC_<id>"；而我们的
 * songmid 是裸数字。两种都放上，让脚本自己挑。
 */
import type { MusicItem } from '../../types'
import type { LxMusicInfo } from './runtime'

export function toMusicInfo(item: MusicItem): LxMusicInfo {
  const id = item.id === undefined || item.id === null ? '' : String(item.id)
  const songmid = item.songmid === undefined || item.songmid === null ? id : String(item.songmid)
  const hash = typeof item.hash === 'string' ? item.hash : ''
  const contentId = typeof item.contentId === 'string' ? item.contentId : ''

  const info: LxMusicInfo = {
    // 通用
    songmid,
    songId: contentId || songmid,
    musicId: songmid,
    id: songmid,
    // 酷我：脚本既可能读 musicrid 也可能读 rid，且可能带 MUSIC_ 前缀
    rid: songmid,
    musicrid: songmid ? 'MUSIC_' + songmid : '',

    name: item.name,
    singer: item.singer,
    albumName: item.albumName,
    albumId: item.albumId === undefined ? undefined : String(item.albumId),
    interval: item.interval === undefined ? undefined : String(item.interval),
  }

  /**
   * hash 只在真的有时才放。
   *
   * 这是个很隐蔽的坑：脚本普遍写 `musicInfo.hash ?? musicInfo.songmid ?? musicInfo.id`。
   * ?? 只跳过 null/undefined，**不跳过空字符串**。如果给没有 hash 的音源
   * （网易/酷我/咪咕）塞一个 hash: ''，脚本拿到的 songId 就是 ''，
   * 于是报「无法获取歌曲ID」—— 明明 songmid 就在旁边。
   *
   * 所以没有 hash 就干脆不给这个字段，让 ?? 落到下一个。
   */
  if (hash) info.hash = hash

  if (contentId) info.contentId = contentId
  if (typeof item.copyrightId === 'string') info.copyrightId = item.copyrightId
  if (typeof item.picUrl === 'string') info.picUrl = item.picUrl

  // 把原始条目也挂上：个别脚本会读 qualitys 里的 hash
  if (item.qualitys) info.qualitys = item.qualitys

  return info
}
