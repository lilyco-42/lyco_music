/**
 * 试听列表测试。
 *
 * 分两层：
 *   1. 纯函数（trialAdd / trialMoveTo / trialShift …）—— 顺序与去重规则
 *   2. Library 集成 —— 落盘、同步合并、跨列表转存
 *
 * 顺序是这块最容易被写错的地方，所以每个「移动」用例都写清了
 * 「剩下哪些歌 + 插在第几位」的中间状态。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  setPlatform,
  Library,
  trackKey,
  dedupeTracks,
  trialAdd,
  trialRemove,
  trialRemoveKeys,
  trialMoveTo,
  trialShift,
  trialTakeOut,
  trialHas,
  trialIndexOf,
  TRIAL_MAX,
  mergeTrial,
  mergePayload,
  emptyPayload,
  type PlatformAdapter,
  type MusicItem,
} from '@lxmn/core'

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

beforeEach(() => {
  mem.clear()
  setPlatform(adapter)
})

function song(mid: string, name = mid): MusicItem {
  return { source: 'wy', songmid: mid, name, singer: 's' }
}

const names = (list: readonly MusicItem[]): string[] => list.map(x => String(x.songmid))

describe('trackKey', () => {
  it('带 source：同一首跨音源算两条', () => {
    expect(trackKey({ source: 'wy', songmid: '1' })).toBe('wy::1')
    expect(trackKey({ source: 'kw', songmid: '1' })).not.toBe(trackKey({ source: 'wy', songmid: '1' }))
  })

  it('songmid 是数字也当字符串处理（接口有时给 number）', () => {
    expect(trackKey({ source: 'wy', songmid: 123 })).toBe(trackKey({ source: 'wy', songmid: '123' }))
  })

  it('空值不抛错', () => {
    expect(trackKey(null)).toBe('::')
    expect(trackKey(undefined)).toBe('::')
  })

  it('dedupeTracks 保留首次出现的位置', () => {
    const out = dedupeTracks([song('a'), song('b'), song('a'), song('c')])
    expect(names(out)).toEqual(['a', 'b', 'c'])
  })
})

describe('trialAdd', () => {
  it('默认加到头部（最近点的在最前）', () => {
    const out = trialAdd([song('b')], [song('a')])
    expect(names(out)).toEqual(['a', 'b'])
  })

  it('加到尾部', () => {
    const out = trialAdd([song('b')], [song('a')], 'bottom')
    expect(names(out)).toEqual(['b', 'a'])
  })

  it('已存在的不重复加，也不挪位置', () => {
    const out = trialAdd([song('a'), song('b')], [song('b')])
    expect(names(out)).toEqual(['a', 'b'])
  })

  it('一次加多首时，批内也去重', () => {
    const out = trialAdd([], [song('a'), song('b'), song('a')])
    expect(names(out)).toEqual(['a', 'b'])
  })

  it('不修改传入的数组（纯函数）', () => {
    const base = [song('b')]
    trialAdd(base, [song('a')])
    expect(names(base)).toEqual(['b'])
  })

  it('没有新增时返回等值的新数组，不抛错', () => {
    const out = trialAdd([song('a')], [])
    expect(names(out)).toEqual(['a'])
  })

  it('加到头部超过上限时，截掉尾部（最老的）', () => {
    const base = Array.from({ length: TRIAL_MAX }, (_, i) => song('old' + i))
    const out = trialAdd(base, [song('new')])
    expect(out.length).toBe(TRIAL_MAX)
    expect(names(out)[0]).toBe('new')
    expect(names(out).includes('old' + (TRIAL_MAX - 1))).toBe(false)
  })

  it('加到尾部超过上限时，截掉头部（同样是最老的）', () => {
    const base = Array.from({ length: TRIAL_MAX }, (_, i) => song('old' + i))
    const out = trialAdd(base, [song('new')], 'bottom')
    expect(out.length).toBe(TRIAL_MAX)
    expect(names(out)[out.length - 1]).toBe('new')
    expect(names(out).includes('old0')).toBe(false)
  })
})

describe('trialRemove / trialRemoveKeys', () => {
  it('按对象删', () => {
    expect(names(trialRemove([song('a'), song('b')], [song('a')]))).toEqual(['b'])
  })

  it('按键删', () => {
    expect(names(trialRemoveKeys([song('a'), song('b')], [trackKey(song('b'))]))).toEqual(['a'])
  })

  it('删不存在的没影响', () => {
    expect(names(trialRemove([song('a')], [song('zz')]))).toEqual(['a'])
  })
})

describe('trialMoveTo（对应 lx 的 createSortedList）', () => {
  const base = [song('A'), song('B'), song('C'), song('D')]

  it('移到末尾（position 要等于剩下那部分的长度）', () => {
    // 剩下 [B, C, D]，插到下标 3 = 末尾
    expect(names(trialMoveTo(base, 3, [trackKey(song('A'))]))).toEqual(['B', 'C', 'D', 'A'])
    // 插到下标 2 只是「D 前面」，不是末尾
    expect(names(trialMoveTo(base, 2, [trackKey(song('A'))]))).toEqual(['B', 'C', 'A', 'D'])
  })

  it('position 是「剩下的歌」里的下标，不是原列表下标', () => {
    // 剩下 [A, D]，在 1 处插入 B,C → [A, B, C, D]
    const out = trialMoveTo(base, 1, [trackKey(song('B')), trackKey(song('C'))])
    expect(names(out)).toEqual(['A', 'B', 'C', 'D'])
    // 同一个 position 换成插到 2 → [A, D, B, C]
    const out2 = trialMoveTo(base, 2, [trackKey(song('B')), trackKey(song('C'))])
    expect(names(out2)).toEqual(['A', 'D', 'B', 'C'])
  })

  it('多选时按 keys 的顺序排，不按原列表顺序', () => {
    // 用户把 C 拖到 B 前面
    const out = trialMoveTo(base, 0, [trackKey(song('C')), trackKey(song('B'))])
    expect(names(out)).toEqual(['C', 'B', 'A', 'D'])
  })

  it('position 超界会被夹到合法范围', () => {
    expect(names(trialMoveTo(base, 99, [trackKey(song('A'))]))).toEqual(['B', 'C', 'D', 'A'])
    expect(names(trialMoveTo(base, -5, [trackKey(song('D'))]))).toEqual(['D', 'A', 'B', 'C'])
  })

  it('keys 里有不存在的曲目会被忽略', () => {
    expect(names(trialMoveTo(base, 0, [trackKey(song('Z'))]))).toEqual(['A', 'B', 'C', 'D'])
  })
})

describe('trialShift', () => {
  const base = [song('A'), song('B'), song('C')]

  it('上移一位', () => {
    expect(names(trialShift(base, trackKey(song('B')), -1))).toEqual(['B', 'A', 'C'])
  })

  it('下移一位', () => {
    expect(names(trialShift(base, trackKey(song('B')), 1))).toEqual(['A', 'C', 'B'])
  })

  it('在两端时不动（不循环）', () => {
    expect(names(trialShift(base, trackKey(song('A')), -1))).toEqual(['A', 'B', 'C'])
    expect(names(trialShift(base, trackKey(song('C')), 1))).toEqual(['A', 'B', 'C'])
  })
})

describe('trialTakeOut', () => {
  it('拆成「要移走的」和「剩下的」，移走那部分保持原顺序', () => {
    const { moved, rest } = trialTakeOut(
      [song('A'), song('B'), song('C'), song('D')],
      [trackKey(song('D')), trackKey(song('B'))],
    )
    expect(names(moved)).toEqual(['B', 'D'])
    expect(names(rest)).toEqual(['A', 'C'])
  })
})

describe('trialHas / trialIndexOf', () => {
  const base = [song('A'), song('B')]

  it('命中与位置', () => {
    expect(trialHas(base, song('B'))).toBe(true)
    expect(trialIndexOf(base, song('B'))).toBe(1)
  })

  it('没命中返回 false / -1', () => {
    expect(trialHas(base, song('Z'))).toBe(false)
    expect(trialIndexOf(base, song('Z'))).toBe(-1)
  })
})

describe('Library 试听列表', () => {
  it('加一首后能读到，且重复加返回 false', async () => {
    const lib = new Library()
    await lib.load()
    expect(await lib.addToTrial(song('a'))).toBe(true)
    expect(names(lib.trial)).toEqual(['a'])
    expect(await lib.addToTrial(song('a'))).toBe(false)
    expect(lib.trial.length).toBe(1)
  })

  it('isInTrial 是同步的（搜索页每行都要问）', async () => {
    const lib = new Library()
    await lib.load()
    await lib.addToTrial(song('a'))
    expect(lib.isInTrial(song('a'))).toBe(true)
    expect(lib.isInTrial(song('b'))).toBe(false)
  })

  it('addToTrial 接受数组，按顺序插入头部', async () => {
    const lib = new Library()
    await lib.load()
    await lib.addToTrial([song('a'), song('b')])
    expect(names(lib.trial)).toEqual(['a', 'b'])
  })

  it('设置里指定 bottom 时加到尾部', async () => {
    const lib = new Library()
    await lib.load()
    await lib.updateSettings({ addMusicLocationType: 'bottom' })
    await lib.addToTrial(song('a'))
    await lib.addToTrial(song('b'))
    expect(names(lib.trial)).toEqual(['a', 'b'])
  })

  it('落盘后能重新载入（关掉应用再打开还在）', async () => {
    const lib = new Library()
    await lib.load()
    await lib.addToTrial([song('a'), song('b')])
    const again = new Library()
    await again.load()
    expect(names(again.trial)).toEqual(['a', 'b'])
  })

  it('清空后为空，且重复清空不发多余广播', async () => {
    const lib = new Library()
    await lib.load()
    await lib.addToTrial([song('a')])
    let emits = 0
    lib.subscribe(() => { emits++ })
    await lib.clearTrial()
    expect(lib.trial.length).toBe(0)
    await lib.clearTrial()
    expect(emits).toBe(1)
  })

  it('moveInTrial 改顺序并推进 trialUpdatedAt', async () => {
    const lib = new Library()
    await lib.load()
    await lib.addToTrial([song('a'), song('b'), song('c')])
    const before = lib.snapshot().trialUpdatedAt
    await new Promise(r => setTimeout(r, 2))
    await lib.moveInTrial(2, [trackKey(song('a'))])
    expect(names(lib.trial)).toEqual(['b', 'c', 'a'])
    expect(lib.snapshot().trialUpdatedAt).toBeGreaterThanOrEqual(before)
  })

  it('顺序没变时不写盘也不广播', async () => {
    const lib = new Library()
    await lib.load()
    await lib.addToTrial([song('a'), song('b')])
    let emits = 0
    lib.subscribe(() => { emits++ })
    await lib.moveInTrial(0, [trackKey(song('a'))])
    expect(emits).toBe(0)
  })

  it('removeTrialKeys 按键删除', async () => {
    const lib = new Library()
    await lib.load()
    await lib.addToTrial([song('a'), song('b')])
    await lib.removeTrialKeys([trackKey(song('a'))])
    expect(names(lib.trial)).toEqual(['b'])
  })

  it('转存到歌单：进歌单 + 从试听列表移除，顺序跟着走', async () => {
    const lib = new Library()
    await lib.load()
    await lib.addToTrial([song('a'), song('b'), song('c')])
    const pl = await lib.createPlaylist('我的歌单')
    const n = await lib.moveTrialToPlaylist([trackKey(song('c')), trackKey(song('a'))], pl.id)
    expect(n).toBe(2)
    expect(names(lib.trial)).toEqual(['b'])
    expect(names(lib.snapshot().playlists.find(p => p.id === pl.id)!.items)).toEqual(['a', 'c'])
  })

  it('转存到不存在的歌单：什么都不做，试听列表原样保留', async () => {
    const lib = new Library()
    await lib.load()
    await lib.addToTrial([song('a')])
    const n = await lib.moveTrialToPlaylist([trackKey(song('a'))], 'nope')
    expect(n).toBe(0)
    expect(names(lib.trial)).toEqual(['a'])
  })

  it('转存时已在歌单里的歌不重复添加，但仍然从试听列表移除', async () => {
    const lib = new Library()
    await lib.load()
    const pl = await lib.createPlaylist('x')
    await lib.addToPlaylist(pl.id, song('a'))
    await lib.addToTrial([song('a')])
    const n = await lib.moveTrialToPlaylist([trackKey(song('a'))], pl.id)
    expect(n).toBe(0)
    expect(lib.trial.length).toBe(0)
    expect(lib.snapshot().playlists[0]!.items.length).toBe(1)
  })

  it('老库（没有 trial 字段）能正常载入，且数据里的重复会被清掉', async () => {
    mem.set('lxmn.library', JSON.stringify({
      favorites: [], playlists: [], history: [], dislikes: [], settings: {}, settingsUpdatedAt: 0,
    }))
    const lib = new Library()
    await lib.load()
    expect(lib.trial).toEqual([])

    const mem2 = new Map<string, string>()
    mem2.set('lxmn.library', JSON.stringify({
      trial: [song('a'), song('a'), song('b')], trialUpdatedAt: 0,
      favorites: [], playlists: [], history: [], dislikes: [], settings: {}, settingsUpdatedAt: 0,
    }))
    const adapter2: PlatformAdapter = {
      ...adapter,
      storage: {
        get: async k => mem2.get(k) ?? null,
        set: async (k, v) => { mem2.set(k, v) },
        remove: async k => { mem2.delete(k) },
        keys: async () => [...mem2.keys()],
      },
    }
    setPlatform(adapter2)
    const lib2 = new Library()
    await lib2.load()
    expect(names(lib2.trial)).toEqual(['a', 'b'])
  })
})

describe('试听列表同步合并', () => {
  it('时间戳更新的一方定顺序，另一方的独有曲目追加到末尾', () => {
    const local = [song('a'), song('b')]
    const remote = [song('c'), song('b')]
    // 远端更新
    expect(names(mergeTrial(local, remote, 1, 2))).toEqual(['c', 'b', 'a'])
    // 本地更新
    expect(names(mergeTrial(local, remote, 2, 1))).toEqual(['a', 'b', 'c'])
  })

  it('时间戳相同时偏向本地（结果确定，不来回跳）', () => {
    expect(names(mergeTrial([song('a')], [song('b')], 5, 5))).toEqual(['a', 'b'])
  })

  it('合并结果不超过上限', () => {
    const a = Array.from({ length: TRIAL_MAX }, (_, i) => song('a' + i))
    const b = Array.from({ length: TRIAL_MAX }, (_, i) => song('b' + i))
    expect(mergeTrial(a, b, 2, 1).length).toBe(TRIAL_MAX)
  })

  it('mergePayload 带上 trial 与 trialUpdatedAt', () => {
    const local = { ...emptyPayload(), trial: [song('a')], trialUpdatedAt: 1 }
    const remote = { ...emptyPayload(), trial: [song('b')], trialUpdatedAt: 2 }
    const out = mergePayload(local, remote)
    expect(names(out.trial ?? [])).toEqual(['b', 'a'])
    expect(out.trialUpdatedAt).toBe(2)
  })

  it('老载荷没有 trial 字段也能合并', () => {
    const local = { ...emptyPayload() }
    delete (local as { trial?: unknown }).trial
    const out = mergePayload(local, { ...emptyPayload(), trial: [song('a')] })
    expect(names(out.trial ?? [])).toEqual(['a'])
  })
})
