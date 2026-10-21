/**
 * 播放页：评论面板与爱心（组件级，act + RTL）。
 *
 * 之前这两个按钮都是「死的」——点了没有任何反应，也没有任何自动化能发现。
 * 这条测试保证：点评论会切到评论面板并渲染出真实评论；点爱心会写入曲库。
 */
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import PlayerScreen from '../src/screens/PlayerScreen'

const mockToggleFavorite = jest.fn(async () => undefined)
const mockAddDislikes = jest.fn(async () => undefined)
const mockRemoveDislike = jest.fn(async () => undefined)
/** 内核里「是否已屏蔽」的索引，测试里手动翻（jest.mock 工厂只允许引用 mock* 变量） */
let mockDisliked = false

jest.mock('../src/player', () => {
  const item = { songmid: '9', name: '测试歌曲', singer: '测试歌手', source: 'wy', albumName: '专辑', interval: '03:00' }
  return {
    currentItem: () => item,
    usePlayerState: () => ({
      queue: [item], index: 0, playing: false, loading: false, error: '',
      quality: '320k', lyric: '[00:01.00]第一句', tlyric: '', picUrl: '', mode: 'loop',
    }),
    useProgressState: () => ({ position: 1, duration: 180, playing: false }),
    useLyricLines: () => ({ lines: [{ time: 1, text: '第一句' }], activeIndex: 0 }),
    cycleMode: jest.fn(() => 'single'),
    modeLabel: () => '列表循环',
    cycleQuality: jest.fn(),
    next: jest.fn(), prev: jest.fn(), seek: jest.fn(), toggle: jest.fn(), play: jest.fn(),
  }
})

jest.mock('../src/sync', () => ({
  library: {
    load: jest.fn(async () => undefined),
    snapshot: () => ({ favorites: [] }),
    toggleFavorite: (...a: unknown[]) => mockToggleFavorite(...a),
    // 播放页渲染时会读 isDisliked 决定图标亮不亮；缺了它组件会直接抛异常
    isDisliked: () => mockDisliked,
    addDislikes: (...a: unknown[]) => mockAddDislikes(...a),
    removeDislike: (...a: unknown[]) => mockRemoveDislike(...a),
  },
}))

jest.mock('@lxmn/core', () => ({
  getSource: () => ({
    id: 'wy',
    name: '网易云',
    getComments: jest.fn(async () => ({
      list: [
        { id: 'h1', content: '这是一条热评', userName: '甲', avatar: '', likedCount: 999, time: 1700000000000, hot: true },
        { id: 'c2', content: '这是一条普通评论', userName: '乙', avatar: '', likedCount: 3, time: 1700000100000 },
      ],
      total: 2,
      more: false,
      page: 1,
      limit: 20,
    })),
  }),
  hasSource: () => true,
  listSources: () => ['wy'],
  parseLyric: () => ({ lines: [{ time: 1, text: '第一句' }], hasTranslation: false }),
  findLineIndex: () => 0,
}))

describe('播放页评论与爱心', () => {
  it('点评论图标弹出评论面板并渲染评论', async () => {
    render(<PlayerScreen />)

    // 初始是歌词页
    expect(screen.getByText('第一句')).toBeTruthy()
    // 评论是底部弹层，没打开时不该存在
    expect(screen.queryByText('这是一条热评')).toBeNull()

    fireEvent.press(screen.getByLabelText('评论'))

    await waitFor(() => expect(screen.getByText('这是一条热评')).toBeTruthy())
    expect(screen.getByText('这是一条普通评论')).toBeTruthy()
    expect(screen.getByText('热评')).toBeTruthy()

    // 「关闭」收起弹层
    fireEvent.press(screen.getByText('关闭'))
    await waitFor(() => expect(screen.queryByText('这是一条热评')).toBeNull())
  }, 20000)

  it('点爱心写入曲库', async () => {
    render(<PlayerScreen />)
    fireEvent.press(screen.getByLabelText('收藏'))
    await waitFor(() => expect(mockToggleFavorite).toHaveBeenCalled())
  }, 20000)

  it('点「不喜欢」写入屏蔽规则（歌名 + 歌手）', async () => {
    mockDisliked = false
    mockAddDislikes.mockClear()
    render(<PlayerScreen />)
    fireEvent.press(screen.getByLabelText('不喜欢'))
    await waitFor(() =>
      expect(mockAddDislikes).toHaveBeenCalledWith([{ name: '测试歌曲', singer: '测试歌手' }]),
    )
  }, 20000)

  it('已屏蔽时按钮变成「取消不喜欢」，点击是移除规则', async () => {
    mockDisliked = true
    mockRemoveDislike.mockClear()
    render(<PlayerScreen />)
    fireEvent.press(screen.getByLabelText('取消不喜欢'))
    await waitFor(() =>
      expect(mockRemoveDislike).toHaveBeenCalledWith({ name: '测试歌曲', singer: '测试歌手' }),
    )
    mockDisliked = false
  }, 20000)
})
