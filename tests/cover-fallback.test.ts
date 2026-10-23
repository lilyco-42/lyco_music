import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * 封面缺失的两类原因，各钉一条测试。
 *
 * 1) 导入本地 ncm：封面存在文件头里，解出来的 mp3 不带内嵌图。
 *    第一次解密时写了 .cover，但「命中缓存」那条分支没把 coverPath 恢复，
 *    于是重复导入/换目录再扫时封面全没了 —— 用户看到的就是「导入后没封面」。
 *
 * 2) 酷狗模板里 {size} 出现多次，只替换第一处会拼出坏地址。
 */
const local = readFileSync(new URL('../apps/desktop/electron/local.cjs', import.meta.url), 'utf8')
const kg = readFileSync(new URL('../packages/core/src/sources/kg/index.ts', import.meta.url), 'utf8')

describe('本地 ncm 封面', () => {
  it('缓存命中分支会恢复 coverPath', () => {
    const hit = local.slice(local.indexOf('const cached = ['), local.indexOf('try {\n        const decode'))
    expect(hit).toContain('coverPath')
    expect(hit).toContain('e.hasCover = true')
  })

  it('老缓存缺 .cover 时会回读源文件补出来', () => {
    const hit = local.slice(local.indexOf('const cached = ['), local.indexOf('try {\n        const decode'))
    // 必须读源文件（srcPath），不能读已被改写成缓存 mp3 的 e.path
    expect(hit).toContain('srcPath')
    expect(hit).toContain('res.cover')
  })

  it('srcPath 保留了源文件位置（path 不再被改写）', () => {
    const region = local.slice(local.indexOf('async function decodeNcmEntries'), local.indexOf('async function attachTags'))
    // 解密产物走 playPath；path 必须始终是源文件，否则分组会跑到 ncm-cache 下
    expect(region).toContain('const srcPath = e.path')
    expect(region).not.toMatch(/^\s*e\.path\s*=/m)
  })
})

describe('酷狗封面模板', () => {
  it('{size} 全局替换', () => {
    expect(kg).toContain('replace(/{size}/g')
  })
})
