/**
 * 保存文件（歌词导出 / 音频下载）
 *
 * Electron 里走主进程：能弹系统「另存为」对话框，也能绕过渲染层的 CORS 抓音频。
 * 浏览器里退化成 <a download>，功能仍在（只是不能选目录）。
 */

interface SaveResult {
  ok: boolean
  path?: string
  size?: number
  error?: string
  canceled?: boolean
}

interface SaveBridge {
  saveFile?: (payload: {
    filename: string
    content?: string
    url?: string
    /** 给了目录就直接存，不再弹「另存为」 */
    dir?: string
  }) => Promise<SaveResult>
}

function bridge(): SaveBridge | undefined {
  return (globalThis as unknown as { lxmnNative?: SaveBridge }).lxmnNative
}

/**
 * 记住上次保存到哪个目录。
 *
 * 每首都弹一次「另存为」在批量下载时是灾难（lx-music 也是给一个下载目录，
 * 之后静默落盘）。第一次让用户选，之后直接进那个目录。
 */
const DIR_KEY = 'lxmn.save.dir'

export function savedDir(): string {
  try {
    return localStorage.getItem(DIR_KEY) ?? ''
  } catch {
    return ''
  }
}

export function setSavedDir(dir: string): void {
  try {
    if (dir) localStorage.setItem(DIR_KEY, dir)
  } catch {
    // 隐私模式写不进去，只影响下次要不要再弹框
  }
}

/** 从完整路径里剥掉文件名，拿到目录（Windows / POSIX 分隔符都处理） */
function dirOf(filePath: string): string {
  const at = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return at > 0 ? filePath.slice(0, at) : ''
}

/** 保存成功且是用户手选的路径时，记住目录供下次使用 */
function remember(res: SaveResult): SaveResult {
  if (res.ok && res.path) setSavedDir(dirOf(res.path))
  return res
}

/** 文件名里不能出现的字符统一换掉，否则 Windows 会直接报错 */
export function safeFileName(name: string, fallback = 'lyco'): string {
  const cleaned = String(name ?? '')
    .replace(/[\\/:*?"<>|\r\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.slice(0, 120) || fallback
}

/** 浏览器兜底：造一个临时链接点一下 */
function downloadInBrowser(filename: string, href: string): void {
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/** 保存文本（.lrc 等） */
export async function saveText(filename: string, content: string): Promise<SaveResult> {
  const b = bridge()
  if (b?.saveFile) return remember(await b.saveFile({ filename, content, dir: savedDir() || undefined }))
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    downloadInBrowser(filename, url)
    return { ok: true }
  } finally {
    // 给浏览器一点时间把下载发起来，再回收
    setTimeout(() => URL.revokeObjectURL(url), 10000)
  }
}

/** 保存远程文件（音频） */
export async function saveUrl(filename: string, url: string): Promise<SaveResult> {
  const b = bridge()
  if (b?.saveFile) return remember(await b.saveFile({ filename, url, dir: savedDir() || undefined }))
  downloadInBrowser(filename, url)
  return { ok: true }
}

/** 按 URL 猜扩展名，猜不到就按音质给 mp3 */
export function audioExt(url: string): string {
  const m = /\.(mp3|flac|m4a|aac|wav|ogg|ape)(?:$|\?)/i.exec(url)
  return m?.[1]?.toLowerCase() ?? 'mp3'
}
