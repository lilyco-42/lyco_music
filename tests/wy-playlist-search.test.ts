/**
 * 网易云歌单搜索：命中分类与「只看创建者」（离线单测）。
 *
 * type=1000 会混着返回歌单名命中、创建者命中和相关推荐，但网易云不给
 * 命中原因；/api/user/playlist 又会把用户收藏的别人歌单混进来。这里把
 * 归类、精确按用户找歌单、排除收藏三件容易回归的事钉住。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  setPlatform, resetSources, installWySource,
  searchWyPlaylists, searchWyPlaylistsByCreator, classifyPlaylistMatch,
  type PlatformAdapter, type HttpRequestOptions, type HttpResponse,
} from '@lxmn/core'
import { desktopPlatform } from '@lxmn/platform-desktop'

function fakePlatform(payloads: unknown[]) {
  let count = 0
  const calls: HttpRequestOptions[] = []
  const platform: PlatformAdapter = {
    ...desktopPlatform,
    http: {
      async request(o: HttpRequestOptions): Promise<HttpResponse> {
        calls.push(o)
        const body = payloads[count] ?? { code: 200 }
        count += 1
        return {
          statusCode: 200,
          headers: {},
          body: JSON.stringify(body),
          raw: new Uint8Array(),
        }
      },
    },
  }
  return { platform, calls, get count() { return count } }
}

function usePlatform(payloads: unknown[]) {
  const fake = fakePlatform(payloads)
  setPlatform(fake.platform)
  return fake
}

beforeEach(() => {
  resetSources()
  installWySource()
})

describe('歌单命中分类', () => {
  it('大小写、全半角空白归一化；歌单名优先于创建者', () => {
    expect(classifyPlaylistMatch(' Lily　co42 ', { name: 'Lilyco42 的歌单', creator: '别人' })).toBe('name')
    expect(classifyPlaylistMatch('LILYCO42', { name: '随便', creator: 'Lily co 42' })).toBe('creator')
    expect(classifyPlaylistMatch('Lilyco42', { name: '无关联', creator: '甲' })).toBe('other')
    expect(classifyPlaylistMatch('', { name: '随便', creator: 'Lilyco42' })).toBe('other')
  })

  it('关键词搜索逐条标注命中位置，保留总数与字段', async () => {
    const fake = usePlatform([{
      code: 200,
      result: {
        playlistCount: 3,
        playlists: [
          { id: 1, name: 'Lilyco42 精选', coverImgUrl: 'https://img/1', trackCount: 10, playCount: 5, creator: { nickname: '别人', userId: 9 } },
          { id: 2, name: '随便', coverImgUrl: '', trackCount: 0, playCount: 0, creator: { nickname: 'LILYCO42', userId: 42 } },
          { id: 3, name: '没关联', creator: { nickname: '甲', userId: 3 } },
        ],
      },
    }])

    const r = await searchWyPlaylists('Lilyco42', 1, 24)

    expect(fake.count).toBe(1)
    expect(String(fake.calls[0]?.form?.params ?? '')).toMatch(/^[0-9A-F]+$/)
    expect(r.total).toBe(3)
    expect(r.list.map(p => p.id)).toEqual(['1', '2', '3'])
    expect(r.list.map(p => p.match)).toEqual(['name', 'creator', 'other'])
    expect(r.list[0]).toMatchObject({ cover: 'https://img/1', trackCount: 10, playCount: 5, creator: '别人' })
  })

  it('空关键词不发请求；接口错误原样抛出', async () => {
    const fake = usePlatform([{ code: 400 }])
    expect(await searchWyPlaylists('')).toEqual({ total: 0, list: [] })
    expect(fake.count).toBe(0)
    await expect(searchWyPlaylists('x')).rejects.toThrow('网易云返回 code=400')
  })
})

describe('只看同名创建者', () => {
  it('先找完全同名的用户，再拉主页并排除收藏的别人歌单', async () => {
    const fake = usePlatform([
      {
        code: 200,
        result: {
          userprofileCount: 2,
          userprofiles: [
            { nickname: 'Lilyco42 fan', userId: 111, playlistCount: 0 },
            { nickname: 'Lilyco42', userId: 42, playlistCount: 2 },
          ],
        },
      },
      {
        code: 200,
        more: false,
        playlist: [
          { id: 1, name: '0.0', coverImgUrl: 'https://img/a', trackCount: 9, playCount: 11317, userId: 42, creator: { nickname: 'Lilyco42', userId: 42 } },
          { id: 2, name: '别人的歌单', trackCount: 20, playCount: 1, userId: 99, creator: { nickname: '别人', userId: 99 } },
          { id: 3, name: '重力', trackCount: 8, playCount: 2, creator: { nickname: 'Lilyco42', userId: 42 } },
        ],
      },
    ])

    const r = await searchWyPlaylistsByCreator('lilyco42', 2)

    expect(fake.count).toBe(2)
    expect(r.creator).toBe('Lilyco42')
    expect(r.creatorId).toBe(42)
    expect(r.total).toBe(2)
    expect(r.list.map(p => p.id)).toEqual(['1', '3'])
    expect(r.list.every(p => p.match === 'creator' && p.creatorId === 42)).toBe(true)
  })

  it('没有命中用户或关键词为空时返回空结果，且不会多打一次请求', async () => {
    const noUser = usePlatform([{ code: 200, result: { userprofiles: [], userprofileCount: 0 } }])
    expect(await searchWyPlaylistsByCreator('nobody')).toEqual({ creator: '', creatorId: 0, total: 0, list: [] })
    expect(noUser.count).toBe(1)

    const empty = usePlatform([])
    expect(await searchWyPlaylistsByCreator('   ')).toEqual({ creator: '', creatorId: 0, total: 0, list: [] })
    expect(empty.count).toBe(0)
  })
})
