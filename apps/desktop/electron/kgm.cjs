/**
 * KGM / KGMA / VPR 解密（酷狗音乐的缓存格式）
 *
 * 只处理本机文件：导入扫描时解成普通音频写进缓存目录，源文件不动。
 *
 * 文件格式：
 *   0x00..0x10  16 字节 magic（KGM/KGMA 或 VPR）
 *   0x10..0x14  header 长度 u32le
 *   0x14..0x1C  保留
 *   0x1C..0x2C  16 字节逐文件密钥（第 17 字节隐式为 0）
 *   headerLen.. 音频密文
 *
 * 逐字节解密（pos 为音频内绝对位置）：
 *   med8 = key[pos % 17] ^ data
 *   med8 ^= (med8 & 0x0F) << 4
 *   msk8 = getMask(pos)
 *   msk8 ^= (msk8 & 0x0F) << 4
 *   data = med8 ^ msk8
 *   VPR 再异或 VPR_MASK_DIFF[pos % 17]
 */
const tables = require('./decoder-tables.cjs')

const KGM_HEADER = Buffer.from(tables.KGM_HEADER)
const VPR_HEADER = Buffer.from(tables.VPR_HEADER)
const VPR_MASK_DIFF = Buffer.from(tables.VPR_MASK_DIFF)
const MASK_V2_PRE_DEF = Buffer.from(tables.MASK_V2_PRE_DEF)
const TABLE1 = Buffer.from(tables.TABLE1)
const TABLE2 = Buffer.from(tables.TABLE2)

function getMask(pos) {
  let offset = pos >> 4
  let value = 0
  while (offset >= 0x11) {
    value ^= TABLE1[offset % 272]
    offset >>= 4
    value ^= TABLE2[offset % 272]
    offset >>= 4
  }
  return MASK_V2_PRE_DEF[pos % 272] ^ value
}

function detectFormat(head) {
  if (head.length >= 3 && head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) return 'mp3'
  if (head.length >= 2 && head[0] === 0xff && (head[1] & 0xe0) === 0xe0) return 'mp3'
  if (head.length >= 4 && head.slice(0, 4).toString('ascii') === 'fLaC') return 'flac'
  if (head.length >= 8 && head.slice(4, 8).toString('ascii') === 'ftyp') return 'm4a'
  if (head.length >= 12 && head.slice(0, 4).toString('ascii') === 'RIFF' && head.slice(8, 12).toString('ascii') === 'WAVE') return 'wav'
  if (head.length >= 4 && head.slice(0, 4).toString('ascii') === 'OggS') return 'ogg'
  return ''
}

/**
 * @returns {{ ok: true, audio: Buffer, format: string, vpr: boolean } | { ok: false, error: string }}
 */
function decodeKgm(buf) {
  try {
    if (!Buffer.isBuffer(buf) || buf.length < 0x2c) return { ok: false, error: '文件太小' }
    const header = buf.subarray(0, 16)
    let isVpr
    if (header.equals(KGM_HEADER)) isVpr = false
    else if (header.equals(VPR_HEADER)) isVpr = true
    else return { ok: false, error: '不是 KGM/VPR 文件（magic 不匹配）' }

    const headerLen = buf.readUInt32LE(0x10)
    if (headerLen < 0x2c || headerLen > buf.length) return { ok: false, error: '头长度异常' }

    const key = Buffer.alloc(17)
    buf.copy(key, 0, 0x1c, 0x2c)
    key[16] = 0

    const audio = Buffer.from(buf.subarray(headerLen))
    for (let i = 0; i < audio.length; i++) {
      let med8 = key[i % 17] ^ audio[i]
      med8 ^= (med8 & 0x0f) << 4
      let msk8 = getMask(i)
      msk8 ^= (msk8 & 0x0f) << 4
      let out = med8 ^ msk8
      if (isVpr) out ^= VPR_MASK_DIFF[i % 17]
      audio[i] = out & 0xff
    }
    const format = detectFormat(audio.subarray(0, 16))
    if (!format) return { ok: false, error: '解密后不是可识别的音频' }
    return { ok: true, audio, format, vpr: isVpr }
  } catch (error) {
    return { ok: false, error: error && error.message ? error.message : '解密失败' }
  }
}

module.exports = { decodeKgm, getMask, KGM_HEADER, VPR_HEADER }
