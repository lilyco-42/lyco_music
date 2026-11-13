import { beforeEach, describe, expect, it } from 'vitest'
import {
  SEARCH_HISTORY_KEY, clearSearchHistory, normalizeKeyword,
  pushSearchHistory, readSearchHistory, removeSearchHistory,
} from '../apps/desktop/src/lib/search-history'

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() { return map.size },
    clear: () => map.clear(),
    getItem: k => map.get(k) ?? null,
    key: i => [...map.keys()][i] ?? null,
    removeItem: k => { map.delete(k) },
    setItem: (k, v) => { map.set(k, String(v)) },
  } as Storage
}

describe('桌面搜索历史', () => {
  beforeEach(() => {
    globalThis.localStorage = memoryStorage()
    clearSearchHistory()
  })

  it('归一化空白与长度', () => {
    expect(normalizeKeyword('  Taylor   Swift  ')).toBe('Taylor Swift')
    expect(normalizeKeyword('')).toBe('')
    expect(normalizeKeyword('x'.repeat(80))).toHaveLength(60)
    expect(normalizeKeyword(null)).toBe('')
  })

  it('新词置顶、大小写去重、最多 12 条、持久化', () => {
    pushSearchHistory('周杰伦')
    pushSearchHistory('Taylor Swift')
    pushSearchHistory('taylor swift')
    expect(readSearchHistory()).toEqual(['taylor swift', '周杰伦'])
    for (let i = 0; i < 20; i++) pushSearchHistory('歌' + i)
    const list = readSearchHistory()
    expect(list).toHaveLength(12)
    expect(list[0]).toBe('歌19')
    expect(JSON.parse(globalThis.localStorage.getItem(SEARCH_HISTORY_KEY) ?? '[]')).toEqual(list)
  })

  it('删单条与清空', () => {
    pushSearchHistory('A'); pushSearchHistory('B'); pushSearchHistory('C')
    expect(removeSearchHistory('b')).toEqual(['C', 'A'])
    expect(clearSearchHistory()).toEqual([])
    expect(readSearchHistory()).toEqual([])
  })

  it('坏 JSON、非数组、脏元素都不会毒死整份历史', () => {
    globalThis.localStorage.setItem(SEARCH_HISTORY_KEY, '{bad')
    expect(readSearchHistory()).toEqual([])
    globalThis.localStorage.setItem(SEARCH_HISTORY_KEY, '{"a":1}')
    expect(readSearchHistory()).toEqual([])
    globalThis.localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify([null, 8, ' ', '有效', '有效']))
    expect(readSearchHistory()).toEqual(['有效'])
  })
})
