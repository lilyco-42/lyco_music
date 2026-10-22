import { createRequire } from 'node:module'
import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { decodeKgm, getMask, KGM_HEADER } = require('../apps/desktop/electron/kgm.cjs')
const { decodeQmc, buildKey } = require('../apps/desktop/electron/qmc.cjs')

function u32(n: number): Buffer {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(n)
  return b
}

/** KGM 的解密是 h(key^data) ^ h(mask)，h 自逆；用逆运算造密文才能验证解密 */
function buildKgm(plain: Buffer, key: Buffer): Buffer {
  const h = (v: number) => (v ^ ((v & 0x0f) << 4)) & 0xff
  const enc = Buffer.alloc(plain.length)
  for (let i = 0; i < plain.length; i++) {
    const masked = h(getMask(i))
    const target = plain[i]! ^ masked
    const keyByte = i % 17 === 16 ? 0 : key[i % 17]!
    enc[i] = h(target) ^ keyByte
  }
  const headerLen = 0x2c + 64
  return Buffer.concat([
    KGM_HEADER,
    u32(headerLen),
    Buffer.alloc(8),
    key,
    Buffer.alloc(headerLen - 0x2c),
    enc,
  ])
}

const mp3Head = Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0])

describe('decodeKgm', () => {
  it('解出的音频与原始音频逐字节一致', () => {
    const plain = Buffer.concat([mp3Head, randomBytes(3000)])
    const res = decodeKgm(buildKgm(plain, randomBytes(16)))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.audio.equals(plain)).toBe(true)
    expect(res.format).toBe('mp3')
  })

  it('magic 不对 / 太短时返回 ok:false', () => {
    expect(decodeKgm(Buffer.from('not a kgm file')).ok).toBe(false)
    expect(decodeKgm(Buffer.alloc(8)).ok).toBe(false)
  })

  it('getMask 是确定性的（同位置同值）', () => {
    expect(getMask(0)).toBe(getMask(0))
    expect(getMask(12345)).toBe(getMask(12345))
    expect(getMask(12345)).not.toBe(getMask(12346))
  })
})

describe('decodeQmc', () => {
  it('qmc0 往返一致（异或对称）', () => {
    const plain = Buffer.concat([mp3Head, randomBytes(5000)])
    const key = buildKey()
    const enc = Buffer.from(plain)
    for (let i = 0; i < enc.length; i++) {
      const o = i > 0x7fff ? i % 0x7fff : i
      enc[i]! ^= key[o % 128]!
    }
    const res = decodeQmc(enc, 'qmc0')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.audio.equals(plain)).toBe(true)
    expect(res.format).toBe('mp3')
  })

  it('qmcflac / qmcogg 用对应扩展名给格式', () => {
    const res = decodeQmc(Buffer.concat([Buffer.from('fLaC'), randomBytes(256)]), 'qmcflac')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.format).toBe('flac')
  })

  it('未知扩展名给出明确原因', () => {
    const res = decodeQmc(Buffer.alloc(64), 'mgg')
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toContain('QMC')
  })
})
