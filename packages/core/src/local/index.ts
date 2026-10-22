/**
 * 本地音乐（从网易云下载目录等处导入）
 *
 * 这一层只做**纯字符串与数组运算**：文件名解析、扩展名判定、分组、转成 MusicItem。
 * 真正的目录遍历在宿主（Electron 主进程）里做 —— 内核不能碰 fs。
 *
 * 为什么走「扫目录」而不是「调网易云接口」：
 *   - 接口要登录态（MUSIC_U cookie），会过期，用户还得先登录
 *   - 下载目录是用户自己机器上的既成事实，不需要任何授权
 *   - 网易云下载的文件名规则就是 `歌手 - 歌名.ext`，信息够用
 *
 * 加密封装（.ncm 等）不在内核里解密：内核不能碰 fs，也不该依赖 Node 的 crypto。
 * 解密发生在**桌面端主进程**（electron/ncm.cjs），扫目录时就把 .ncm 还原成
 * mp3/flac 写进缓存目录，再把结果当作普通音频交给这里。所以这一层看到的
 * 永远是「能播的文件」；解不开的会保留原扩展名，由 summarizeScan 如实统计。
 */
import type { MusicItem } from '../types'

/** 能直接播的音频扩展名（Chromium 与 RN TrackPlayer 的交集，偏保守） */
export const AUDIO_EXTS = [
  'mp3', 'flac', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wav', 'wma', 'ape', 'aiff', 'aif',
] as const

/**
 * 加密封装格式。列全是为了**能给出准确的提示**，而不是静默忽略：
 * 用户看到「扫到 17 首、导入 19 首」会以为漏了，得说清那 17 首是什么。
 */
export const ENCRYPTED_EXTS = [
  'ncm', // 网易云
  'kgm', 'kgma', // 酷狗
  'qmc0', 'qmc2', 'qmc3', 'qmcflac', 'qmcogg', 'mflac', 'mflac0', 'mgg', 'mgg1', // QQ 音乐
  'tm0', 'tm2', 'tm3', 'tm6', 'xm', // 其他平台
] as const

const AUDIO_SET = new Set<string>(AUDIO_EXTS)
const ENCRYPTED_SET = new Set<string>(ENCRYPTED_EXTS)

/** 取扩展名（小写，不含点）。没有扩展名返回空串 */
export function fileExt(name: string): string {
  const base = String(name ?? '')
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || dot === base.length - 1) return ''
  return base.slice(dot + 1).toLowerCase()
}

/** 去掉扩展名的文件名 */
export function fileBase(name: string): string {
  const base = String(name ?? '')
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}

export function isAudioFile(name: string): boolean {
  return AUDIO_SET.has(fileExt(name))
}

export function isEncryptedFile(name: string): boolean {
  return ENCRYPTED_SET.has(fileExt(name))
}

/**
 * 从文件名解析歌手与歌名。
 *
 * 网易云客户端的下载命名是 `歌手 - 歌名.ext`（多位歌手用 `,` 或 `/` 连接）。
 * 用**第一个** ` - ` 分割：歌名里出现连字符的情况（`歌手 - 歌名 - Live`）远比
 * 歌手名里出现连字符常见，所以切开后剩下的全部归歌名。
 *
 * 没有分隔符时整串当歌名、歌手留空 —— 由调用方决定显示成「未知歌手」，
 * 而不是在这里编一个名字出来。
 */
export function parseTrackName(fileName: string): { title: string; singer: string } {
  // 全角连字符与长破折号都当分隔符：不同来源打出来的标签不统一
  const base = fileBase(fileName).replace(/[－—–]/g, '-')
  const at = base.indexOf(' - ')
  if (at > 0) {
    const singer = base.slice(0, at).trim()
    const title = base.slice(at + 3).trim()
    if (singer && title) return { title, singer }
  }
  return { title: base.trim(), singer: '' }
}

/**
 * 目录扫描得到的一个文件（宿主负责填）。
 *
 * `title` / `artist` / `album` / `hasCover` 来自**文件内嵌标签**（PARITY 4.8），
 * 不是每个文件都有。没有时退回文件名解析 —— 网易云下载的文件名本来就带
 * `歌手 - 歌名`，两条路都能出结果，只是标签更准（专辑名、多人合作都对）。
 */
export interface LocalFileEntry {
  /** 绝对路径 */
  path: string
  /** 文件名（含扩展名） */
  name: string
  /** 字节数 */
  size: number
  /** 修改时间，毫秒 */
  mtime: number
  /** 内嵌标签里的歌名 */
  title?: string
  /** 内嵌标签里的歌手 */
  artist?: string
  /** 内嵌标签里的专辑 */
  album?: string
  /** 有没有内嵌封面（有的话封面走 lxmn-media://cover/ 按需读） */
  hasCover?: boolean
}

/** 按所在目录分好组的扫描结果 */
export interface LocalGroup {
  /** 组名：子目录名；根目录用目录本身的 basename */
  name: string
  /** 该组的目录绝对路径 */
  dir: string
  files: LocalFileEntry[]
}

/** 本地曲目的稳定 id：路径就是身份 */
export function localTrackId(path: string): string {
  return 'local:' + String(path ?? '')
}

/**
 * 生成渲染进程可用的媒体地址。
 *
 * 不能直接用 `file://` —— 开发模式页面在 http://localhost，Chromium 会
 * 把 file:// 资源当成跨源拦掉（生产模式是 file:// 页面，反而能放，
 * 于是变成「打包后能播、dev 里不能播」的怪现象）。统一走自定义协议，
 * 由主进程按 Range 读文件，两种模式行为一致。
 */
export const LOCAL_MEDIA_SCHEME = 'lxmn-media'

export function localMediaUrl(path: string): string {
  return `${LOCAL_MEDIA_SCHEME}://local/${encodeURIComponent(String(path ?? ''))}`
}

/**
 * 内嵌封面的地址。
 *
 * 不把图片 base64 塞进扫描结果：一个目录几百首、每张封面几十到几百 KB，
 * 一次扫描就能把 IPC 报文推到几十 MB。这里只给地址，界面真显示时才去读。
 */
export function localCoverUrl(path: string): string {
  return `${LOCAL_MEDIA_SCHEME}://cover/${encodeURIComponent(String(path ?? ''))}`
}

/** 从媒体地址还原出文件路径（主进程侧用，测试里也用） */
export function pathFromMediaUrl(url: string): string {
  const raw = String(url ?? '')
  const prefix = `${LOCAL_MEDIA_SCHEME}://local/`
  if (!raw.startsWith(prefix)) return ''
  try {
    return decodeURIComponent(raw.slice(prefix.length))
  } catch {
    return ''
  }
}

export interface BuildLocalOptions {
  /** 该组对应的目录，用来给「没有歌手」的歌补一点上下文 */
  dir?: string
  /** 同名 .lrc 的内容，按文件路径索引 */
  lyrics?: Record<string, string>
}

/**
 * 把扫描到的文件转成 MusicItem。
 *
 * 调用方负责先过滤掉非音频与加密文件 —— 这里再挡一次是防御性的：
 * 这个函数会被两端直接调用，漏过滤会变成「列表里有歌、点了放不出来」。
 */
export function buildLocalTracks(files: readonly LocalFileEntry[], options: BuildLocalOptions = {}): MusicItem[] {
  const lyrics = options.lyrics ?? {}
  const out: MusicItem[] = []
  for (const file of files) {
    if (!isAudioFile(file.name)) continue
    const parsed = parseTrackName(file.name)
    // 标签优先、文件名兜底：两者都空才算没名字（例如 `01.mp3` 这种纯编号）
    const title = String(file.title ?? '').trim() || parsed.title
    const singer = String(file.artist ?? '').trim() || parsed.singer
    if (!title) continue
    out.push({
      id: localTrackId(file.path),
      source: 'local',
      songmid: file.path,
      name: title,
      singer: singer || '未知歌手',
      url: localMediaUrl(file.path),
      path: file.path,
      size: file.size,
      mtime: file.mtime,
      ...(file.album ? { albumName: String(file.album) } : {}),
      ...(file.hasCover ? { picUrl: localCoverUrl(file.path) } : {}),
      // 歌词在导入时就一并带进来：本地文件不需要再发请求，
      // 播放时内核的 getLyric 直接返回它，省一次 IO 往返
      ...(lyrics[file.path] ? { lyric: lyrics[file.path] } : {}),
    })
  }
  return out
}

/** 目录 basename（兼容 Windows 反斜杠与 POSIX 斜杠，不依赖 node:path） */
export function dirBaseName(dir: string): string {
  const s = String(dir ?? '').replace(/[\\/]+$/, '')
  const at = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'))
  return at >= 0 ? s.slice(at + 1) : s
}

/** 文件所在目录（同样不依赖 node:path，内核要能在浏览器里跑） */
export function dirOf(path: string): string {
  const s = String(path ?? '')
  const at = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'))
  return at > 0 ? s.slice(0, at) : ''
}

/**
 * 按所在目录分组。
 *
 * 网易云下载目录通常是平铺的，但「按歌单分目录」开启后会是
 * `下载目录/<歌单名>/歌.mp3` —— 那种结构天然就是「一个目录 = 一个歌单」，
 * 分组后可以一次导入成多个歌单，而不是糊成一坨。
 */
export function groupLocalFiles(files: readonly LocalFileEntry[], rootDir = ''): LocalGroup[] {
  const map = new Map<string, LocalFileEntry[]>()
  for (const file of files) {
    const dir = dirOf(file.path)
    const list = map.get(dir)
    if (list) list.push(file)
    else map.set(dir, [file])
  }
  const root = String(rootDir ?? '').replace(/[\\/]+$/, '')
  const groups: LocalGroup[] = []
  for (const [dir, list] of map) {
    const isRoot = !root || dir === root
    groups.push({
      name: isRoot ? dirBaseName(dir) || '本地音乐' : dirBaseName(dir),
      dir,
      files: list,
    })
  }
  // 根目录的排最前：用户最常导入的就是它。
  // 其余按码点比较，不用 localeCompare —— 后者的结果取决于运行环境的 ICU
  // 排序规则（中文拼音 / 英文前缀的先后会变），测试和两端表现都会飘。
  groups.sort((a, b) => {
    const ar = root && a.dir === root ? 0 : 1
    const br = root && b.dir === root ? 0 : 1
    if (ar !== br) return ar - br
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  })
  return groups
}

export interface LocalScanSummary {
  /** 能导入的音频数 */
  playable: number
  /** 加密文件数（.ncm 等） */
  encrypted: number
  /** 其他被忽略的文件数（图片、txt、lrc 等） */
  ignored: number
  /** 加密文件按扩展名统计，用于给用户解释 */
  encryptedByExt: Record<string, number>
  /** 已就地解密的文件数（目前是 .ncm，由桌面端主进程解出 mp3/flac） */
  decoded: number
}

/** 统计一次扫描结果，用于界面上的「扫到 N 首，跳过 M 个加密文件」 */
export function summarizeScan(entries: readonly { name: string; decodedFrom?: string }[]): LocalScanSummary {
  let playable = 0
  let encrypted = 0
  let ignored = 0
  let decoded = 0
  const encryptedByExt: Record<string, number> = {}
  for (const e of entries) {
    if (isAudioFile(e.name)) {
      playable++
      if (e.decodedFrom) decoded++
      continue
    }
    if (isEncryptedFile(e.name)) {
      encrypted++
      const ext = fileExt(e.name)
      encryptedByExt[ext] = (encryptedByExt[ext] ?? 0) + 1
      continue
    }
    ignored++
  }
  return { playable, encrypted, ignored, encryptedByExt, decoded }
}
