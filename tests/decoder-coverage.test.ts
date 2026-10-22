import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * 扫描器与解码器的扩展名必须一一对应。
 *
 * 之前 ENCRYPTED_EXTS 少了 vpr / mflac2 / mggl / bkc* —— 文件在进解码器之前
 * 就被 scan() 丢掉了，导入页连「解不开」都不显示，用户以为文件没被识别。
 * 这条测试把两边钉死：漏一个就红。
 */
const src = readFileSync(new URL('../apps/desktop/electron/local.cjs', import.meta.url), 'utf8')

/** 明确「认得出但暂不支持」的格式，只在界面提示用，不要求有解码器 */
const KNOWN_UNSUPPORTED = ['tm0', 'tm2', 'tm3', 'tm6', 'xm']

function block(startMarker: string, endMarker: string): string {
  const a = src.indexOf(startMarker)
  const b = src.indexOf(endMarker, a)
  if (a < 0 || b < 0) throw new Error('marker not found: ' + startMarker)
  return src.slice(a, b)
}

const encryptedExts = [...block('const ENCRYPTED_EXTS', 'const MIME').matchAll(/'([a-z0-9]+)'/g)]
  .map(m => m[1]!)
const decoderExts = [...block('const DECODERS', 'async function decodeNcmEntries').matchAll(/^  ([a-z0-9]+):/gm)]
  .map(m => m[1]!)

describe('本地扫描的加密封装清单', () => {
  it('每个加密扩展名都有解码器（或明确标注不支持）', () => {
    const orphans = encryptedExts.filter(
      e => !decoderExts.includes(e) && !KNOWN_UNSUPPORTED.includes(e),
    )
    expect(orphans).toEqual([])
  })

  it('每个解码器都能被扫描放行', () => {
    const unreachable = decoderExts.filter(e => !encryptedExts.includes(e))
    expect(unreachable).toEqual([])
  })

  it('覆盖三大平台的主流封装', () => {
    for (const ext of ['ncm', 'kgm', 'kgma', 'vpr', 'qmc0', 'qmcflac', 'mflac', 'mgg', 'qmc2']) {
      expect(encryptedExts).toContain(ext)
      expect(decoderExts).toContain(ext)
    }
  })
})
