/**
 * 发现页（移动端）—— 排行榜 / 歌单搜索 / 存为歌单。
 *
 * 这台机器没有模拟器，所以这组测试是「移动端能搜歌单」的唯一自动化保障：
 * 榜单能点开、搜索能出结果、点开歌单能播放、能存成自建歌单。
 */
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import DiscoverScreen from '../src/screens/DiscoverScreen'

const TRACKS = [
  { id: 1, name: '屋顶', singer: '周杰伦、温岚', source: 'wy', songmid: 101, interval: '05:19' },
  { id: 2, name: '晴天', singer: '周杰伦', source: 'wy', songmid: 102, interval: '04:29' },
]

const mockSearch = jest.fn(async () => ({
  total: 462,
  list: [
    { id: '6792103822', name: '周杰伦-Jay 精选', cover: '', trackCount: 144, creator: 'Buradarrr', playCount: 34660852 },
    { id: '906055009', name: '周杰伦全收录', cover: '', trackCount: 88, creator: '某人', playCount: 12000 },
  ],
}))
const mockFetch = jest.fn(async () => ({ id: '3778678', name: '热歌榜', cover: '', total: 2, tracks: TRACKS }))
const mockPlay = jest.fn(async () => undefined)

jest.mock('@lxmn/core', () => ({
  WY_BOARDS: [
    { id: '3778678', name: '热歌榜', desc: '此刻最多人在听' },
    { id: '3778676', name: '新歌榜', desc: '新歌速递' },
  ],
  fetchWyPlaylist: (...a: unknown[]) => mockFetch(...(a as [])),
  searchWyPlaylists: (...a: unknown[]) => mockSearch(...(a as [])),
}))

jest.mock('../src/player', () => ({
  play: (...a: unknown[]) => mockPlay(...(a as [])),
  usePlayerState: () => ({ queue: [], index: -1, playing: false }),
}))

const mockCreatePlaylist = jest.fn(async (name: string) => ({ id: 'pl-1', name }))
const mockAddToPlaylist = jest.fn(async () => true)

jest.mock('../src/sync', () => ({
  library: {
    load: jest.fn(async () => undefined),
    addToTrial: jest.fn(async () => true),
    createPlaylist: (...a: unknown[]) => mockCreatePlaylist(...(a as [string])),
    addToPlaylist: (...a: unknown[]) => mockAddToPlaylist(...(a as [])),
  },
}))

beforeEach(() => {
  mockSearch.mockClear()
  mockFetch.mockClear()
  mockPlay.mockClear()
  mockCreatePlaylist.mockClear()
  mockAddToPlaylist.mockClear()
})

describe('发现页 · 排行榜', () => {
  it('默认列出榜单，点开一个就是完整曲目', async () => {
    render(<DiscoverScreen />)

    fireEvent.press(await screen.findByText('热歌榜'))

    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('3778678'))
    expect(await screen.findByText('屋顶')).toBeTruthy()
    expect(screen.getByText('2 首')).toBeTruthy()
  }, 20000)

  it('点曲目就播放，并把整张列表当播放队列', async () => {
    render(<DiscoverScreen />)
    fireEvent.press(await screen.findByText('热歌榜'))

    fireEvent.press(await screen.findByText('屋顶'))

    await waitFor(() => expect(mockPlay).toHaveBeenCalledTimes(1))
    expect(mockPlay).toHaveBeenCalledWith(TRACKS[0], TRACKS)
  }, 20000)
})

describe('发现页 · 歌单搜索', () => {
  it('切到歌单搜索，输入关键词后出结果', async () => {
    render(<DiscoverScreen />)

    fireEvent.press(await screen.findByText('歌单搜索'))
    fireEvent.changeText(await screen.findByPlaceholderText('搜歌单，例如「通勤」「爵士」'), '周杰伦')
    fireEvent.press(screen.getByText('搜索'))

    await waitFor(() => expect(mockSearch).toHaveBeenCalledWith('周杰伦', 1, 24))
    expect(await screen.findByText('周杰伦-Jay 精选')).toBeTruthy()
    expect(screen.getByText('共 462 个歌单，显示前 2 个')).toBeTruthy()
  }, 20000)

  it('点开搜到的歌单，能存成自己的歌单', async () => {
    render(<DiscoverScreen />)

    fireEvent.press(await screen.findByText('歌单搜索'))
    fireEvent.changeText(await screen.findByPlaceholderText('搜歌单，例如「通勤」「爵士」'), '周杰伦')
    fireEvent.press(screen.getByText('搜索'))
    fireEvent.press(await screen.findByText('周杰伦-Jay 精选'))

    fireEvent.press(await screen.findByText('存为歌单'))

    await waitFor(() => expect(mockCreatePlaylist).toHaveBeenCalledWith('热歌榜'))
    expect(mockAddToPlaylist).toHaveBeenCalledTimes(2)
    expect(await screen.findByText('已存为歌单「热歌榜」：2 首（去「我的」里看）')).toBeTruthy()
  }, 20000)

  it('带种子词进来会直接落在歌单搜索并自动搜一次', async () => {
    const onSeedConsumed = jest.fn()
    render(<DiscoverScreen initialKeyword="轻音乐" onSeedConsumed={onSeedConsumed} />)

    await waitFor(() => expect(mockSearch).toHaveBeenCalledWith('轻音乐', 1, 24))
    expect(await screen.findByText('周杰伦-Jay 精选')).toBeTruthy()
    expect(onSeedConsumed).toHaveBeenCalled()
  }, 20000)
})
