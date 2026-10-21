/**
 * 读取音频文件里内嵌的标签与封面（PARITY 4.8）。
 *
 * 只做**读**，不写。支持的容器：
 *   - MP3：ID3v2.2 / 2.3 / 2.4（TIT2/TPE1/TALB/APIC）
 *   - FLAC：VORBIS_COMMENT（TITLE/ARTIST/ALBUM）+ PICTURE
 *   - M4A/MP4：moov.udta.meta.ilst 里的 ©nam / ©ART / ©alb / covr
 *
 * 为什么不引 `music-metadata`：它很全，但依赖链长（十几个包），而且我们
 * 只需要这四种容器的七八个字段。自己写一百多行的代价，比在 Electron 里
 * 多背一串依赖、还要跟着它的 breaking change 走要低。
 *
 * 两个刻意的边界：
 *   1. **只读文件头一段**（ID3 按声明长度，其余最多 4MB）。整份读进内存
 *      对无损文件是几十 MB，扫一个目录就能把内存打满。
 *   2. **解析失败一律返回 null，不抛异常**。标签坏了不影响播放，
 *      让整个扫描失败才是真事故。
 */
const fsp = require('node:fs/promises')

/** 单个文件最多读这么多字节来找标签（无损文件整份可能有几十 MB） */
const MAX_TAG_BYTES = 4 * 1024 * 1024

function uint32(buf, at) {
  return buf.readUInt32BE(at)
}

function uint24(buf, at) {
  return (buf[at] << 16) | (buf[at + 1] << 8) | buf[at + 2]
}

/** ID3 的长度字段是「同步安全整数」：每字节只用低 7 位 */
function syncsafe(buf, at) {
  return ((buf[at] & 0x7f) << 21) | ((buf[at + 1] & 0x7f) << 14) | ((buf[at + 2] & 0x7f) << 7) | (buf[at + 3] & 0x7f)
}

/** 16 位字节序交换：ID3 里的 UTF-16BE 用得上 */
function swap16(buf) {
  const out = Buffer.alloc(buf.length - (buf.length % 2))
  for (let i = 0; i + 1 < buf.length; i += 2) {
    out[i] = buf[i + 1]
    out[i + 1] = buf[i]
  }
  return out
}

/** 解 ID3 文本帧：首字节是编码，后面是正文 */
function decodeId3Text(body) {
  if (!body.length) return ''
  const enc = body[0]
  let payload = body.subarray(1)
  let text
  if (enc === 1) {
    // UTF-16 + BOM（可能带也可能不带，不带时按小端猜）
    if (payload.length >= 2 && payload[0] === 0xff && payload[1] === 0xfe) {
      text = payload.subarray(2).toString('utf16le')
    } else if (payload.length >= 2 && payload[0] === 0xfe && payload[1] === 0xff) {
      text = swap16(payload.subarray(2)).toString('utf16le')
    } else {
      text = payload.toString('utf16le')
    }
  } else if (enc === 2) {
    text = swap16(payload).toString('utf16le')
  } else if (enc === 3) {
    text = payload.toString('utf8')
  } else {
    // 0 = ISO-8859-1。中文标签里这种编码基本是错的，但按 latin1 读至少不会崩
    text = payload.toString('latin1')
  }
  return text.replace(/\0+$/g, '').trim()
}

/**
 * APIC（2.3/2.4）/ PIC（2.2）帧。
 *
 * 结构：编码(1) + MIME(以 0 结尾) + **图片类型(1)** + 描述(按编码结尾) + 图片数据。
 * 2.2 的 PIC 没有 MIME，只有 3 个字符的格式名（"JPG"/"PNG"）。
 *
 * 「图片类型」那一个字节很容易被漏掉 —— 漏掉之后描述字段的结束符会错位一格，
 * 解出来的图片前 1 个字节是垃圾，浏览器直接判为坏图（表现为「有封面但不显示」）。
 */
function parseApic(body, legacy) {
  if (body.length < 6) return null
  const enc = body[0]
  let at = 1
  let mime
  if (legacy) {
    const fmt = body.toString('latin1', at, at + 3).toLowerCase()
    at += 3
    mime = fmt === 'png' ? 'image/png' : 'image/jpeg'
  } else {
    const z = body.indexOf(0, at)
    if (z < 0) return null
    mime = body.toString('latin1', at, z).toLowerCase() || 'image/jpeg'
    at = z + 1
  }
  at += 1 // 图片类型（3 = 正面封面）
  if (at >= body.length) return null

  // 描述字段：UTF-16 时要按双字节对齐找结束的 00 00
  if (enc === 1 || enc === 2) {
    let found = false
    while (at + 1 < body.length) {
      if (body[at] === 0 && body[at + 1] === 0) { at += 2; found = true; break }
      at += 2
    }
    if (!found) return null
  } else {
    const z = body.indexOf(0, at)
    if (z < 0) return null
    at = z + 1
  }
  if (at >= body.length) return null
  // MIME 里出现 image/jpg 这种非标准写法也照收，Content-Type 由我们自己定
  if (!mime.startsWith('image/')) mime = 'image/jpeg'
  return { mime, data: body.subarray(at) }
}

function parseId3(buf) {
  if (buf.length < 10 || buf.toString('latin1', 0, 3) !== 'ID3') return null
  const ver = buf[3]
  const flags = buf[5]
  const size = syncsafe(buf, 6)
  const end = Math.min(10 + size, buf.length)
  let at = 10

  // 扩展头：2.3 的长度不含自身 4 字节，2.4 的长度含
  if (flags & 0x40 && at + 4 <= end) {
    if (ver >= 4) at += syncsafe(buf, at)
    else at += uint32(buf, at) + 4
  }

  const out = { title: '', artist: '', album: '', picture: null }
  const idLen = ver === 2 ? 3 : 4
  const headLen = ver === 2 ? 6 : 10

  while (at + headLen <= end) {
    const id = buf.toString('latin1', at, at + idLen)
    if (!/^[A-Z0-9]+$/.test(id)) break
    let frameSize
    if (ver === 2) frameSize = uint24(buf, at + 3)
    else if (ver === 4) frameSize = syncsafe(buf, at + 4)
    else frameSize = uint32(buf, at + 4)
    const bodyAt = at + headLen
    if (frameSize <= 0 || bodyAt + frameSize > end) break
    const body = buf.subarray(bodyAt, bodyAt + frameSize)

    if (id === 'TIT2' || id === 'TT2') out.title = decodeId3Text(body)
    else if (id === 'TPE1' || id === 'TP1') out.artist = decodeId3Text(body)
    else if (id === 'TALB' || id === 'TAL') out.album = decodeId3Text(body)
    else if (id === 'APIC' || id === 'PIC') out.picture = parseApic(body, id === 'PIC')

    at = bodyAt + frameSize
  }
  return out
}

/** VORBIS_COMMENT：小端长度前缀的 key=value 列表 */
function parseVorbisComment(body) {
  const out = { title: '', artist: '', album: '' }
  try {
    let at = 0
    const vendorLen = body.readUInt32LE(at)
    at += 4 + vendorLen
    if (at + 4 > body.length) return out
    const count = body.readUInt32LE(at)
    at += 4
    for (let i = 0; i < count && at + 4 <= body.length; i++) {
      const len = body.readUInt32LE(at)
      at += 4
      if (at + len > body.length) break
      const entry = body.toString('utf8', at, at + len)
      at += len
      const eq = entry.indexOf('=')
      if (eq <= 0) continue
      const key = entry.slice(0, eq).toUpperCase()
      const value = entry.slice(eq + 1).trim()
      if (!value) continue
      if (key === 'TITLE' && !out.title) out.title = value
      else if (key === 'ARTIST' && !out.artist) out.artist = value
      else if (key === 'ALBUM' && !out.album) out.album = value
    }
  } catch {
    // 长度字段坏了就返回已经解析出来的部分
  }
  return out
}

/** FLAC PICTURE 块：type/mimeLen/mime/descLen/desc/w/h/depth/colors/dataLen/data */
function parseFlacPicture(body) {
  try {
    let at = 0
    at += 4 // picture type
    const mimeLen = body.readUInt32BE(at)
    at += 4
    const mime = body.toString('latin1', at, at + mimeLen).toLowerCase()
    at += mimeLen
    const descLen = body.readUInt32BE(at)
    at += 4 + descLen
    at += 16 // width / height / depth / colors
    const dataLen = body.readUInt32BE(at)
    at += 4
    if (at + dataLen > body.length || dataLen <= 0) return null
    return {
      mime: mime.startsWith('image/') ? mime : 'image/jpeg',
      data: body.subarray(at, at + dataLen),
    }
  } catch {
    return null
  }
}

function parseFlac(buf) {
  if (buf.length < 8 || buf.toString('latin1', 0, 4) !== 'fLaC') return null
  let at = 4
  const out = { title: '', artist: '', album: '', picture: null }
  while (at + 4 <= buf.length) {
    const header = buf[at]
    const last = (header & 0x80) !== 0
    const type = header & 0x7f
    const len = uint24(buf, at + 1)
    const bodyAt = at + 4
    if (bodyAt + len > buf.length) break
    const body = buf.subarray(bodyAt, bodyAt + len)
    if (type === 4) Object.assign(out, parseVorbisComment(body))
    else if (type === 6) out.picture = parseFlacPicture(body)
    at = bodyAt + len
    if (last) break
  }
  return out
}

/** 遍历一段 MP4 atom */
function forEachAtom(buf, start, end, cb) {
  let at = start
  while (at + 8 <= end) {
    let size = uint32(buf, at)
    const type = buf.toString('latin1', at + 4, at + 8)
    let headLen = 8
    if (size === 1) {
      // 64 位长度：size(4) type(4) largesize(8)
      if (at + 16 > end) return
      size = Number(buf.readBigUInt64BE(at + 8))
      headLen = 16
    } else if (size === 0) {
      size = end - at
    }
    if (size < headLen || at + size > end) return
    cb(type, at + headLen, at + size)
    at += size
  }
}

function findAtom(buf, start, end, name) {
  let hit = null
  forEachAtom(buf, start, end, (type, s, e) => {
    if (!hit && type === name) hit = { start: s, end: e }
  })
  return hit
}

function parseIlst(buf, start, end) {
  const out = { title: '', artist: '', album: '', picture: null }
  forEachAtom(buf, start, end, (type, s, e) => {
    const data = findAtom(buf, s, e, 'data')
    if (!data) return
    // data atom: 4 字节 type/locale 标志后才是正文
    const flag = uint32(buf, data.start) & 0xffffff
    const payload = buf.subarray(data.start + 8, data.end)
    if (!payload.length) return
    if (type === '©nam') out.title = payload.toString('utf8').trim()
    else if (type === '©ART') out.artist = payload.toString('utf8').trim()
    else if (type === '©alb') out.album = payload.toString('utf8').trim()
    else if (type === 'covr') {
      out.picture = { mime: flag === 14 ? 'image/png' : 'image/jpeg', data: payload }
    }
  })
  return out
}

function parseM4a(buf) {
  // ilst 可能嵌好几层，直接递归找比写死 moov.udta.meta.ilst 稳
  const queue = [{ start: 0, end: buf.length }]
  for (let guard = 0; guard < 64 && queue.length; guard++) {
    const node = queue.shift()
    let found = null
    forEachAtom(buf, node.start, node.end, (type, s, e) => {
      if (found) return
      if (type === 'ilst') {
        found = parseIlst(buf, s, e)
        return
      }
      // meta 比同层其他 atom 多 4 字节 version/flags
      if (type === 'moov' || type === 'udta' || type === 'trak' || type === 'mdia') queue.push({ start: s, end: e })
      else if (type === 'meta') queue.push({ start: s + 4, end: e })
    })
    if (found) return found
  }
  return null
}

/** 按容器类型解析一段内存 */
function parseBuffer(buf) {
  if (!buf || buf.length < 8) return null
  if (buf.toString('latin1', 0, 3) === 'ID3') return parseId3(buf)
  if (buf.toString('latin1', 0, 4) === 'fLaC') return parseFlac(buf)
  if (buf.toString('latin1', 4, 8) === 'ftyp') return parseM4a(buf)
  return null
}

/**
 * 读一个文件前多少字节才够。
 *
 * ID3 头里写了标签总长，按它读最省；其余容器没有长度声明，给 4MB 上限 ——
 * 封面通常就在这几 MB 里，再往后找的收益抵不上读盘时间。
 */
async function readHead(filePath) {
  const fh = await fsp.open(filePath, 'r')
  try {
    const head = Buffer.alloc(16)
    const { bytesRead } = await fh.read(head, 0, 16, 0)
    if (bytesRead < 8) return null
    let size = MAX_TAG_BYTES
    if (head.toString('latin1', 0, 3) === 'ID3' && bytesRead >= 10) {
      size = Math.min(syncsafe(head, 6) + 10, MAX_TAG_BYTES)
    }
    const buf = Buffer.alloc(size)
    const r = await fh.read(buf, 0, size, 0)
    return buf.subarray(0, r.bytesRead)
  } finally {
    await fh.close().catch(() => undefined)
  }
}

/**
 * 读标签。返回 `{ title, artist, album, picture }`，picture 是
 * `{ mime, data }` 或 null；完全读不出东西时返回 null。
 */
async function readTags(filePath) {
  try {
    const buf = await readHead(filePath)
    if (!buf) return null
    return parseBuffer(buf)
  } catch {
    return null
  }
}

module.exports = { readTags, parseBuffer, MAX_TAG_BYTES }
