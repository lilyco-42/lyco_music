/**
 * .ncm 解密（网易云音乐的加密封装）
 *
 * 只处理**用户自己机器上的本地文件**：导入扫描时把 .ncm 还原成原始 mp3/flac，
 * 写到应用的缓存目录再当作普通音频播放。不发请求、不上传、不碰在线流。
 *
 * 格式（逆向自客户端，与 ncm2mp3 / unlock-music 一致）：
 *   magic "CTENFDAM" + 2 字节 gap
 *   keyLen u32le + key  (每字节 ^0x64, AES-128-ECB, 去 "neteasecloudmusic" 前缀) -> RC4 密钥
 *   metaLen u32le + meta(每字节 ^0x63, "163 key(Don't modify):" 后的 base64,
 *                        AES-128-ECB, 去 "music:" 前缀) -> JSON 元信息
 *   5 字节（crc32 + 1）
 *   coverFrame: frameLen u32le + imageLen u32le + image + (frameLen - imageLen) 填充
 *   audio: 自定义流密码（标准 RC4 KSA + 非标准 PRGA）
 *
 * PRGA 与标准 RC4 不同：j 恒等于 (i+1)&0xff，因此可以按任意偏移解密，
 * 这也是能边读边解、不用把整个文件读进内存的原因。
 */
const crypto = require('node:crypto')

const MAGIC = Buffer.from('CTENFDAM', 'ascii')
const CORE_KEY = Buffer.from('hzHRAmso5kInbaxW', 'ascii')
const META_KEY = Buffer.from("#14ljk_!\\]&0U<'(", 'ascii')
const KEY_PREFIX = Buffer.from('neteasecloudmusic', 'ascii')
const META_PREFIX = Buffer.from('music:', 'ascii')
const META_PLAIN_PREFIX = Buffer.from("163 key(Don't modify):", 'ascii')

const MAX_SEGMENT = 64 * 1024 * 1024

function aesEcbDecrypt(key, data) {
  const d = crypto.createDecipheriv('aes-128-ecb', key, null)
  d.setAutoPadding(true)
  return Buffer.concat([d.update(data), d.final()])
}

/** 标准 RC4 KSA，得到 256 字节 s_box */
function buildSBox(key) {
  const s = new Uint8Array(256)
  for (let i = 0; i < 256; i++) s[i] = i
  let j = 0
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 0xff
    const t = s[i]
    s[i] = s[j]
    s[j] = t
  }
  return s
}

/** 就地解密音频段；offset 是该块在音频流里的绝对位置 */
function decryptAudio(buf, sBox) {
  for (let i = 0; i < buf.length; i++) {
    const j = (i + 1) & 0xff
    const a = sBox[j]
    const b = sBox[(a + j) & 0xff]
    buf[i] ^= sBox[(a + b) & 0xff]
  }
  return buf
}

function detectFormat(head, hint) {
  if (head.length >= 3 && head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) return 'mp3'
  if (head.length >= 2 && head[0] === 0xff && (head[1] & 0xe0) === 0xe0) return 'mp3'
  if (head.length >= 4 && head.slice(0, 4).toString('ascii') === 'fLaC') return 'flac'
  if (head.length >= 8 && head.slice(4, 8).toString('ascii') === 'ftyp') return 'm4a'
  if (head.length >= 12 && head.slice(0, 4).toString('ascii') === 'RIFF' && head.slice(8, 12).toString('ascii') === 'WAVE') return 'wav'
  if (head.length >= 4 && head.slice(0, 4).toString('ascii') === 'OggS') return 'ogg'
  const h = String(hint || '').toLowerCase()
  if (['mp3', 'flac', 'm4a', 'wav', 'ogg'].includes(h)) return h
  return ''
}

/**
 * 解一个 .ncm。
 *
 * @returns {{ ok: true, audio: Buffer, format: string, meta: object, cover: Buffer|null }
 *          | { ok: false, error: string }}
 */
function decodeNcm(buf) {
  try {
    if (!Buffer.isBuffer(buf) || buf.length < 16) return { ok: false, error: '文件太小' }
    if (!buf.slice(0, 8).equals(MAGIC)) return { ok: false, error: '不是 .ncm 文件（magic 不匹配）' }

    let off = 10 // magic + 2 字节 gap

    // ---- RC4 密钥
    const keyLen = buf.readUInt32LE(off)
    off += 4
    if (keyLen <= 0 || keyLen > MAX_SEGMENT || off + keyLen > buf.length) return { ok: false, error: '密钥段长度异常' }
    const keyBlob = Buffer.from(buf.slice(off, off + keyLen))
    off += keyLen
    for (let i = 0; i < keyBlob.length; i++) keyBlob[i] ^= 0x64
    let key
    try {
      key = aesEcbDecrypt(CORE_KEY, keyBlob)
    } catch {
      return { ok: false, error: '密钥解密失败' }
    }
    if (!key.slice(0, KEY_PREFIX.length).equals(KEY_PREFIX)) return { ok: false, error: '密钥前缀不匹配' }
    key = key.slice(KEY_PREFIX.length)

    // ---- 元信息（失败不影响音频）
    let meta = {}
    const metaLen = buf.readUInt32LE(off)
    off += 4
    if (metaLen > 0 && metaLen <= MAX_SEGMENT && off + metaLen <= buf.length) {
      const metaBlob = Buffer.from(buf.slice(off, off + metaLen))
      for (let i = 0; i < metaBlob.length; i++) metaBlob[i] ^= 0x63
      if (metaBlob.slice(0, META_PLAIN_PREFIX.length).equals(META_PLAIN_PREFIX)) {
        try {
          const b64 = metaBlob.slice(META_PLAIN_PREFIX.length).toString('ascii')
          const decrypted = aesEcbDecrypt(META_KEY, Buffer.from(b64, 'base64'))
          if (decrypted.slice(0, META_PREFIX.length).equals(META_PREFIX)) {
            meta = JSON.parse(decrypted.slice(META_PREFIX.length).toString('utf8')) || {}
          }
        } catch {
          // 元信息坏了就只要音频
        }
      }
      off += metaLen
    } else if (metaLen > 0) {
      return { ok: false, error: '元信息段长度异常' }
    }

    // ---- crc + 封面帧
    off += 5
    if (off + 8 > buf.length) return { ok: false, error: '文件被截断（缺封面帧）' }
    const frameLen = buf.readUInt32LE(off)
    off += 4
    const imageLen = buf.readUInt32LE(off)
    off += 4
    if (imageLen > MAX_SEGMENT || frameLen > MAX_SEGMENT) return { ok: false, error: '封面段长度异常' }
    let cover = null
    if (imageLen > 0) {
      if (off + imageLen > buf.length) return { ok: false, error: '文件被截断（缺封面数据）' }
      cover = buf.slice(off, off + imageLen)
      off += imageLen
    }
    // 3.x 客户端会在封面帧里留填充，跳过它才不会把音频解成噪声
    const padding = frameLen - imageLen
    if (padding > 0) off += padding
    if (off >= buf.length) return { ok: false, error: '文件被截断（无音频数据）' }

    const audio = decryptAudio(Buffer.from(buf.slice(off)), buildSBox(key))
    const format = detectFormat(audio, meta && meta.format)
    if (!format) return { ok: false, error: '解密后不是可识别的音频' }
    return { ok: true, audio, format, meta, cover }
  } catch (error) {
    return { ok: false, error: error && error.message ? error.message : '解密失败' }
  }
}

module.exports = { decodeNcm, detectFormat }
