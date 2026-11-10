/**
 * 网易云歌单导入（9.5）—— 桌面端薄封装
 *
 * 真正的逻辑在 @lxmn/core 的 importWyPlaylistToLibrary()：解析链接/短链 →
 * 拉详情 → 建自建歌单 → 逐首入库。这里只把桌面端的 library 单例塞进去，
 * 顺便保持原来的 ImportResult 形状，界面和 scheme 入口都不用改。
 *
 * 为什么不做「逐首搜别的源」：播放链路本来就有三层静默兜底（内置源 →
 * 脚本源 → 跨源匹配），导入时把网易云的元数据原样存下来，播放时哪家能给
 * 流就用哪家。这样导入是秒级的，会员/下架歌也不会在导入阶段就被判死。
 */
import { importWyPlaylistToLibrary, type WyImportResult } from '@lxmn/core'
import { library } from './sync'

export type ImportResult = WyImportResult

export async function importWyPlaylist(text: string): Promise<ImportResult> {
  return importWyPlaylistToLibrary(text, library)
}
