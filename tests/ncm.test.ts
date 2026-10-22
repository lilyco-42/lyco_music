import { createRequire } from 'node:module'
import { createCipheriv, randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { decodeNcm, detectFormat } = require('../apps/desktop/electron/ncm.cjs')

const CORE_KEY = Buffer.from('hzHRAmso5kInbaxW', 'ascii')
const META_KEY = Buffer.from("#14ljk_!\\]&0U<'(", 'ascii')

function u32(n: number): Buffer {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(n)
  return b
}

function aesEncrypt(key: Buffer, data: Buffer): Buffer {
  const c = createCipheriv('aes-128-ecb', key, null)
  c.setAutoPadding(true)
  return Buffer.concat([c.update(data), c.final()])
}

function buildSBox(key: Buffer): Uint8Array {
  const s = new Uint8Array(256)
  for (let i = 0; i < 256; i++) s[i] = i
  let j = 0
  for (let i = 0; i < 256; i++) {
    j = (j + s[i]! + key[i % key.length]!) & 0xff
    const t = s[i]!
    s[i] = s[j]!
    s[j] = t
  }
  return s
}

function xorStream(buf: Buffer, s: Uint8Array): Buffer {
  const out = Buffer.from(buf)
  for (let i = 0; i < out.length; i++) {
    const j = (i + 1) & 0xff
    const a = s[j]!
    const b = s[(a + j) & 0xff]!
    out[i]! ^= s[(a + b) & 0xff]!
  }
  return out
}

/** 按 NCM 规范造一个文件，用来验证解析与解密的往返 */
function makeNcm(options: { audio: Buffer; cover?: Buffer; meta?: Record<string, unknown> }): Buffer {
  const rc4Key = randomBytes(16)
  const keyBlob = aesEncrypt(CORE_KEY, Buffer.concat([Buffer.from('neteasecloudmusic'), rc4Key]))
  for (let i = 0; i < keyBlob.length; i++) keyBlob[i]! ^= 0x64

  const metaJson = Buffer.from(JSON.stringify(options.meta ?? { musicName: '晴天', artist: [['周杰伦', 1]], format: 'mp3' }))
  const metaEnc = aesEncrypt(META_KEY, Buffer.concat([Buffer.from('music:'), metaJson]))
  const metaPlain = Buffer.concat([Buffer.from("163 key(Don't modify):"), Buffer.from(metaEnc.toString('base64'), 'ascii')])
  const metaBlob = Buffer.from(metaPlain)
  for (let i = 0; i < metaBlob.length; i++) metaBlob[i]! ^= 0x63

  const cover = options.cover ?? Buffer.alloc(0)
  const frame = Buffer.concat([u32(cover.length), u32(cover.length), cover])

  return Buffer.concat([
    Buffer.from('CTENFDAM'),
    Buffer.alloc(2),
    u32(keyBlob.length),
    keyBlob,
    u32(metaBlob.length),
    metaBlob,
    Buffer.alloc(5),
    frame,
    xorStream(options.audio, buildSBox(rc4Key)),
  ])
}

const mp3 = Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0]), randomBytes(2048)])

describe('decodeNcm', () => {
  it('解出与原始音频逐字节相同的 mp3，并带回元信息', () => {
    const res = decodeNcm(makeNcm({ audio: mp3 }))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.format).toBe('mp3')
    expect(res.audio.equals(mp3)).toBe(true)
    expect(res.meta.musicName).toBe('晴天')
  })

  it('带封面时能跳过封面帧，音频仍然正确', () => {
    const cover = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])
    const res = decodeNcm(makeNcm({ audio: mp3, cover }))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.audio.equals(mp3)).toBe(true)
    expect(res.cover?.equals(cover)).toBe(true)
  })

  it('flac 能识别格式', () => {
    const flac = Buffer.concat([Buffer.from('fLaC'), randomBytes(512)])
    const res = decodeNcm(makeNcm({ audio: flac }))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.format).toBe('flac')
  })

  it('不是 ncm / 被截断 / 空数据都返回 ok:false 而不是抛异常', () => {
    expect(decodeNcm(Buffer.from('hello world')).ok).toBe(false)
    const good = makeNcm({ audio: mp3 })
    expect(decodeNcm(good.subarray(0, 30)).ok).toBe(false)
    expect(decodeNcm(Buffer.alloc(0)).ok).toBe(false)
  })
})

describe('detectFormat', () => {
  it('按魔数识别常见容器', () => {
    expect(detectFormat(Buffer.from('ID3\x04'), '')).toBe('mp3')
    expect(detectFormat(Buffer.from('fLaC'), '')).toBe('flac')
    expect(detectFormat(Buffer.from('OggS'), '')).toBe('ogg')
    expect(detectFormat(Buffer.from('RIFF0000WAVE'), '')).toBe('wav')
    expect(detectFormat(Buffer.from('\x00\x00\x00\x18ftypM4A '), '')).toBe('m4a')
    expect(detectFormat(Buffer.from([0, 0, 0, 0]), 'flac')).toBe('flac')
  })
})
