/**
 * Library 批量删歌单（离线单测）。
 *
 * 一次删多张不能退化成「每张都 load/persist/emit」：那样会连写磁盘、
 * 连刷界面、云同步也会被触发一串。这里钉住一次落盘、一次通知。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { setPlatform, Library, type PlatformAdapter } from '@lxmn/core'

const mem = new Map<string, string>()
let writes = 0

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
    set: async (k, v) => { writes += 1; mem.set(k, v) },
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

beforeEach(() => {
  mem.clear()
  writes = 0
  setPlatform(adapter)
})

describe('Library 批量删歌单', () => {
  it('一次过滤、一次落盘、一次通知，重复 id 只算一次', async () => {
    const lib = new Library()
    await lib.load()
    const a = await lib.createPlaylist('A')
    const b = await lib.createPlaylist('B')
    const c = await lib.createPlaylist('C')
    writes = 0

    let notified = 0
    const off = lib.subscribe(() => { notified += 1 })

    expect(await lib.deletePlaylists([a.id, b.id, a.id])).toBe(2)
    expect(lib.snapshot().playlists.map(p => p.id)).toEqual([c.id])
    expect(notified).toBe(1)
    expect(writes).toBe(1)
    const saved = JSON.parse(mem.get('lxmn.library') ?? '{}') as { playlists?: Array<{ id: string }> }
    expect(saved.playlists?.map(p => p.id)).toEqual([c.id])
    off()
  })

  it('删不存在的歌单不写盘、不通知', async () => {
    const lib = new Library()
    await lib.load()
    await lib.createPlaylist('保留')
    writes = 0
    let notified = 0
    lib.subscribe(() => { notified += 1 })

    expect(await lib.deletePlaylists(['pl-missing'])).toBe(0)
    expect(writes).toBe(0)
    expect(notified).toBe(0)
    expect(lib.snapshot().playlists).toHaveLength(1)
  })
})
