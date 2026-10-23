import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * 解密缓存目录不能被当成「用户的音乐目录」再扫一遍。
 *
 * 现场：用户导入 C:\CloudMusic，17 个 .ncm 解密后写进
 * userData/ncm-cache。之后左侧栏凭空多出一个「ncm-cache」歌单，
 * 里面就是同一批歌；界面上还会同时出现「可导入 19 首」和
 * 「仍有 17 个加密文件解不开」这种自相矛盾的统计。
 *
 * 根因：walk() 没有排除自己的输出目录。
 */
const src = readFileSync(new URL('../apps/desktop/electron/local.cjs', import.meta.url), 'utf8')

describe('解密缓存目录的隔离', () => {
  it('walk 会跳过解密输出目录', () => {
    const walk = src.slice(src.indexOf('async function walk('), src.indexOf('const KRC_KEY'))
    expect(walk).toContain('decodedCacheDir()')
    expect(walk).toMatch(/return\s*\n?\s*\/\//)
  })

  it('解密输出与扫描排除用的是同一个函数', () => {
    // 两处必须一致：写文件的地方和排除的地方各调一次，不能各写各的路径
    const calls = [...src.matchAll(/decodedCacheDir\(\)/g)]
    expect(calls.length).toBeGreaterThanOrEqual(3)
  })

  it('缓存目录名固定为 ncm-cache', () => {
    const fn = src.slice(src.indexOf('function decodedCacheDir'), src.indexOf('async function detectDirs'))
    expect(fn).toContain("'ncm-cache'")
  })
})
