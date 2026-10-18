/**
 * 搜索页音源筛选（组件级，act + RTL）。
 *
 * 这台机器没有模拟器，所以这条测试是「筛选真的能点」的唯一自动化保障。
 */
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import SearchScreen from '../src/screens/SearchScreen'

// 用两源混合的假结果替换真实搜索，避免测试依赖网络
jest.mock('../src/player', () => {
  const actual = jest.requireActual('../src/player')
  return {
    ...actual,
    play: jest.fn(async () => undefined),
    usePlayerState: () => ({ queue: [], index: -1, playing: false, loading: false, error: '', quality: '320k', lyric: '', tlyric: '', picUrl: '', mode: 'loop' }),
  }
})

jest.mock('@lxmn/core', () => {
  const items = [
    { songmid: '1', name: '网易的歌', singer: 'A', source: 'wy', albumName: 'x' },
    { songmid: '2', name: '酷我的歌', singer: 'B', source: 'kw', albumName: 'y' },
    { songmid: '3', name: '酷我的第二首', singer: 'C', source: 'kw', albumName: 'z' },
  ]
  return {
    // 只保留被测组件真正用到的部分
    listSources: () => ['wy', 'kw'],
    hasSource: () => true,
    getSource: () => ({
      musicSearch: jest.fn(async () => ({ list: items, total: items.length, page: 1, limit: 30, source: 'wy' })),
    }),
    parseLyric: () => ({ lines: [], hasTranslation: false }),
    findLineIndex: () => -1,
  }
})

jest.mock('../src/sync', () => ({
  library: {
    load: jest.fn(async () => undefined),
    snapshot: () => ({ favorites: [] }),
    toggleFavorite: jest.fn(async () => undefined),
  },
}))

describe('搜索页音源筛选', () => {
  it('渲染筛选条并能按音源过滤', async () => {
    render(<SearchScreen initialKeyword="测试" />)

    // 等搜索结果渲染
    await waitFor(() => expect(screen.getByText('网易的歌')).toBeTruthy())
    expect(screen.getByText('酷我的歌')).toBeTruthy()

    // 筛选条出现（全部 + 两个音源）
    const kwChip = screen.getByText(/酷我 2/)
    fireEvent.press(kwChip)

    await waitFor(() => {
      expect(screen.queryByText('网易的歌')).toBeNull()
    })
    expect(screen.getByText('酷我的歌')).toBeTruthy()
    expect(screen.getByText('酷我的第二首')).toBeTruthy()
  }, 20000)
})
