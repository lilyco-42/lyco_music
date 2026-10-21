/**
 * 本地音乐（Electron 主进程）
 *
 * 三件事：找网易云的目录、扫目录、把本机文件喂给 <audio>。
 *
 * 为什么必须走自定义协议 `lxmn-media://`：
 *   开发模式下页面在 http://localhost:5173，Chromium 会把 file:// 子资源
 *   当跨源拦掉；生产模式页面是 file://，反而能放。直接用 file:// 会变成
 *   「打包后能播、dev 里不能播」这种最难查的怪现象。自定义协议两种模式一致。
 *
 * 为什么必须自己处理 Range：
 *   Chromium 的媒体栈靠 206 + Content-Range 来跳转进度条。返回 200 整份文件
 *   也能播，但拖动会失效（甚至从头重新缓冲）。所以这里按 Range 切流。
 */
const { app, protocol } = require('electron')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { Readable } = require('node:stream')

const SCHEME = 'lxmn-media'
const PREFIX = `${SCHEME}://local/`

/** 扫目录时最多往下走几层。网易云按歌单分目录最多两层，4 层足够且能挡住误选整个盘 */
const MAX_DEPTH = 4
/** 单次扫描的文件数上限，防止用户选了 C:\ 把内存打满 */
const MAX_FILES = 20000

const AUDIO_EXTS = new Set([
  'mp3', 'flac', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wav', 'wma', 'ape', 'aiff', 'aif',
])
const ENCRYPTED_EXTS = new Set([
  'ncm', 'kgm', 'kgma', 'qmc0', 'qmc2', 'qmc3', 'qmcflac', 'qmcogg',
  'mflac', 'mflac0', 'mgg', 'mgg1', 'tm0', 'tm2', 'tm3', 'tm6', 'xm',
])

const MIME = {
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  wav: 'audio/wav',
  wma: 'audio/x-ms-wma',
  ape: 'audio/x-ape',
  aiff: 'audio/aiff',
  aif: 'audio/aiff',
}

function extOf(name) {
  const base = String(name || '')
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}

/**
 * 注册协议特权。
 *
 * 必须在 app ready **之前**调用，之后改就无效了 —— 这是 Electron 的硬性顺序。
 * `standard: false` 是刻意的：standard 模式会按 RFC 规范化 URL，把路径里的
 * `%5C`、盘符冒号之类的东西改得面目全非。这里宁愿自己拼字符串。
 * `stream: true` 让 <audio> 能拿到流（否则会整份下载完才开始播）。
 */
function registerScheme() {
  protocol.registerSchemesAsPrivileged([{
    scheme: SCHEME,
    privileges: { standard: false, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true },
  }])
}

/** 从 `lxmn-media://local/<encoded>` 还原文件路径 */
function pathFromUrl(url) {
  const raw = String(url || '')
  if (!raw.startsWith(PREFIX)) return ''
  try {
    return decodeURIComponent(raw.slice(PREFIX.length))
  } catch {
    return ''
  }
}

/** 装协议处理器（app ready 之后调用） */
function installProtocol() {
  protocol.handle(SCHEME, async request => {
    const filePath = pathFromUrl(request.url)
    if (!filePath) return new Response('bad url', { status: 400 })

    let stat
    try {
      stat = await fsp.stat(filePath)
    } catch {
      // 文件被删/改名：给 404，播放器会走错误分支提示用户重新导入
      return new Response('not found', { status: 404 })
    }
    if (!stat.isFile()) return new Response('not a file', { status: 404 })

    const type = MIME[extOf(filePath)] || 'application/octet-stream'
    const range = request.headers.get('range') || request.headers.get('Range')
    if (range) {
      const m = /bytes=(\d*)-(\d*)/i.exec(range)
      if (m) {
        const start = m[1] ? Number(m[1]) : 0
        const end = m[2] ? Math.min(Number(m[2]), stat.size - 1) : stat.size - 1
        if (start > end || start >= stat.size) {
          return new Response('range not satisfiable', {
            status: 416,
            headers: { 'content-range': `bytes */${stat.size}` },
          })
        }
        const stream = fs.createReadStream(filePath, { start, end })
        return new Response(Readable.toWeb(stream), {
          status: 206,
          headers: {
            'content-type': type,
            'content-length': String(end - start + 1),
            'content-range': `bytes ${start}-${end}/${stat.size}`,
            'accept-ranges': 'bytes',
          },
        })
      }
    }

    return new Response(Readable.toWeb(fs.createReadStream(filePath)), {
      status: 200,
      headers: {
        'content-type': type,
        'content-length': String(stat.size),
        'accept-ranges': 'bytes',
      },
    })
  })
}

/**
 * 探测网易云可能的位置。
 *
 * 返回两组：
 *   - downloads：下载目录（真正的歌在这里）
 *   - clientData：客户端数据目录（缓存/数据库，只在报告里提一句，不解析）
 *
 * 为什么要扫所有盘根：这台机器就装在 `C:\CloudMusic`（绿色安装），
 * 注册表和 Program Files 里都查不到。只认 `%USERPROFILE%\Music\CloudMusic`
 * 会直接漏掉。
 */
async function detectDirs() {
  const home = app.getPath('home')
  const downloads = new Set()
  const clientData = new Set()

  const fixed = [
    path.join(home, 'Music', 'CloudMusic'),
    path.join(home, 'Music', '网易云音乐'),
    path.join(home, 'Documents', '网易云音乐'),
    path.join(home, 'Documents', 'CloudMusic'),
  ]
  for (const dir of fixed) {
    try {
      if ((await fsp.stat(dir)).isDirectory()) downloads.add(dir)
    } catch { /* 不存在就算了 */ }
  }

  // 盘根下的 CloudMusic：绿色安装/用户自选下载目录常见
  for (const letter of 'CDEFGHIJ') {
    const dir = `${letter}:\\CloudMusic`
    try {
      if ((await fsp.stat(dir)).isDirectory()) downloads.add(dir)
    } catch { /* 这个盘没有 */ }
  }

  for (const dir of [
    path.join(app.getPath('appData'), 'Netease', 'CloudMusic'),
    path.join(app.getPath('appData'), '..', 'Local', 'Netease', 'CloudMusic'),
  ]) {
    try {
      if ((await fsp.stat(dir)).isDirectory()) clientData.add(path.resolve(dir))
    } catch { /* ignore */ }
  }

  return { downloads: [...downloads], clientData: [...clientData] }
}

/** 递归收集文件。用 promises 逐个 stat，不阻塞主进程的其它 IPC */
async function walk(dir, depth, budget) {
  if (depth > MAX_DEPTH || budget.entries.length >= MAX_FILES) return
  let entries
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return // 权限不足的目录直接跳过，不要整个扫描失败
  }
  for (const ent of entries) {
    if (budget.entries.length >= MAX_FILES) return
    if (ent.name.startsWith('.')) continue
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      // 跳过系统目录与回收站，用户误选盘根时不至于扫穿整个盘
      if (/^\$|^System Volume Information$/i.test(ent.name)) continue
      await walk(full, depth + 1, budget)
      continue
    }
    if (!ent.isFile()) continue
    const ext = extOf(ent.name)
    if (!AUDIO_EXTS.has(ext) && !ENCRYPTED_EXTS.has(ext) && ext !== 'lrc') continue
    let st
    try {
      st = await fsp.stat(full)
    } catch {
      continue
    }
    budget.entries.push({ path: full, name: ent.name, size: st.size, mtime: st.mtimeMs, ext })
  }
}

/**
 * 扫描一个目录。
 *
 * 返回**未过滤**的完整清单（音频 + 加密 + lrc），由渲染层用内核的
 * `summarizeScan` / `buildLocalTracks` 去分类 —— 这样「跳过几个 .ncm」
 * 这种判断只有一份实现，且能被单测覆盖。
 */
async function scan(dir) {
  const root = String(dir || '')
  if (!root) return { root, entries: [], truncated: false }
  let isDir = false
  try {
    isDir = (await fsp.stat(root)).isDirectory()
  } catch {
    return { root, entries: [], truncated: false, error: '目录不存在或无法访问' }
  }
  if (!isDir) return { root, entries: [], truncated: false, error: '不是一个目录' }

  const budget = { entries: [] }
  await walk(root, 0, budget)
  const entries = budget.entries

  // 同名 .lrc 一并读进来：本地歌不需要再发请求，播放时直接用
  const lrc = {}
  for (const e of entries) {
    if (e.ext !== 'lrc') continue
    const target = path.join(path.dirname(e.path), path.basename(e.path, path.extname(e.path)))
    // .lrc 可能和音频同名但扩展名不同，也可能就叫 歌名.lrc
    for (const audioExt of AUDIO_EXTS) {
      const audioPath = `${target}.${audioExt}`
      try {
        lrc[audioPath] = await fsp.readFile(e.path, 'utf8')
      } catch { /* 读不了就算了，不影响播放 */ }
    }
  }

  return {
    root,
    entries: entries.filter(e => e.ext !== 'lrc'),
    lrc,
    truncated: entries.length >= MAX_FILES,
  }
}

/** 选目录 */
async function pickDir(win) {
  const { dialog } = require('electron')
  const r = await dialog.showOpenDialog(win ?? undefined, {
    title: '选择音乐目录',
    properties: ['openDirectory'],
  })
  if (r.canceled || !r.filePaths.length) return ''
  return r.filePaths[0]
}

module.exports = { registerScheme, installProtocol, detectDirs, scan, pickDir, SCHEME, PREFIX }
