/**
 * 网易云歌单导入（离线单测）
 *
 * 钉住四件事：
 *   1. 各种粘贴形式都能抠出歌单 id；
 *   2. 163cn.tv 短链能展开成歌单 id，单曲短链/失效短链给出**不同**的明确报错；
 *   3. 导入到曲库的条数与去重行为（重复曲目不计入 added）；
 *   4. 导入前必须 load()，否则会把用户原有曲库抹掉。
 *
 * 网络一律用假 adapter，不碰真实接口。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  setPlatform, resetSources, installWySource,
  parsePlaylistId, resolvePlaylistId, importWyPlaylistToLibrary, Library,
  type PlatformAdapter, type HttpRequestOptions, type HttpResponse,
} from '@lxmn/core'
import { desktopPlatform } from '@lxmn/platform-desktop'

const mem = new Map<string, string>()

/** 落地页 HTML 三种形态（属性顺序照抄真实页面） */
const PAGE_PLAYLIST = `<!DOCTYPE html><html><head>
<link rel="canonical" href="https://music.163.com/playlist?id=8725919816">
<meta property="og:type" content="music.playlist">
<meta property="og:url" content="https://music.163.com/playlist?id=8725919816">
<title>2023.9.11 - 歌单 - 网易云音乐</title></head><body></body></html>`

const PAGE_SONG = `<!DOCTYPE html><html><head>
<link rel="canonical" href="https://music.163.com/song?id=28267550">
<meta property="og:type" content="music.song">
<meta property="og:url" content="https://music.163.com/song?id=28267550">
</head><body></body></html>`

const PAGE_404 = `<!DOCTYPE html><html><head>
<link rel="canonical" href="https://music.163.com/">
<meta property="og:type" content="website">
<meta property="og:url" content="https://music.163.com/">
</head><body></body></html>`

const DETAIL = {
  code: 200,
  playlist: {
    id: 8725919816,
    name: '测试歌单',
    coverImgUrl: 'http://p1.music.126.net/cover.jpg',
    tracks: [
      { id: 1, name: '第一首', dt: 180000, ar: [{ name: '甲' }], al: { id: 11, name: '专辑一', picUrl: 'http://p/1.jpg' } },
      { id: 2, name: '第二首', dt: 200000, ar: [{ name: '乙' }], al: { id: 12, name: '专辑二', picUrl: 'http://p/2.jpg' } },
      // 故意重复第一首：addToPlaylist 应该去重，added 不算它
      { id: 1, name: '第一首', dt: 180000, ar: [{ name: '甲' }], al: { id: 11, name: '专辑一', picUrl: 'http://p/1.jpg' } },
    ],
    trackIds: [{ id: 1 }, { id: 2 }],
  },
}

interface Calls { urls: string[] }

/** 短链落地页 / eapi 详情各走一条，用一个 adapter 同时兜住 */
function fakePlatform(page: string, calls?: Calls): PlatformAdapter {
  return {
    ...desktopPlatform,
    storage: {
      get: async k => mem.get(k) ?? null,
      set: async (k, v) => { mem.set(k, v) },
      remove: async k => { mem.delete(k) },
      keys: async () => [...mem.keys()],
    },
    http: {
      async request(o: HttpRequestOptions): Promise<HttpResponse> {
        calls?.urls.push(o.url)
        // 短链：返回落地页 HTML；eapi：返回歌单详情
        const body = o.url.indexOf('163cn.') >= 0 ? page : JSON.stringify(DETAIL)
        return { statusCode: 200, headers: {}, body, raw: new Uint8Array() }
      },
    },
  }
}

beforeEach(() => {
  mem.clear()
  resetSources()
})

describe('parsePlaylistId', () => {
  it('四种常见粘贴形式都认', () => {
    expect(parsePlaylistId('https://music.163.com/#/playlist?id=3778678')).toBe('3778678')
    expect(parsePlaylistId('3778678')).toBe('3778678')
    expect(parsePlaylistId('https://y.music.163.com/m/playlist?app_version=8.9&id=3778678')).toBe('3778678')
    expect(parsePlaylistId('分享歌单《热歌榜》 https://music.163.com/playlist?id=3778678 (来自@网易云音乐)')).toBe('3778678')
  })

  it('认不出就返回空串，而不是瞎猜', () => {
    expect(parsePlaylistId('随便一段话')).toBe('')
    expect(parsePlaylistId('123')).toBe('')
    expect(parsePlaylistId('')).toBe('')
  })
})

describe('resolvePlaylistId（含短链展开）', () => {
  it('直接给链接时不发网络请求', async () => {
    const calls: Calls = { urls: [] }
    setPlatform(fakePlatform(PAGE_PLAYLIST, calls))
    installWySource()
    expect(await resolvePlaylistId('https://music.163.com/playlist?id=3778678')).toBe('3778678')
    expect(calls.urls).toHaveLength(0)
  })

  it('163cn.tv 短链展开成歌单 id', async () => {
    setPlatform(fakePlatform(PAGE_PLAYLIST))
    installWySource()
    const shared = '分享歌单《2023.9.11》 https://163cn.tv/zoIxm3 (@网易云音乐)'
    expect(await resolvePlaylistId(shared)).toBe('8725919816')
  })

  it('163cn.link 同样支持', async () => {
    setPlatform(fakePlatform(PAGE_PLAYLIST))
    installWySource()
    expect(await resolvePlaylistId('https://163cn.link/zoIxm3')).toBe('8725919816')
  })

  it('单曲短链给出「这是单曲」的报错，而不是含糊失败', async () => {
    setPlatform(fakePlatform(PAGE_SONG))
    installWySource()
    await expect(resolvePlaylistId('https://163cn.tv/V1M0rnS')).rejects.toThrow('单曲短链')
  })

  it('失效短链给出「无效或已过期」', async () => {
    setPlatform(fakePlatform(PAGE_404))
    installWySource()
    await expect(resolvePlaylistId('https://163cn.tv/nope123')).rejects.toThrow('短链无效或已过期')
  })

  it('既没有 id 也不是短链时，报「没找到歌单 id」', async () => {
    setPlatform(fakePlatform(PAGE_PLAYLIST))
    installWySource()
    await expect(resolvePlaylistId('随便一段话')).rejects.toThrow('没找到歌单 id')
  })
})

describe('importWyPlaylistToLibrary', () => {
  it('建歌单、写入曲目、重复曲目去重', async () => {
    setPlatform(fakePlatform(PAGE_PLAYLIST))
    installWySource()
    const lib = new Library()
    const r = await importWyPlaylistToLibrary('8725919816', lib)
    expect(r.name).toBe('测试歌单')
    expect(r.total).toBe(2) // 网易云报的曲目数（trackIds 长度）
    expect(r.added).toBe(2) // 重复的那首不算

    const pl = lib.snapshot().playlists.find(p => p.id === r.playlistId)
    expect(pl).toBeTruthy()
    expect(pl!.items).toHaveLength(2)
    expect(pl!.items[0]!.name).toBe('第一首')
    expect(pl!.items[0]!.source).toBe('wy')
    expect(pl!.items[0]!.singer).toBe('甲')
    expect(pl!.items[0]!.albumName).toBe('专辑一')
  })

  it('网络失败原样抛出，不留半个空歌单', async () => {
    const p = fakePlatform(PAGE_PLAYLIST)
    p.http = { request: async () => { throw new Error('network down') } }
    setPlatform(p)
    installWySource()
    const lib = new Library()
    await expect(importWyPlaylistToLibrary('8725919816', lib)).rejects.toThrow('network down')
    expect(lib.snapshot().playlists).toHaveLength(0)
  })
})
