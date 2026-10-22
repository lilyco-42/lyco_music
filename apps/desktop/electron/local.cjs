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
const zlib = require('node:zlib')
const tags = require('./tags.cjs')
const { decodeNcm } = require('./ncm.cjs')
const { decodeKgm } = require('./kgm.cjs')
const { decodeQmc } = require('./qmc.cjs')
const { decodeQmcV2 } = require('./qmc2.cjs')

const SCHEME = 'lxmn-media'
const PREFIX = `${SCHEME}://local/`
/**
 * 内嵌封面的地址前缀。
 *
 * 为什么单独一条路由而不是把 base64 塞进扫描结果：一个目录几百首、
 * 每张封面几十到几百 KB，一次扫描就能把 IPC 报文推到几十 MB，
 * 界面还会因为一次性解码一堆图片卡住。这里按需读、按需返回。
 */
const COVER_PREFIX = `${SCHEME}://cover/`

/** 扫目录时最多往下走几层。网易云按歌单分目录最多两层，4 层足够且能挡住误选整个盘 */
const MAX_DEPTH = 4
/** 单次扫描的文件数上限，防止用户选了 C:\ 把内存打满 */
const MAX_FILES = 20000

const AUDIO_EXTS = new Set([
  'mp3', 'flac', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wav', 'wma', 'ape', 'aiff', 'aif',
])
/**
 * 加密封装：扫描时必须放行，否则文件在「进解码器之前」就被丢掉了。
 *
 * 这份清单要和下面的 DECODERS 一一对应 —— 之前少了 vpr / mflac2 / mggl /
 * bkc* 这些，用户把文件放进去，导入页连「解不开」都不显示，因为压根没进扫描结果。
 * 腾讯系（tm0/tm2/tm3/tm6）和小米（xm）已停用，保留在清单里只是为了让界面
 * 能如实说「暂不支持」，而不是让文件凭空消失。
 */
const ENCRYPTED_EXTS = new Set([
  // 网易云
  'ncm',
  // 酷狗
  'kgm', 'kgma', 'vpr',
  // QQ 音乐 静态（v1）
  'qmc0', 'qmc3', 'qmcflac', 'qmcogg',
  'bkc', 'bkcmp3', 'bkcflac', 'bkcogg',
  // QQ 音乐 逐文件密钥（v2）
  'qmc2', 'qmcflac2',
  'mflac', 'mflac0', 'mflac2', 'mflac4',
  'mgg', 'mgg0', 'mgg1', 'mgg2', 'mgg4', 'mggl',
  // 已停用：只用于提示「暂不支持」
  'tm0', 'tm2', 'tm3', 'tm6', 'xm',
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
/**
 * 封面缓存：key 是「路径 + 修改时间」，文件换了一首同名歌也能失效。
 * 上限 60 张，按插入顺序淘汰最旧的 —— 列表滚过去就够了，不需要真 LRU。
 */
const coverCache = new Map()
const COVER_CACHE_MAX = 60

async function coverResponse(url) {
  let filePath = ''
  try {
    filePath = decodeURIComponent(String(url || '').slice(COVER_PREFIX.length))
  } catch {
    return new Response('bad url', { status: 400 })
  }
  if (!filePath) return new Response('bad url', { status: 400 })
  let mtime = 0
  try {
    mtime = (await fsp.stat(filePath)).mtimeMs
  } catch {
    return new Response('not found', { status: 404 })
  }
  const key = filePath + '|' + mtime
  const hit = coverCache.get(key)
  if (hit) return coverResponseFrom(hit)
  /**
   * 两条来源，顺序不能反：
   *   1. 独立封面文件 —— ncm 解出来的图存在 <同名>.cover 里，
   *      它自己不是音频，readTags 读不了，必须先认这个后缀；
   *   2. 音频内嵌图 —— mp3/flac 自带的那种。
   */
  let entry = null
  if (/\.cover$/i.test(filePath)) {
    const data = await fsp.readFile(filePath)
    if (data.length) entry = { mime: sniffImageMime(data), data }
  } else {
    const info = await tags.readTags(filePath)
    if (info?.picture?.data?.length) entry = { mime: info.picture.mime, data: info.picture.data }
  }
  if (!entry) return new Response('no cover', { status: 404 })
  coverCache.set(key, entry)
  if (coverCache.size > COVER_CACHE_MAX) {
    const oldest = coverCache.keys().next().value
    if (oldest) coverCache.delete(oldest)
  }
  return coverResponseFrom(entry)
}

/** 按文件头猜图片类型：ncm 只存原始字节，不带 mime */
function sniffImageMime(buf) {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png'
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.length >= 6 && buf.toString('ascii', 0, 3) === 'GIF') return 'image/gif'
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return 'image/jpeg'
}

function coverResponseFrom(entry) {
  return new Response(entry.data, {
    status: 200,
    headers: {
      'content-type': entry.mime,
      'content-length': String(entry.data.length),
      'cache-control': 'max-age=86400',
    },
  })
}

function installProtocol() {
  protocol.handle(SCHEME, async request => {
    // 封面走同一条协议的另一条路由，先分流，免得被当成文件路径
    if (String(request.url || '').startsWith(COVER_PREFIX)) {
      return await coverResponse(request.url)
    }
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
    if (!AUDIO_EXTS.has(ext) && !ENCRYPTED_EXTS.has(ext) && ext !== 'lrc' && ext !== 'krc') continue
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
 * 酷狗 .krc 歌词解码（PARITY 3.24）。
 *
 * 格式：base64 文本 -> 去掉开头 4 字节 -> 用固定 16 字节密钥循环异或
 * -> zlib 解压 -> 得到 krc 文本。密钥是酷狗客户端里写死的常量，
 * 不是「破解账号」那一类东西，只是文件格式；不涉及音频 DRM。
 */
const KRC_KEY = Buffer.from([
  0x40, 0x47, 0x61, 0x77, 0x5e, 0x32, 0x74, 0x47,
  0x51, 0x36, 0x31, 0x2d, 0xce, 0xd2, 0x6e, 0x69,
])

function decodeKrc(buf) {
  const raw = Buffer.from(buf.toString('utf8').trim(), 'base64').subarray(4)
  for (let i = 0; i < raw.length; i++) raw[i] ^= KRC_KEY[i % 16]
  return zlib.inflateSync(raw).toString('utf8')
}

/**
 * krc -> lrc。
 *
 * krc 的行头是 `[起始毫秒,持续毫秒]`，字级时间戳是 `<偏移,时长,0>`。
 * 只保留行级时间、丢掉字级时间戳 —— 我们自己的逐字染色要的是 yrc 格式，
 * 强行转换反而会算出错位的染色。文本里可能夹 HTML 实体，一并解掉。
 */
function krcToLrc(text) {
  const out = []
  for (const rawLine of String(text).replace(/\r/g, '').split('\n')) {
    const m = /^\[(\d+),\d+\](.*)$/.exec(rawLine.trim())
    if (!m) continue
    const ms = Number(m[1])
    if (!Number.isFinite(ms)) continue
    const body = m[2].replace(/<\d+,\d+,\d+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    const mm = String(Math.floor(ms / 60000)).padStart(2, '0')
    const ss = String(Math.floor(ms / 1000) % 60).padStart(2, '0')
    const mmm = String(ms % 1000).padStart(3, '0')
    out.push('[' + mm + ':' + ss + '.' + mmm + ']' + body)
  }
  return out.join('\n')
}

/** 目前能解的封装格式 -> 用哪个解码器 */
const DECODERS = {
  ncm: (buf) => decodeNcm(buf),
  kgm: (buf) => decodeKgm(buf),
  kgma: (buf) => decodeKgm(buf),
  vpr: (buf) => decodeKgm(buf),
  qmc0: (buf) => decodeQmc(buf, 'qmc0'),
  qmc3: (buf) => decodeQmc(buf, 'qmc3'),
  qmcflac: (buf) => decodeQmc(buf, 'qmcflac'),
  qmcogg: (buf) => decodeQmc(buf, 'qmcogg'),
  bkc: (buf) => decodeQmc(buf, 'bkc'),
  bkcmp3: (buf) => decodeQmc(buf, 'bkcmp3'),
  bkcflac: (buf) => decodeQmc(buf, 'bkcflac'),
  bkcogg: (buf) => decodeQmc(buf, 'bkcogg'),
  // QMCv2：每文件一个 ekey，容器布局各不相同，交给 qmc2.cjs 自己嗅探
  mflac: (buf) => decodeQmcV2(buf, 'flac'),
  mflac0: (buf) => decodeQmcV2(buf, 'flac'),
  mflac2: (buf) => decodeQmcV2(buf, 'flac'),
  mflac4: (buf) => decodeQmcV2(buf, 'flac'),
  mgg: (buf) => decodeQmcV2(buf, 'ogg'),
  mgg0: (buf) => decodeQmcV2(buf, 'ogg'),
  mgg1: (buf) => decodeQmcV2(buf, 'ogg'),
  mgg2: (buf) => decodeQmcV2(buf, 'ogg'),
  mgg4: (buf) => decodeQmcV2(buf, 'ogg'),
  mggl: (buf) => decodeQmcV2(buf, 'ogg'),
  qmc2: (buf) => decodeQmcV2(buf, 'mp3'),
  qmcflac2: (buf) => decodeQmcV2(buf, 'flac'),
}

/**
 * 把加密封装（.ncm / .kgm / .qmc* ）就地解密成普通音频。
 *
 * 解出来的文件写在 userData/ncm-cache 下，按「原文件名 + mtime + size」命名：
 * 同一个文件重复扫描直接命中缓存，源文件更新会自动换新的。
 * 失败不阻断扫描，只在条目上留 decodeError，由界面如实告诉用户。
 */
async function decodeNcmEntries(entries) {
  const targets = entries.filter(e => DECODERS[e.ext])
  if (!targets.length) return
  const outDir = path.join(app.getPath('userData'), 'ncm-cache')
  try {
    await fsp.mkdir(outDir, { recursive: true })
  } catch {
    for (const e of targets) e.decodeError = '无法创建解密缓存目录'
    return
  }
  let cursor = 0
  const workers = new Array(Math.min(4, targets.length)).fill(0).map(async () => {
    for (;;) {
      const i = cursor++
      if (i >= targets.length) return
      const e = targets[i]
      const srcExt = e.ext
      const stamp = e.mtime + '-' + e.size
      const base = path.join(outDir, path.basename(e.name, path.extname(e.name)) + '.' + stamp)
      const cached = ['mp3', 'flac', 'm4a', 'wav', 'ogg'].map(ext => base + '.' + ext).find(p => fs.existsSync(p))
      if (cached) {
        e.path = cached
        e.ext = path.extname(cached).slice(1)
        e.decodedFrom = srcExt === 'ncm' ? 'ncm' : 'pack'
        continue
      }
      try {
        const decode = DECODERS[e.ext]
        const res = decode(await fsp.readFile(e.path))
        if (!res.ok) {
          e.decodeError = res.error
          continue
        }
        const out = base + '.' + res.format
        await fsp.writeFile(out, res.audio)
        e.path = out
        e.ext = res.format
        // 名字也换成解密后的扩展名：渲染层用文件名判断「能不能播」，
        // 不改名会一直算在「加密文件、跳过」里
        e.name = path.basename(e.name, path.extname(e.name)) + '.' + res.format
        e.size = res.audio.length
        e.decodedFrom = srcExt === 'ncm' ? 'ncm' : 'pack'
        if (res.meta && res.meta.musicName) e.title = String(res.meta.musicName)
        if (res.meta && Array.isArray(res.meta.artist)) {
          const names = res.meta.artist.map(a => (Array.isArray(a) ? a[0] : a)).filter(Boolean)
          if (names.length) e.artist = names.join('/')
        }
        if (res.meta && res.meta.album) e.album = String(res.meta.album)
        /**
         * 封面单独落盘。
         *
         * ncm 把封面存在文件头里，解出来的音频**不带内嵌图** ——
         * 之前这里只把 hasCover 置 true，而封面协议是去读音频内嵌标签的，
         * 于是界面显示「有封面」却拿不到图，导入页一片空白。
         *
         * 存成 <同名>.cover 放在缓存目录，并把绝对路径写回 e.coverPath，
         * 渲染层就能直接拿它拼 cover:// 地址。
         */
        if (res.cover && res.cover.length) {
          e.hasCover = true
          try {
            const coverPath = base + '.cover'
            await fsp.writeFile(coverPath, res.cover)
            e.coverPath = coverPath
          } catch {
            // 写不进缓存目录不影响播放，只是没封面
          }
        }
      } catch (error) {
        e.decodeError = error && error.message ? error.message : '解密失败'
      }
    }
  })
  await Promise.all(workers)
}

/**
 * 给音频文件补上内嵌标签与「有没有封面」（PARITY 4.8）。
 *
 * 并发 4：全部串行会让一千首的目录扫上半分钟；并发再高，
 * 机械硬盘上反而更慢（寻道打架）。
 *
 * 读不到标签不算错：文件名本身就是网易云按 `歌手 - 歌名` 命名的，
 * 标签只是「更准的那一份」。所以这里静默跳过，不写 error。
 */
async function attachTags(entries) {
  let cursor = 0
  const workers = new Array(Math.min(4, entries.length)).fill(0).map(async () => {
    for (;;) {
      const i = cursor++
      if (i >= entries.length) return
      const e = entries[i]
      if (!AUDIO_EXTS.has(e.ext)) continue
      const info = await tags.readTags(e.path)
      if (!info) continue
      if (info.title) e.title = info.title
      if (info.artist) e.artist = info.artist
      if (info.album) e.album = info.album
      if (info.picture?.data?.length) e.hasCover = true
    }
  })
  await Promise.all(workers)
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

  // 同名 .lrc / .krc 一并读进来：本地歌不需要再发请求，播放时直接用
  const lrc = {}
  for (const e of entries) {
    if (e.ext !== 'lrc' && e.ext !== 'krc') continue
    const target = path.join(path.dirname(e.path), path.basename(e.path, path.extname(e.path)))
    let text = ''
    try {
      if (e.ext === 'lrc') {
        text = await fsp.readFile(e.path, 'utf8')
      } else {
        // .krc 是酷狗的加密歌词：base64 -> 去掉 4 字节头 -> 定长异或 -> zlib
        text = krcToLrc(decodeKrc(await fsp.readFile(e.path)))
      }
    } catch {
      continue // 解码失败就当没有歌词，不影响音频导入
    }
    // 歌词可能和音频同名但扩展名不同
    for (const audioExt of AUDIO_EXTS) lrc[`${target}.${audioExt}`] = text
  }

  const audioEntries = entries.filter(e => e.ext !== 'lrc' && e.ext !== 'krc')

  // .ncm 在扫描阶段就解密成普通音频：用户选目录时就能看到「已解密 17 首」，
  // 而不是等点了导入才发现一半放不了。缓存按 mtime+size 命名，源文件变了会重新解。
  await decodeNcmEntries(audioEntries)
  await attachTags(audioEntries)

  return {
    root,
    entries: audioEntries,
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
