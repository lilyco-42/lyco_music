/**
 * Library（本地曲库）测试。
 *
 * 用内存版 PlatformAdapter，不碰真实网络与磁盘 —— 这样能精确控制
 * 时间（recordPlay 的次数累计、上限裁剪都依赖时间顺序）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { setPlatform, Library, type PlatformAdapter } from '@lxmn/core'

const mem = new Map<string, string>()

const adapter: PlatformAdapter = {
  name: 'web',
  version: 'test',
  crypto: {
    aesEncrypt: () => new Uint8Array(), aesDecrypt: () => new Uint8Array(),
    rsaEncrypt: () => new Uint8Array(), randomBytes: () => new Uint8Array(),
    md5: () => '', sha1: () => '',
  },
  compress: {
    inflateToString: async () => '', inflate: async () => new Uint8Array(),
    deflate: async () => new Uint8Array(),
  },
  http: { request: async () => { throw new Error('no network in this test') } },
  timer: {
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
  },
  storage: {
    get: async k => mem.get(k) ?? null,
    set: async (k, v) => { mem.set(k, v) },
    remove: async k => { mem.delete(k) },
    keys: async () => [...mem.keys()],
  },
  codec: {
    utf8Encode: s => new Uint8Array(Buffer.from(s, 'utf8')),
    utf8Decode: b => Buffer.from(b).toString('utf8'),
    base64Encode: b => Buffer.from(typeof b === 'string' ? b : Buffer.from(b)).toString('base64'),
    base64Decode: s => new Uint8Array(Buffer.from(s, 'base64')),
    decodeName: s => String(s),
  },
}

function song(source: string, songmid: string, name = 'n') {
  return { source, songmid, name, singer: 'x' }
}

beforeEach(() => {
  mem.clear()
  setPlatform(adapter)
})

describe('Library 收藏', () => {
  it('切换收藏：加一次、再切一次就没了', async () => {
    const lib = new Library()
    await lib.load()
    expect(await lib.toggleFavorite(song('wy', '1'))).toBe(true)
    expect(lib.isFavorite(song('wy', '1'))).toBe(true)
    expect(await lib.toggleFavorite(song('wy', '1'))).toBe(false)
    expect(lib.isFavorite(song('wy', '1'))).toBe(false)
  })

  it('跨音源的同 songmid 不算同一首', async () => {
    const lib = new Library()
    await lib.load()
    await lib.toggleFavorite(song('wy', '1'))
    expect(lib.isFavorite(song('kg', '1'))).toBe(false)
  })

  it('songmid 数字/字符串视为同一首', async () => {
    const lib = new Library()
    await lib.load()
    await lib.toggleFavorite(song('wy', '1'))
    expect(lib.isFavorite({ source: 'wy', songmid: 1, name: 'n', singer: 'x' })).toBe(true)
  })

  it('新收藏排在最前', async () => {
    const lib = new Library()
    await lib.load()
    await lib.toggleFavorite(song('wy', '1', 'A'))
    await lib.toggleFavorite(song('wy', '2', 'B'))
    expect(lib.snapshot().favorites.map(f => f.name)).toEqual(['B', 'A'])
  })
})

describe('Library 播放记录', () => {
  it('同一首歌累计次数而不是产生多条', async () => {
    const lib = new Library()
    await lib.load()
    await lib.recordPlay(song('wy', '1'))
    await lib.recordPlay(song('wy', '1'))
    await lib.recordPlay(song('wy', '1'))
    const h = lib.snapshot().history
    expect(h).toHaveLength(1)
    expect(h[0]!.playCount).toBe(3)
  })

  it('重播会把它移到最前', async () => {
    const lib = new Library()
    await lib.load()
    await lib.recordPlay(song('wy', '1', 'A'))
    await lib.recordPlay(song('wy', '2', 'B'))
    await lib.recordPlay(song('wy', '1', 'A'))
    expect(lib.snapshot().history.map(h => h.name)).toEqual(['A', 'B'])
  })

  it('清空记录', async () => {
    const lib = new Library()
    await lib.load()
    await lib.recordPlay(song('wy', '1'))
    await lib.clearHistory()
    expect(lib.snapshot().history).toEqual([])
  })
})

describe('Library 歌单', () => {
  it('创建后可以加歌，重复加同一首不生效', async () => {
    const lib = new Library()
    await lib.load()
    const pl = await lib.createPlaylist('我的')
    expect(await lib.addToPlaylist(pl.id, song('wy', '1'))).toBe(true)
    expect(await lib.addToPlaylist(pl.id, song('wy', '1'))).toBe(false)
    expect(lib.snapshot().playlists[0]!.items).toHaveLength(1)
  })

  it('加歌会推进 updatedAt（同步靠它判新旧）', async () => {
    const lib = new Library()
    await lib.load()
    const pl = await lib.createPlaylist('我的')
    const before = pl.updatedAt
    await new Promise(r => setTimeout(r, 5))
    await lib.addToPlaylist(pl.id, song('wy', '1'))
    expect(lib.snapshot().playlists[0]!.updatedAt).toBeGreaterThan(before)
  })

  it('删歌与删歌单', async () => {
    const lib = new Library()
    await lib.load()
    const pl = await lib.createPlaylist('我的')
    await lib.addToPlaylist(pl.id, song('wy', '1'))
    await lib.removeFromPlaylist(pl.id, song('wy', '1'))
    expect(lib.snapshot().playlists[0]!.items).toHaveLength(0)
    await lib.deletePlaylist(pl.id)
    expect(lib.snapshot().playlists).toHaveLength(0)
  })

  it('空名 / 纯空格建成默认名，名字里的多余空白会被压掉', async () => {
    const lib = new Library()
    await lib.load()
    const a = await lib.createPlaylist('   ')
    expect(a.name).toBe('新建歌单')
    const b = await lib.createPlaylist('  夜里   听的  ')
    expect(b.name).toBe('夜里 听的')
  })

  it('改名：成功、拒绝空名、拒绝同名', async () => {
    const lib = new Library()
    await lib.load()
    const a = await lib.createPlaylist('A')
    const b = await lib.createPlaylist('B')

    expect(await lib.renamePlaylist(a.id, '新名字')).toBe(true)
    expect(lib.snapshot().playlists.find(p => p.id === a.id)!.name).toBe('新名字')

    // 空名不生效，名字保持原样
    expect(await lib.renamePlaylist(a.id, '   ')).toBe(false)
    expect(lib.snapshot().playlists.find(p => p.id === a.id)!.name).toBe('新名字')

    // 撞上另一个歌单的名字也不生效
    expect(await lib.renamePlaylist(a.id, 'B')).toBe(false)
    expect(lib.snapshot().playlists.find(p => p.id === a.id)!.name).toBe('新名字')

    // 改成自己原来的名字算无操作，但也不是失败
    expect(await lib.renamePlaylist(b.id, 'B')).toBe(false)

    // 改完能持久化
    const again = new Library()
    await again.load()
    expect(again.snapshot().playlists.find(p => p.id === a.id)!.name).toBe('新名字')
  })

  it('改名会推进 updatedAt（否则同步时远端旧名会赢）', async () => {
    const lib = new Library()
    await lib.load()
    const pl = await lib.createPlaylist('旧')
    const before = pl.updatedAt
    await new Promise(r => setTimeout(r, 5))
    await lib.renamePlaylist(pl.id, '新')
    expect(lib.snapshot().playlists.find(p => p.id === pl.id)!.updatedAt).toBeGreaterThan(before)
  })
})

describe('Library 不喜欢的歌曲', () => {
  it('标记后能查出来，取消后查不出来', async () => {
    const lib = new Library()
    await lib.load()
    expect(lib.isDisliked({ name: '晴天', singer: '周杰伦' })).toBe(false)
    await lib.addDislikes([{ name: '晴天', singer: '周杰伦' }])
    expect(lib.isDisliked({ name: '晴天', singer: '周杰伦' })).toBe(true)
    await lib.removeDislike({ name: '晴天', singer: '周杰伦' })
    expect(lib.isDisliked({ name: '晴天', singer: '周杰伦' })).toBe(false)
  })

  it('重复标记同一首不会产生两条规则', async () => {
    const lib = new Library()
    await lib.load()
    await lib.addDislikes([{ name: '晴天', singer: '周杰伦' }])
    await lib.addDislikes([{ name: '晴天', singer: '周杰伦' }])
    expect(lib.dislikes).toHaveLength(1)
    expect(lib.dislikeIndex.count).toBe(1)
  })

  it('批量标记多首一次生效', async () => {
    const lib = new Library()
    await lib.load()
    await lib.addDislikes([
      { name: '晴天', singer: '周杰伦' },
      // 只给歌名 → 屏蔽所有叫「学猫叫」的（不管谁唱）
      { name: '学猫叫' },
      // 只给歌手 → 屏蔽这个人的所有歌
      { singer: '薛之谦' },
    ])
    expect(lib.dislikes).toEqual(['晴天@周杰伦', '学猫叫', '@薛之谦'])
    expect(lib.isDisliked({ name: '学猫叫', singer: '任何人' })).toBe(true)
    expect(lib.isDisliked({ name: '随便一首', singer: '薛之谦' })).toBe(true)
    expect(lib.isDisliked({ name: '晴天', singer: '翻唱歌手' })).toBe(false)
  })

  it('整体替换规则文本（设置页保存走这条路）', async () => {
    const lib = new Library()
    await lib.load()
    await lib.setDislikeRules('晴天@周杰伦\n@薛之谦\n\n  重复行去重  \n重复行去重')
    expect(lib.dislikes).toEqual(['晴天@周杰伦', '@薛之谦', '重复行去重'])
    expect(lib.isDisliked({ name: '演员', singer: '薛之谦' })).toBe(true)
  })

  it('清空规则', async () => {
    const lib = new Library()
    await lib.load()
    await lib.setDislikeRules('晴天@周杰伦')
    await lib.clearDislikes()
    expect(lib.dislikes).toEqual([])
    expect(lib.isDisliked({ name: '晴天', singer: '周杰伦' })).toBe(false)
  })

  it('规则会写进存储，重开一次还在', async () => {
    const first = new Library()
    await first.load()
    await first.addDislikes([{ name: '晴天', singer: '周杰伦' }])

    const second = new Library()
    await second.load()
    expect(second.dislikes).toEqual(['晴天@周杰伦'])
    expect(second.isDisliked({ name: '晴天', singer: '周杰伦' })).toBe(true)
  })

  it('老版本的库没有 dislikes 字段时按空处理，不报错', async () => {
    mem.set('lxmn.library', JSON.stringify({
      favorites: [], playlists: [], history: [], settings: {}, settingsUpdatedAt: 0,
    }))
    const lib = new Library()
    await lib.load()
    expect(lib.dislikes).toEqual([])
    expect(lib.isDisliked({ name: '晴天', singer: '周杰伦' })).toBe(false)
  })

  it('同步载荷里带着规则，合并时取并集', async () => {
    const lib = new Library()
    await lib.load()
    await lib.addDislikes([{ name: '晴天', singer: '周杰伦' }])
    expect(lib.toPayload().dislikes).toEqual(['晴天@周杰伦'])

    await lib.replace({
      settings: {}, settingsUpdatedAt: 0,
      favorites: [], playlists: [], history: [],
      dislikes: ['@薛之谦'],
    })
    expect(lib.dislikes.sort()).toEqual(['@薛之谦', '晴天@周杰伦'].sort())
    expect(lib.isDisliked({ name: '演员', singer: '薛之谦' })).toBe(true)
    expect(lib.isDisliked({ name: '晴天', singer: '周杰伦' })).toBe(true)
  })
})

describe('Library 持久化与同步', () => {
  it('load 能把上次存的读回来', async () => {
    const a = new Library()
    await a.load()
    await a.toggleFavorite(song('wy', '1', 'A'))
    const b = new Library()
    await b.load()
    expect(b.snapshot().favorites).toHaveLength(1)
    expect(b.snapshot().favorites[0]!.name).toBe('A')
  })

  it('默认同步服务器是 lain42.top', () => {
    const lib = new Library()
    expect(lib.syncServer).toBe('https://lain42.top/studio')
  })

  it('可以指定自建同步服务器', () => {
    const lib = new Library({ syncBaseUrl: 'https://my.example.com/studio' })
    expect(lib.syncServer).toBe('https://my.example.com/studio')
  })

  it('只填域名时自动补上 /studio（lain42.top 的 API 前缀规则）', async () => {
    const lib = new Library({ syncBaseUrl: 'lain42.top' })
    expect(lib.syncServer).toBe('https://lain42.top/studio')
  })

  it('没配同步时 syncNow 返回 disabled 而不是抛错', async () => {
    const lib = new Library()
    await lib.load()
    const r = await lib.syncNow()
    expect(r.state).toBe('disabled')
  })

  it('updateSettings 会推进 settingsUpdatedAt', async () => {
    const lib = new Library()
    await lib.load()
    expect(lib.snapshot().settingsUpdatedAt).toBe(0)
    await lib.updateSettings({ quality: '320k' })
    expect(lib.snapshot().settingsUpdatedAt).toBeGreaterThan(0)
    expect(lib.snapshot().settings.quality).toBe('320k')
  })

  it('没 load 就 recordPlay 不能抹掉已存数据（回归）', async () => {
    // 先存一份数据
    const a = new Library()
    await a.load()
    await a.toggleFavorite(song('wy', 'keep', '必须保住'))

    // 新实例，故意不 load 就直接记播放 —— 模拟「用户开机直接点歌」。
    // 早期实现下这次写回会用空库覆盖存储，收藏就没了。
    const b = new Library()
    await b.recordPlay(song('kg', 'new', '新听的'))

    const c = new Library()
    await c.load()
    expect(c.snapshot().favorites.some(f => f.songmid === 'keep')).toBe(true)
    expect(c.snapshot().history.some(h => h.songmid === 'new')).toBe(true)
  })

  it('没 load 就 toggleFavorite 也不能抹掉已存数据（回归）', async () => {
    const a = new Library()
    await a.load()
    await a.toggleFavorite(song('wy', 'keep', '必须保住'))

    const b = new Library()
    await b.toggleFavorite(song('kg', 'added', '新收藏'))

    const c = new Library()
    await c.load()
    expect(c.snapshot().favorites.map(f => f.songmid).sort()).toEqual(['added', 'keep'])
  })

  it('replace 合并而不是覆盖 —— 本地独有的收藏不会丢', async () => {
    const lib = new Library()
    await lib.load()
    await lib.toggleFavorite(song('wy', '1', '本地'))
    await lib.replace({
      settings: {}, settingsUpdatedAt: 0,
      favorites: [{ source: 'kg', songmid: '2', name: '远端', singer: 'x', addedAt: Date.now() }],
      playlists: [], history: [],
    })
    expect(lib.snapshot().favorites).toHaveLength(2)
  })
})