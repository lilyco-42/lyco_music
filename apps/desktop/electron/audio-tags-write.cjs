/**
 * 把元数据写进下载好的音频文件（PARITY 5.6 / 5.7）。
 *
 * 支持 MP3（ID3v2.3）与 FLAC（Vorbis comment + PICTURE）；M4A 不写 ——
 * 它要在 atom 树里插 `ilst`，改错一个 size 字段整首歌就打不开了，
 * 而我们的下载结果里 m4a 占比很低，不值得为它承担这个风险。
 *
 * 三条硬约束：
 *   1. **先写临时文件再改名**。原地改文件时断电 = 一首歌彻底报废，
 *      而下载刚刚花了几分钟。
 *   2. **写标签失败不影响下载结果**。标签是锦上添花，音频已经落盘了，
 *      这里抛异常会让界面显示「下载失败」，用户白下一次。
 *   3. **文本一律 UTF-16LE + BOM**。ID3v2.3 规范只认 ISO-8859-1 / UTF-16，
 *      用 UTF-8 是 v2.4 的事；车机和老播放器对 v2.4 支持很差。
 */
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { pipeline } = require('node:stream/promises')
const { encodeGbk } = require('./gbk-table.cjs')

const MAX_COVER_BYTES = 6 * 1024 * 1024

function extOf(name) {
  const base = String(name || '')
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}

function syncsafe(n) {
  return Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f])
}

/* ---------------- ID3v2.3（MP3） ---------------- */

function id3Frame(id, body) {
  const head = Buffer.alloc(10)
  head.write(id, 0, 'latin1')
  head.writeUInt32BE(body.length, 4)
  return Buffer.concat([head, body])
}

/** 文本帧：编码 1 = UTF-16 + BOM */
function id3TextFrame(id, text) {
  const value = String(text ?? '').trim()
  if (!value) return null
  return id3Frame(id, Buffer.concat([
    Buffer.from([1]),
    Buffer.from([0xff, 0xfe]),
    Buffer.from(value, 'utf16le'),
  ]))
}

/** USLT：语言(3) + 描述(UTF-16, 空) + 歌词(UTF-16) */
function id3LyricFrame(lyric) {
  const text = String(lyric ?? '').trim()
  if (!text) return null
  return id3Frame('USLT', Buffer.concat([
    Buffer.from([1]),
    Buffer.from('chi', 'latin1'),
    Buffer.from([0xff, 0xfe, 0x00, 0x00]),
    Buffer.from([0xff, 0xfe]),
    Buffer.from(text, 'utf16le'),
  ]))
}

/** APIC：MIME + 图片类型(3=正面封面) + 空描述 + 图片数据 */
function id3PictureFrame(picture) {
  if (!picture?.data?.length) return null
  return id3Frame('APIC', Buffer.concat([
    Buffer.from([0]),
    Buffer.from(picture.mime + '\0', 'latin1'),
    Buffer.from([3]),
    Buffer.from('\0', 'latin1'),
    picture.data,
  ]))
}

function buildId3v23(meta) {
  const frames = [
    id3TextFrame('TIT2', meta.title),
    id3TextFrame('TPE1', meta.artist),
    id3TextFrame('TALB', meta.album),
    id3LyricFrame(meta.lyric),
    id3PictureFrame(meta.picture),
  ].filter(Boolean)
  const body = Buffer.concat(frames)
  return Buffer.concat([
    Buffer.from('ID3', 'latin1'),
    Buffer.from([3, 0, 0]), // v2.3.0，无 flags
    syncsafe(body.length),
    body,
  ])
}

/* ---------------- FLAC ---------------- */

function flacBlock(type, body, last) {
  const head = Buffer.alloc(4)
  head[0] = (last ? 0x80 : 0) | type
  head[1] = (body.length >> 16) & 0xff
  head[2] = (body.length >> 8) & 0xff
  head[3] = body.length & 0xff
  return Buffer.concat([head, body])
}

function readVorbisEntries(body) {
  const out = []
  try {
    let at = 0
    const vendorLen = body.readUInt32LE(at)
    const vendor = body.toString('utf8', at + 4, at + 4 + vendorLen)
    at += 4 + vendorLen
    const count = body.readUInt32LE(at)
    at += 4
    for (let i = 0; i < count && at + 4 <= body.length; i++) {
      const len = body.readUInt32LE(at)
      at += 4
      if (at + len > body.length) break
      out.push(body.toString('utf8', at, at + len))
      at += len
    }
    return { vendor, entries: out }
  } catch {
    return { vendor: 'Lyco Music', entries: out }
  }
}

function buildVorbisBody(vendor, entries) {
  const parts = []
  const v = Buffer.from(String(vendor || 'Lyco Music'), 'utf8')
  const head = Buffer.alloc(4)
  head.writeUInt32LE(v.length)
  const count = Buffer.alloc(4)
  count.writeUInt32LE(entries.length)
  parts.push(head, v, count)
  for (const entry of entries) {
    const b = Buffer.from(entry, 'utf8')
    const len = Buffer.alloc(4)
    len.writeUInt32LE(b.length)
    parts.push(len, b)
  }
  return Buffer.concat(parts)
}

/** PICTURE 块：类型(3=封面) + MIME + 空描述 + 宽高/色深(填 0) + 数据 */
function buildFlacPicture(picture) {
  const mime = Buffer.from(picture.mime, 'latin1')
  const parts = []
  const u32 = (n) => {
    const b = Buffer.alloc(4)
    b.writeUInt32BE(n)
    return b
  }
  parts.push(u32(3), u32(mime.length), mime, u32(0))
  parts.push(u32(0), u32(0), u32(0), u32(0)) // w / h / depth / colors：交给播放器自己量
  parts.push(u32(picture.data.length), picture.data)
  return Buffer.concat(parts)
}

/* ---------------- 通用工具 ---------------- */

/** 抓封面。走 Electron 的 net，才会跟随设置里的代理 */
async function fetchCover(url) {
  const text = String(url ?? '').trim()
  if (!/^https?:\/\//i.test(text)) return null
  try {
    const { net } = require('electron')
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 8000)
    try {
      const res = await net.fetch(text, { signal: ctrl.signal })
      if (!res.ok) return null
      const buf = Buffer.from(await res.arrayBuffer())
      if (!buf.length || buf.length > MAX_COVER_BYTES) return null
      // 用魔数判类型，不信 content-type：网易云的图片有时返回 octet-stream
      let mime = ''
      if (buf[0] === 0xff && buf[1] === 0xd8) mime = 'image/jpeg'
      else if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) mime = 'image/png'
      else {
        const ct = String(res.headers.get('content-type') || '')
        if (/image\/(jpeg|png|webp)/i.test(ct)) mime = ct.split(';')[0].trim()
      }
      if (!mime || mime === 'image/webp') return null // APIC 里的 webp 老播放器不认
      return { mime, data: buf }
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return null
  }
}

/**
 * 用「新前缀 + 原文件从 offset 开始的内容」替换文件。
 *
 * 先写 `<name>.tagtmp` 再 rename：中途失败时原文件完好，只是多一个临时文件
 * （下次下载同名时会把它当残留覆盖掉）。
 */
async function rewriteWithPrefix(filePath, prefix, offset) {
  const tmp = filePath + '.tagtmp'
  const out = fs.createWriteStream(tmp)
  // 先把新标签写进去，再把原文件从音频起点开始接上（pipeline 收尾时会 end）
  out.write(prefix)
  await pipeline(fs.createReadStream(filePath, { start: offset }), out)
  await fsp.rename(tmp, filePath)
}

/**
 * 合并原文与翻译。
 *
 * 时间戳相同的行拼成 `原文 / 译文` —— 单独再写一份 `xxx.trans.lrc`
 * 车机根本不读，而「翻译紧跟在原文后面」是它们唯一能显示的方式。
 */
function mergeLyric(lyric, tlyric) {
  const main = String(lyric ?? '').trim()
  const trans = String(tlyric ?? '').trim()
  if (!main || !trans) return main
  const map = new Map()
  for (const line of trans.split('\n')) {
    const m = /^\[(\d+:\d+(?:[.:]\d+)?)\](.*)$/.exec(line.trim())
    if (m) map.set(m[1], m[2].trim())
  }
  if (!map.size) return main
  return main.split('\n').map(line => {
    const m = /^(\[[^\]]+\])(.*)$/.exec(line.trim())
    if (!m) return line
    const t = map.get(m[1].slice(1, -1))
    return t ? `${m[1]}${m[2]} / ${t}` : line
  }).join('\n')
}

/* ---------------- 对外 ---------------- */

async function writeMp3(filePath, meta) {
  let audioStart = 0
  const fh = await fsp.open(filePath, 'r')
  try {
    const head = Buffer.alloc(10)
    const { bytesRead } = await fh.read(head, 0, 10, 0)
    if (bytesRead === 10 && head.toString('latin1', 0, 3) === 'ID3') {
      const size = ((head[6] & 0x7f) << 21) | ((head[7] & 0x7f) << 14) | ((head[8] & 0x7f) << 7) | (head[9] & 0x7f)
      audioStart = 10 + size
      if (head[5] & 0x10) audioStart += 10
    }
  } finally {
    await fh.close()
  }
  await rewriteWithPrefix(filePath, buildId3v23(meta), audioStart)
}

async function writeFlac(filePath, meta) {
  const fh = await fsp.open(filePath, 'r')
  const blocks = []
  let audioStart = 0
  try {
    const magic = Buffer.alloc(4)
    const { bytesRead } = await fh.read(magic, 0, 4, 0)
    if (bytesRead < 4 || magic.toString('latin1') !== 'fLaC') throw new Error('不是 FLAC 文件')
    let at = 4
    for (let guard = 0; guard < 128; guard++) {
      const head = Buffer.alloc(4)
      const r = await fh.read(head, 0, 4, at)
      if (r.bytesRead < 4) throw new Error('FLAC 元数据块不完整')
      const last = (head[0] & 0x80) !== 0
      const type = head[0] & 0x7f
      const len = (head[1] << 16) | (head[2] << 8) | head[3]
      const body = Buffer.alloc(len)
      if (len > 0) {
        const rb = await fh.read(body, 0, len, at + 4)
        if (rb.bytesRead < len) throw new Error('FLAC 元数据块被截断')
      }
      blocks.push({ type, body })
      at += 4 + len
      if (last) { audioStart = at; break }
    }
  } finally {
    await fh.close()
  }
  if (!audioStart) throw new Error('找不到 FLAC 音频起点')

  // 合并 VORBIS_COMMENT：只改我们关心的三个键，其他（ENCODER、DATE…）原样保留
  const wanted = { TITLE: meta.title, ARTIST: meta.artist, ALBUM: meta.album }
  let commentAt = -1
  let vendor = 'Lyco Music'
  let entries = []
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].type !== 4) continue
    const parsed = readVorbisEntries(blocks[i].body)
    vendor = parsed.vendor || vendor
    entries = parsed.entries
    commentAt = i
    break
  }
  for (const [key, value] of Object.entries(wanted)) {
    const text = String(value ?? '').trim()
    entries = entries.filter(e => !e.toUpperCase().startsWith(key + '='))
    if (text) entries.push(`${key}=${text}`)
  }
  const commentBlock = { type: 4, body: buildVorbisBody(vendor, entries) }
  if (commentAt >= 0) blocks[commentAt] = commentBlock
  else blocks.unshift(commentBlock)

  if (meta.picture?.data?.length) {
    // 已经有一张正面封面就不动它：用户可能自己换过
    const hasFront = blocks.some(b => b.type === 6 && b.body.length > 4 && b.body[3] === 3)
    if (!hasFront) blocks.push({ type: 6, body: buildFlacPicture(meta.picture) })
  }

  const parts = [Buffer.from('fLaC', 'latin1')]
  blocks.forEach((b, i) => parts.push(flacBlock(b.type, b.body, i === blocks.length - 1)))
  await rewriteWithPrefix(filePath, Buffer.concat(parts), audioStart)
}

/** 写一份同名 .lrc 在旁边；返回写出的路径（没写则空串） */
async function writeSidecar(target, lyric, encoding) {
  const text = String(lyric ?? '').trim()
  if (!text) return ''
  const dir = path.dirname(target)
  const base = path.basename(target).replace(/\.[^.]+$/, '')
  const file = path.join(dir, base + '.lrc')
  const data = encoding === 'gbk' ? encodeGbk(text) : Buffer.from(text, 'utf8')
  await fsp.writeFile(file, data)
  return file
}

/**
 * 下载完成后的收尾。**永不抛异常** —— 返回一个描述结果的字符串数组，
 * 由主进程决定要不要写进日志。
 */
async function writeMetadata(filePath, tags) {
  const notes = []
  if (!tags) return notes
  const meta = {
    title: tags.title,
    artist: tags.artist,
    album: tags.album,
    lyric: mergeLyric(tags.lyric, tags.tlyric),
    picture: tags.coverUrl ? await fetchCover(tags.coverUrl) : null,
  }

  if (tags.sidecar && meta.lyric) {
    try {
      const file = await writeSidecar(filePath, meta.lyric, tags.lyricEncoding)
      if (file) notes.push('lrc:' + path.basename(file) + ':' + (tags.lyricEncoding || 'utf8'))
    } catch (e) {
      notes.push('lrc-failed:' + (e && e.message ? e.message : String(e)))
    }
  }

  if (tags.embed) {
    const ext = extOf(filePath)
    try {
      if (ext === 'mp3') await writeMp3(filePath, meta)
      else if (ext === 'flac') await writeFlac(filePath, meta)
      else notes.push('embed-skip:' + ext)
    } catch (e) {
      notes.push('embed-failed:' + (e && e.message ? e.message : String(e)))
    }
  }
  return notes
}

module.exports = { writeMetadata, mergeLyric, buildId3v23, buildFlacPicture, fetchCover, encodeGbk }
