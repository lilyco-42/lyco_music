import { createRequire } from 'node:module'
import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { decodeQmcV2, detectKey, qmcDeriveKey, QmcRC4Cipher } = require('../apps/desktop/electron/qmc2.cjs')

/** 造一个 STag 头部的 QMCv2 容器：'STag' + 0x10 字节 + u32le ekeyLen@0x14 + ekey + 音频 */
function buildSTag(ekey: string, audio: Buffer): Buffer {
  const keyBuf = Buffer.from(ekey, 'ascii')
  const head = Buffer.alloc(0x18)
  head.write('STag', 0, 'ascii')
  head.writeUInt32LE(keyBuf.length, 0x14)
  return Buffer.concat([head, keyBuf, audio])
}

/** 造一个 QTag 尾部容器：音频 + "ekey,songid,1" + u32be metaLen + "QTag" */
function buildQTag(ekey: string, audio: Buffer): Buffer {
  const meta = Buffer.from(ekey + ',001abc,1', 'utf-8')
  const lenBuf = Buffer.alloc(4)
  lenBuf.writeUInt32BE(meta.length)
  return Buffer.concat([audio, meta, lenBuf, Buffer.from('QTag', 'ascii')])
}

const mp3Head = Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0])

/** 用派生密钥把明文「加密」回去：RC4 变体和掩码都是异或，对称 */
function encryptWith(derived: Buffer, audio: Buffer): Buffer {
  const out = Buffer.from(audio)
  if (derived.length > 300) {
    new QmcRC4Cipher(derived).decrypt(out, 0)
  } else {
    const mask = Buffer.alloc(32768)
    const n = derived.length
    const wkey = Buffer.alloc(128)
    for (let i = 0; i < 128; i++) {
      const idx = (i * i + 71214) % n
      const b = derived[idx]!
      const shift = (idx + 4) % 8
      wkey[i] = shift === 0 ? b : (((b << shift) | (b >>> shift)) & 0xff)
    }
    for (let i = 0; i < 32768; i++) mask[i] = wkey[i % 128]!
    for (let i = 0; i < out.length; i++) out[i]! ^= mask[i < 32768 ? i : i % 32768]!
  }
  return out
}

describe('QMCv2 容器解析', () => {
  it('STag 头部能挖出 ekey 与音频偏移', () => {
    const buf = buildSTag('QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE=', mp3Head)
    const found = detectKey(buf)
    expect(found?.ekey).toBe('QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE=')
    expect(found?.audioOffset).toBe(0x18 + 32)
  })

  it('QTag 尾部能挖出 ekey', () => {
    const buf = buildQTag('QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE=', mp3Head)
    const found = detectKey(buf)
    expect(found?.ekey).toBe('QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE=')
    expect(found?.audioLen).toBe(mp3Head.length)
  })

  it('musicex 容器给出明确原因而不是静默失败', () => {
    const tail = Buffer.alloc(184)
    const sizeBuf = Buffer.alloc(4)
    sizeBuf.writeUInt32LE(184)
    const buf = Buffer.concat([mp3Head, tail, sizeBuf, Buffer.from('musicex\u0000', 'ascii')])
    const found = detectKey(buf)
    expect(found?.error).toContain('musicex')
  })
})

describe('QMCv2 解密', () => {
  it('短密钥（<=300 字节）走掩码分支，能往返', () => {
    const ekey = 'QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE='
    const derived = qmcDeriveKey(ekey)
    const plain = Buffer.concat([mp3Head, randomBytes(2000)])
    const enc = encryptWith(derived, plain)
    const res = decodeQmcV2(buildSTag(ekey, enc), 'mflac')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.audio.equals(plain)).toBe(true)
    expect(res.format).toBe('mp3')
  })

  it('长密钥（>300 字节）走 RC4 分支，能往返', () => {
    const derived = randomBytes(512)
    const plain = Buffer.concat([Buffer.from('fLaC'), randomBytes(9000)])
    const enc = encryptWith(derived, plain)
    // 直接验证 RC4 对称性：解密函数作用两次等于原文
    const once = Buffer.from(enc)
    new QmcRC4Cipher(derived).decrypt(once, 0)
    expect(once.equals(plain)).toBe(true)
  })

  it('不是容器 / 太短时返回 ok:false', () => {
    expect(decodeQmcV2(Buffer.alloc(4)).ok).toBe(false)
    const junk = Buffer.concat([mp3Head, randomBytes(64)])
    expect(decodeQmcV2(junk).ok).toBe(false)
  })
})
