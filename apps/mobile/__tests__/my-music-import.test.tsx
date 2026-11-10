/**
 * 我的音乐 · 网易云歌单导入入口（组件级，act + RTL）。
 *
 * 这台机器没有模拟器，所以这条测试是「移动端导入入口真的能点通」的唯一
 * 自动化保障：入口按钮存在 → 弹窗能开 → 粘链接点导入 → 调内核函数 →
 * 刷新歌单列表。
 */
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import MyMusicScreen from '../src/screens/MyMusicScreen'

const mockImport = jest.fn(async () => ({
  name: '测试歌单', total: 3, added: 2, playlistId: 'pl-1',
}))

jest.mock('@lxmn/core', () => ({
  importWyPlaylistToLibrary: (...args: unknown[]) => mockImport(...(args as [])),
}))

jest.mock('../src/player', () => ({
  play: jest.fn(async () => undefined),
  usePlayerState: () => ({ queue: [], index: -1, playing: false }),
}))

const snapshot = {
  playlists: [{ id: 'pl-1', name: '测试歌单', createdAt: 0, updatedAt: 0, items: [] }],
  trial: [],
  favorites: [],
  history: [],
}

jest.mock('../src/sync', () => ({
  library: {
    load: jest.fn(async () => undefined),
    snapshot: () => snapshot,
  },
}))

jest.mock('../src/share', () => ({ getShared: jest.fn(async () => null) }))

describe('我的音乐 · 网易云歌单导入', () => {
  it('入口按钮打开弹窗，粘链接后调用内核导入并回显结果', async () => {
    render(<MyMusicScreen />)

    // 入口按钮始终存在（不依赖任何 props）
    const entry = await screen.findByText('网易云导入')
    fireEvent.press(entry)

    // 弹窗里的输入框
    const input = await screen.findByPlaceholderText('https://music.163.com/playlist?id=123456789')
    fireEvent.changeText(input, '分享歌单《测试》 https://163cn.tv/zoIxm3 (@网易云音乐)')
    fireEvent.press(screen.getByText('开始导入'))

    await waitFor(() => {
      expect(mockImport).toHaveBeenCalledWith(
        '分享歌单《测试》 https://163cn.tv/zoIxm3 (@网易云音乐)',
        expect.anything(),
      )
    })
    await waitFor(() => {
      expect(screen.getByText('已导入「测试歌单」共 2 首（歌单 3 首）')).toBeTruthy()
    })
  }, 20000)

  it('导入失败时显示内核抛出的原始错误文案', async () => {
    mockImport.mockRejectedValueOnce(
      new Error('这是单曲短链，不是歌单。请在网易云里打开歌单再分享，或直接粘歌单链接'),
    )
    render(<MyMusicScreen />)

    fireEvent.press(await screen.findByText('网易云导入'))
    fireEvent.changeText(
      await screen.findByPlaceholderText('https://music.163.com/playlist?id=123456789'),
      'https://163cn.tv/V1M0rnS',
    )
    fireEvent.press(screen.getByText('开始导入'))

    await waitFor(() => {
      expect(screen.getByText(/这是单曲短链，不是歌单/)).toBeTruthy()
    })
  }, 20000)
})
