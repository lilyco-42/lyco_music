/** 音乐源统一数据模型 —— 桌面/移动共用 */

/**
 * 音源标识。
 *
 * `local` 是本机文件（从网易云下载目录等处导入），它不联网、没有搜索、
 * 也不参与串源兜底 —— 见 sources/local.ts 与 fallback.ts 的短路判断。
 */
export type SourceId = 'kw' | 'kg' | 'tx' | 'wy' | 'mg' | 'bd' | 'xm' | 'local'

export type Quality = '128k' | '320k' | 'flac' | 'flac24bit' | 'hires' | 'atmos' | 'master'

export interface MusicSourceMeta {
  name: string
  id: SourceId
}

export interface MusicItem {
  id: string | number
  name: string
  singer: string
  albumName?: string
  albumId?: string | number
  source: SourceId
  interval?: string | number
  qualitys?: Partial<Record<Quality, unknown>>
  picUrl?: string
  songmid?: string | number
  hash?: string
  copyrightId?: string
  [k: string]: unknown
}

export interface SearchResult {
  list: MusicItem[]
  total: number
  limit: number
  page: number
  source: SourceId
  allPage?: number
}

export interface LyricInfo {
  lyric: string
  tlyric?: string
  rlyric?: string
  /** 罗马音歌词（网易接口的 romalrc） */
  romalrc?: string
  /**
   * 逐字歌词（网易接口的 yrc）。
   * 格式：`[起始ms,时长ms,0](字起始ms,字时长ms,0)字...`，
   * 用来做「唱到哪个字哪个字变色」。
   */
  ylyric?: string
  lxlyric?: string
}

export interface MusicUrlInfo {
  url: string
  quality: Quality
  type?: string
  size?: number
  urls?: string[]
}

export interface PicInfo {
  url: string
}

/** 一条评论 */
export interface MusicComment {
  id: string
  /** 正文 */
  content: string
  /** 昵称 */
  userName: string
  /** 头像 URL（可能为空） */
  avatar?: string
  /** 点赞数 */
  likedCount: number
  /** 时间戳（毫秒），缺失为 0 */
  time: number
  /** 楼中楼回复数 */
  replyCount?: number
  /** 是否被作者置顶/热评 */
  hot?: boolean
  /** 所在楼层（网易云有，便于展示「xx 楼」） */
  floor?: number
}

export interface CommentResult {
  list: MusicComment[]
  total: number
  /** 是否有更多 */
  more: boolean
  page: number
  limit: number
}

/**
 * 音源实现。
 *
 * 与原 lx-music 的差异：原 index.js 导出的对象里 leaderboard / songList /
 * hotSearch / comment 都是**可选**能力（各平台实现程度不同），且 getMusicUrl
 * 是通过 apis('wy') 间接取到的。这里把必需能力收窄为「取地址/取词/取图」，
 * 其余按需实现，宿主再通过 registerSource 注入。
 */
export interface MusicSource {
  id: SourceId
  name: string

  /** 取播放地址（必需） */
  getMusicUrl(item: MusicItem, quality: Quality): Promise<MusicUrlInfo>
  /** 取歌词（必需） */
  getLyric(item: MusicItem): Promise<LyricInfo>
  /** 取封面（必需） */
  getPic(item: MusicItem): Promise<PicInfo>

  /** 搜索（可选：部分音源仅支持榜单/歌单） */
  musicSearch?(keyword: string, page: number, limit: number): Promise<SearchResult>
  /** 评论（可选：目前只有网易云有公开接口） */
  getComments?(item: MusicItem, page: number, limit: number): Promise<CommentResult>
  /** 歌曲详情页地址（可选） */
  getMusicDetailPageUrl?(item: MusicItem): string
  /** 初始化（可选） */
  init?(): Promise<void>
}
