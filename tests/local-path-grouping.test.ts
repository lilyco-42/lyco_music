import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * 解密后**不能改写 e.path**。
 *
 * 现场：导入 C:\CloudMusic 后，界面出现一个叫 ncm-cache 的分组，
 * 里面正好是那 17 首解密的歌。原因是解密时把 e.path 改成了缓存里的
 * mp3 路径，渲染层按 path 的目录分组，于是全归到 ncm-cache 名下。
 *
 * 正确做法：path 保持源文件位置（用于分组/显示），另存 playPath 供播放。
 */
const src = readFileSync(new URL('../apps/desktop/electron/local.cjs', import.meta.url), 'utf8')
const core = readFileSync(new URL('../packages/core/src/local/index.ts', import.meta.url), 'utf8')

describe('解密后保持源路径', () => {
  it('解密分支不再改写 e.path', () => {
    const region = src.slice(src.indexOf('async function decodeNcmEntries'), src.indexOf('async function attachTags'))
    expect(region).not.toMatch(/^\s*e\.path\s*=/m)
  })

  it('改用 playPath 记录解密产物', () => {
    const region = src.slice(src.indexOf('async function decodeNcmEntries'), src.indexOf('async function attachTags'))
    expect(region).toContain('e.playPath = cached')
    expect(region).toContain('e.playPath = out')
  })

  it('播放地址优先用 playPath', () => {
    expect(core).toContain('file.playPath ?? file.path')
  })
})
