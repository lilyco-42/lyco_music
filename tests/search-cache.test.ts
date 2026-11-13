import { beforeEach, describe, expect, it } from 'vitest'
import type { MusicItem } from '@lxmn/core'
import {
  SEARCH_CACHE_TTL, clearSearchSnapshot, hasSearchSnapshot,
  patchSearchSnapshot, readSearchSnapshot, saveSearchSnapshot,
} from '../apps/desktop/src/lib/search-cache'

const item = { id: 'wy-1', source: 'wy', name: '晴天', singer: '周杰伦' } as MusicItem

function save(at?: number) {
  return saveSearchSnapshot({
    keyword: '周杰伦', list: [item], total: 31,
    source: 'all', tab: 'songs', playlistTotal: 0, at,
  })
}

describe('搜索结果会话缓存', () => {
  beforeEach(() => clearSearchSnapshot())

  it('同关键词（忽略大小写和空白）命中，五分钟内有效', () => {
    const at = 1_000_000
    save(at)
    expect(hasSearchSnapshot()).toBe(true)
    expect(readSearchSnapshot('  周杰伦  ', at + SEARCH_CACHE_TTL)?.list).toEqual([item])
    expect(readSearchSnapshot('周杰伦', at + SEARCH_CACHE_TTL + 1)).toBeNull()
  })

  it('换关键词直接失效，空关键词不缓存', () => {
    save()
    expect(readSearchSnapshot('林俊杰')).toBeNull()
    expect(saveSearchSnapshot({ keyword: '  ', list: [], total: 0, source: 'all', tab: 'songs', playlistTotal: 0 })).toBeNull()
  })

  it('页签/音源筛选/歌单总数可增量还原', () => {
    save()
    patchSearchSnapshot({ source: 'kw' })
    patchSearchSnapshot({ tab: 'playlists', playlistTotal: 7 })
    expect(readSearchSnapshot('周杰伦')).toMatchObject({ source: 'kw', tab: 'playlists', playlistTotal: 7 })
    clearSearchSnapshot()
    expect(hasSearchSnapshot()).toBe(false)
  })
})
