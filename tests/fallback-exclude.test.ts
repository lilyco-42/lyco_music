/**
 * 试听重取的 exclude 分支（离线，不联网）。
 *
 * 旧实现靠抛一个「跳过这个音源」的错误再让 isUnplayableMessage 匹配，
 * 但那句话不含「试听」，于是跨源循环根本没跑。这里钉住新契约：
 * exclude 时原源一次都不许碰，直接去其他平台找同曲。
 */
import { beforeEach, afterEach, describe, it, expect } from 'vitest'
import {
  registerSource, resetSources, resolveWithFallback, originalSinger, fallbackKeyword,
  type MusicItem, type MusicSource, type SourceId,
} from '@lxmn/core'

const want = { id: '1', name: '晴天', singer: '周杰伦', source: 'wy', interval: '05:12' } as MusicItem
const hit = { id: '2', name: '晴天', singer: '周杰伦', source: 'kg', interval: '04:30' } as MusicItem

function fakeSource(id: SourceId, calls: string[], found: MusicItem[] = []): MusicSource {
  const source = {
    id,
    name: id,
    async getMusicUrl() {
      calls.push(id + ':getMusicUrl')
      return { url: 'https://cdn.example/full.mp3', quality: '320k' as const }
    },
    musicSearch: async () => {
      calls.push(id + ':search')
      return { list: found, total: found.length, limit: 15, page: 1, source: id }
    },
  }
  return source as unknown as MusicSource
}

beforeEach(() => resetSources())
afterEach(() => resetSources())

describe('resolveWithFallback 的 exclude', () => {
  it('跳过原源，直接从跨平台候选取到完整版', async () => {
    const calls: string[] = []
    registerSource('wy', fakeSource('wy', calls))
    registerSource('kg', fakeSource('kg', calls, [hit]))
    const out = await resolveWithFallback(want, '320k', { exclude: 'wy' })
    expect(out.switched).toBe(true)
    expect(out.item.source).toBe('kg')
    expect(out.info.url).toMatch(/^https:/)
    expect(calls).not.toContain('wy:getMusicUrl')
    expect(calls).toContain('kg:search')
    expect(calls).toContain('kg:getMusicUrl')
  })

  it('跨平台也没有时，抛试听兜底原因而不是依赖错误文案', async () => {
    const calls: string[] = []
    registerSource('wy', fakeSource('wy', calls))
    registerSource('kg', fakeSource('kg', calls, []))
    await expect(resolveWithFallback(want, '320k', { exclude: 'wy' })).rejects.toThrow(/跳过仅提供试听片段/)
    expect(calls).not.toContain('wy:getMusicUrl')
    expect(calls).toContain('kg:search')
  })
})

describe('翻唱置顶时的串源搜索词', () => {
  const cover = { ...want, name: '晴天 (原唱 周杰伦)', singer: 'RyaVocal' } as MusicItem

  it('从标题里取出原唱，不用上传者去别的平台搜', () => {
    expect(originalSinger(cover)).toBe('周杰伦')
    expect(fallbackKeyword(cover)).toBe('晴天 周杰伦')
  })

  it('普通曲目保持原搜索词，行为不变', () => {
    const normal = { ...want, name: '演员', singer: '薛之谦' } as MusicItem
    expect(originalSinger(normal)).toBeNull()
    expect(fallbackKeyword(normal)).toBe('演员 薛之谦')
  })
})
