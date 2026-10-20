/**
 * 封面取色（JPEG DC 解码）回归测试。
 *
 * 期望值不是「跑一遍看输出」抄下来的，而是用 Pillow 把同一张图缩到 1×1
 * 求平均色得到的真值：
 *
 *   Image.open(p).convert('RGB').resize((1, 1), Image.BOX).getpixel((0, 0))
 *
 * 这个算法只解 DC 系数（每个 8×8 块的平均色）、不做 IDCT，很容易在
 * 「量化表索引」「渐进式扫描的 successive approximation 位移」这类细节上出错，
 * 所以必须有真值对照，不能只看「跑通了」。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { decodeJpegDc } from '../apps/mobile/src/lib/palette'

const ART = join(__dirname, '..', 'apps', 'mobile', 'src', 'assets', 'art')

function load(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(ART, name)))
}

describe('decodeJpegDc', () => {
  it('解出 cover-default 的平均色（与 Pillow 真值一致）', () => {
    expect(decodeJpegDc(load('cover-default.jpg'))).toEqual({ r: 171, g: 166, b: 167 })
  })

  it('解出 avatar-default 的平均色（与 Pillow 真值一致）', () => {
    expect(decodeJpegDc(load('avatar-default.jpg'))).toEqual({ r: 139, g: 112, b: 109 })
  })

  it('非 JPEG 输入抛错，由调用方回退', () => {
    expect(() => decodeJpegDc(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toThrow()
  })

  it('空输入抛错而不是死循环', () => {
    expect(() => decodeJpegDc(new Uint8Array(0))).toThrow()
  })
})
