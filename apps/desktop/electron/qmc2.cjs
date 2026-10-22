/**
 * QMCv2 解密（QQ 音乐 .mflac / .mgg / .qmc2 等）
 *
 * 和 QMCv1 的区别：v1 是静态密码，v2 每个文件一个 ekey。
 * 流程分三段：
 *
 *   1. 从容器里挖出 ekey。四种布局：
 *      - STag 在头部：'STag' + u32le ekeyLen@0x14 + ekey@0x18
 *      - QTag 在尾部：audio | "ekey,songid,ver" | u32be metaLen | "QTag"
 *      - 裸 ekey 尾巴：audio | ekey | u32le ekeyLen
 *      - musicex（2023+）：不含 ekey，只能拿 Cookie 去官方接口换 —— 直接报错
 *   2. ekey(base64) -> 派生密钥：可能先解一层 TEA（"QQMusic EncV2,Key:"），
 *      再用 simpleMakeKey 拼 TEA 密钥解主体，得到 8 + N 字节。
 *   3. 用派生密钥解音频：>300 字节走 RC4 变体（分段 5120），
 *      <=300 字节走「压缩成 128 字节再铺 32768 掩码」的老路。
 *
 * 参考：unlock-music 系实现（算法与常量一致）。
 */
const V2_KEY_SIZE = 128
const KEY_COMPRESS_INDEX_OFFSET = 71214
const SEGMENT_SIZE = 5120
const EKEY_RE = /^[A-Za-z0-9+/=]+$/
const MAX_EKEY_LEN = 0xffff

const MIX_KEY_1 = Buffer.from([0x33, 0x38, 0x36, 0x5a, 0x4a, 0x59, 0x21, 0x40, 0x23, 0x2a, 0x24, 0x25, 0x5e, 0x26, 0x29, 0x28])
const MIX_KEY_2 = Buffer.from([0x2a, 0x24, 0x25, 0x5e, 0x26, 0x29, 0x28, 0x23, 0x40, 0x21, 0x33, 0x38, 0x36, 0x5a, 0x4a, 0x59])

/* ------------------------------------------------------------ TEA */

const TEA_DELTA = 0x9e3779b9

function teaDecryptBlock(k, v0, v1, rounds) {
  let sum = (TEA_DELTA * (rounds / 2)) >>> 0
  for (let i = 0; i < rounds / 2; i++) {
    v1 = (v1 - ((((v0 << 4) >>> 0) + k[2]) ^ (v0 + sum) ^ ((v0 >>> 5) + k[3]))) >>> 0
    v0 = (v0 - ((((v1 << 4) >>> 0) + k[0]) ^ (v1 + sum) ^ ((v1 >>> 5) + k[1]))) >>> 0
    sum = (sum - TEA_DELTA) >>> 0
  }
  return [v0 >>> 0, v1 >>> 0]
}

/** 腾讯 TEA：8 字节一块，16 块一组，去掉 PKCS 风格填充 */
function decryptTencentTea(input, key) {
  if (input.length % 8 !== 0) throw new Error('TEA: 输入不是 8 的倍数')
  if (input.length < 16) throw new Error('TEA: 输入太短')
  const k = [key.readUInt32BE(0), key.readUInt32BE(4), key.readUInt32BE(8), key.readUInt32BE(12)]

  const first = Buffer.alloc(8)
  const [a, b] = teaDecryptBlock(k, input.readUInt32BE(0), input.readUInt32BE(4), 32)
  first.writeUInt32BE(a, 0)
  first.writeUInt32BE(b, 4)

  const padLen = first[0] & 0x07
  const saltLen = 2
  const zeroLen = 7
  const bodyLen = input.length - (saltLen + zeroLen) - padLen
  if (bodyLen < 0) throw new Error('TEA: 长度异常')

  const out = Buffer.alloc(bodyLen)
  first.copy(out, 0, 0, Math.min(8, bodyLen))

  let filled = Math.min(8, bodyLen)
  let pos = 8
  while (filled < bodyLen) {
    const [x, y] = teaDecryptBlock(k, input.readUInt32BE(pos), input.readUInt32BE(pos + 4), 32)
    const blk = Buffer.alloc(8)
    blk.writeUInt32BE(x, 0)
    blk.writeUInt32BE(y, 4)
    const take = Math.min(8, bodyLen - filled)
    blk.copy(out, filled, 0, take)
    filled += take
    pos += 8
  }
  return out
}

/* -------------------------------------------------- ekey -> 派生密钥 */

function decryptV2Key(keyBuf) {
  if (keyBuf.length >= 18 && keyBuf.subarray(0, 18).toString('ascii') === 'QQMusic EncV2,Key:') {
    let out = decryptTencentTea(keyBuf.subarray(18), MIX_KEY_1)
    out = decryptTencentTea(out, MIX_KEY_2)
    const decoded = Buffer.from(out.toString('ascii'), 'base64')
    if (decoded.length < 16) throw new Error('EncV2 密钥解码失败')
    return decoded
  }
  return keyBuf
}

function simpleMakeKey(salt, length) {
  const out = Buffer.alloc(length)
  for (let i = 0; i < length; i++) {
    const tmp = Math.tan(salt + i * 0.1)
    out[i] = Math.abs(tmp) * 100.0 & 0xff
  }
  return out
}

function qmcDeriveKey(ekeyB64) {
  let raw = Buffer.from(ekeyB64, 'base64')
  if (raw.length < 16) return raw
  const original = Buffer.from(raw)
  try {
    raw = decryptV2Key(raw)
    const simple = simpleMakeKey(106, 8)
    const teaKey = Buffer.alloc(16)
    for (let i = 0; i < 8; i++) {
      teaKey[i << 1] = simple[i]
      teaKey[(i << 1) + 1] = raw[i]
    }
    const sub = decryptTencentTea(raw.subarray(8), teaKey)
    const finalKey = Buffer.alloc(8 + sub.length)
    raw.copy(finalKey, 0, 0, 8)
    sub.copy(finalKey, 8)
    return finalKey
  } catch {
    return original
  }
}

/* ------------------------------------------------------------ 掩码 */

function shiftMix(byte, shift) {
  shift &= 7
  if (shift === 0) return byte
  return ((byte << shift) | (byte >>> shift)) & 0xff
}

function keyCompress(ekey) {
  const n = ekey.length
  const out = Buffer.alloc(V2_KEY_SIZE)
  for (let i = 0; i < V2_KEY_SIZE; i++) {
    const idx = (i * i + KEY_COMPRESS_INDEX_OFFSET) % n
    out[i] = shiftMix(ekey[idx], (idx + 4) % 8)
  }
  return out
}

function getMapMask(derivedKey) {
  const wkey = keyCompress(derivedKey)
  const mask = Buffer.alloc(32768)
  for (let i = 0; i < 32768; i++) mask[i] = wkey[i % V2_KEY_SIZE]
  return mask
}

/* ------------------------------------------------------------ RC4 变体 */

class QmcRC4Cipher {
  constructor(key) {
    this.key = key
    this.N = key.length
    this.S = Buffer.alloc(this.N)
    for (let i = 0; i < this.N; i++) this.S[i] = i & 0xff
    let j = 0
    for (let i = 0; i < this.N; i++) {
      j = (this.S[i] + j + this.key[i % this.N]) % this.N
      const tmp = this.S[i]
      this.S[i] = this.S[j]
      this.S[j] = tmp
    }
    this.hash = 1
    for (let i = 0; i < this.N; i++) {
      const value = this.key[i]
      if (!value) continue
      const next = (this.hash * value) >>> 0
      if (next === 0 || next <= this.hash) break
      this.hash = next
    }
  }

  getSegmentKey(id) {
    const seed = this.key[id % this.N]
    if (seed === 0) return 0
    return Math.floor((this.hash / ((id + 1) * seed)) * 100.0) % this.N
  }

  decrypt(buf, offset) {
    let toProcess = buf.length
    let processed = 0
    const post = (len) => {
      toProcess -= len
      processed += len
      offset += len
      return toProcess === 0
    }

    if (offset < 128) {
      const len = Math.min(buf.length, 128 - offset)
      for (let i = 0; i < len; i++) buf[processed + i] ^= this.key[this.getSegmentKey(offset + i)]
      if (post(len)) return
    }
    while (toProcess > SEGMENT_SIZE) {
      const seg = Math.floor(offset / SEGMENT_SIZE)
      const skip = this.getSegmentKey(seg)
      const pos = offset % SEGMENT_SIZE
      if (pos === 0) {
        for (let i = 0; i < SEGMENT_SIZE; i++) buf[processed + i] ^= this.S[(skip + i) % this.N]
      } else {
        for (let i = 0; i < SEGMENT_SIZE - pos; i++) buf[processed + i] ^= this.S[(skip + pos + i) % this.N]
        const done = SEGMENT_SIZE - pos
        if (post(done)) return
        for (let i = 0; i < pos; i++) buf[processed + i] ^= this.S[(skip + i) % this.N]
        if (post(pos)) return
        continue
      }
      if (post(SEGMENT_SIZE)) return
    }
    if (toProcess > 0) {
      const seg = Math.floor(offset / SEGMENT_SIZE)
      const skip = this.getSegmentKey(seg)
      const pos = offset % SEGMENT_SIZE
      const len = Math.min(toProcess, SEGMENT_SIZE - pos)
      for (let i = 0; i < len; i++) buf[processed + i] ^= this.S[(skip + pos + i) % this.N]
      post(len)
      if (toProcess > 0) {
        for (let i = 0; i < toProcess; i++) buf[processed + i] ^= this.S[(skip + i) % this.N]
        post(toProcess)
      }
    }
  }
}

/* ------------------------------------------------------------ 容器解析 */

function detectKey(buf) {
  const len = buf.length
  if (len < 0x18) return null

  if (buf.toString('ascii', 0, 4) === 'STag') {
    const ekeyLen = buf.readUInt32LE(0x14)
    const audioOffset = 0x18 + ekeyLen
    if (ekeyLen > 0 && ekeyLen <= MAX_EKEY_LEN && audioOffset < len) {
      const ekey = buf.toString('ascii', 0x18, audioOffset).trim()
      if (EKEY_RE.test(ekey)) return { ekey, audioOffset, audioLen: len - audioOffset }
    }
    return null
  }

  const tail4 = buf.toString('ascii', len - 4)

  if (len >= 8 && buf.toString('ascii', len - 8) === 'musicex\u0000') {
    return { error: '这个文件来自新版 QQ 音乐（musicex），文件里没有内嵌密钥，需要登录 Cookie 才能解' }
  }

  if (tail4 === 'STag') {
    return { error: '文件里有 STag 但没有内嵌密钥，需要用旧版客户端重新下载' }
  }

  if (tail4 === 'QTag') {
    const metaLen = buf.readUInt32BE(len - 8)
    if (metaLen > 0 && metaLen < len - 8) {
      const audioLen = len - 8 - metaLen
      const rawMeta = buf.toString('utf-8', audioLen, len - 8)
      const ekey = rawMeta.split(',')[0].trim()
      if (ekey && EKEY_RE.test(ekey)) return { ekey, audioOffset: 0, audioLen }
    }
    return null
  }

  const rawLen = buf.readUInt32LE(len - 4)
  if (rawLen > 0 && rawLen <= MAX_EKEY_LEN && rawLen < len - 4) {
    const audioLen = len - 4 - rawLen
    const ekey = buf.toString('ascii', audioLen, len - 4).trim()
    if (EKEY_RE.test(ekey)) return { ekey, audioOffset: 0, audioLen }
  }
  return null
}

function detectAudioFormat(audio) {
  if (audio.length < 4) return ''
  if (audio[0] === 0x49 && audio[1] === 0x44 && audio[2] === 0x33) return 'mp3'
  if (audio[0] === 0x66 && audio[1] === 0x4c && audio[2] === 0x61 && audio[3] === 0x43) return 'flac'
  if (audio[0] === 0x4f && audio[1] === 0x67 && audio[2] === 0x67 && audio[3] === 0x53) return 'ogg'
  if (audio[0] === 0x52 && audio[1] === 0x49 && audio[2] === 0x46 && audio[3] === 0x46) return 'wav'
  if (audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0) return 'mp3'
  if (audio.length >= 8 && audio[4] === 0x66 && audio[5] === 0x74 && audio[6] === 0x79 && audio[7] === 0x70) return 'm4a'
  return ''
}

/**
 * @returns {{ ok: true, audio: Buffer, format: string } | { ok: false, error: string }}
 */
function decodeQmcV2(buf, hintExt) {
  try {
    if (!Buffer.isBuffer(buf) || buf.length < 0x18) return { ok: false, error: '文件太小' }
    const found = detectKey(buf)
    if (!found) return { ok: false, error: '找不到内嵌密钥（不是已知的 QMCv2 容器布局）' }
    if (found.error) return { ok: false, error: found.error }

    const audio = Buffer.from(buf.subarray(found.audioOffset, found.audioOffset + found.audioLen))
    const derived = qmcDeriveKey(found.ekey)
    if (derived.length === 0) return { ok: false, error: '密钥解析失败' }

    if (derived.length > 300) {
      new QmcRC4Cipher(derived).decrypt(audio, 0)
    } else {
      const mask = getMapMask(derived)
      for (let i = 0; i < audio.length; i++) audio[i] ^= mask[i < 32768 ? i : i % 32768]
    }

    const hint = String(hintExt || '').toLowerCase()
    const format = detectAudioFormat(audio) || (hint.includes('flac') ? 'flac' : hint.includes('ogg') ? 'ogg' : 'mp3')
    return { ok: true, audio, format }
  } catch (error) {
    return { ok: false, error: error && error.message ? error.message : '解密失败' }
  }
}

module.exports = { decodeQmcV2, detectKey, qmcDeriveKey, QmcRC4Cipher }
