/* eslint-disable no-undef */
/**
 * 测试环境垫片。
 *
 * react-native-track-player 是原生模块，Node 里没有实现，必须整体 mock；
 * 否则任何 import 到 player.ts 的组件都会在加载阶段炸掉。
 */
jest.mock('react-native-track-player', () => {
  const noop = async () => undefined
  const player = {
    setupPlayer: noop,
    updateOptions: noop,
    add: noop,
    reset: noop,
    play: noop,
    pause: noop,
    seekTo: noop,
    setVolume: noop,
    getPlaybackState: async () => ({ state: 'paused' }),
  }
  const emitter = { addEventListener: () => ({ remove: () => {} }) }
  return {
    __esModule: true,
    default: player,
    Capability: { Play: 1, Pause: 2, SkipToNext: 3, SkipToPrevious: 4, SeekTo: 5, Stop: 6 },
    AppKilledPlaybackBehavior: { StopPlaybackAndRemoveNotification: 'stop' },
    State: { Playing: 'playing', Paused: 'paused', Buffering: 'buffering' },
    Event: {
      PlaybackActiveTrackChanged: 'PlaybackActiveTrackChanged',
      PlaybackState: 'PlaybackState',
      PlaybackQueueEnded: 'PlaybackQueueEnded',
    },
    useProgress: () => ({ position: 0, duration: 0, buffered: 0 }),
    usePlaybackState: () => ({ state: 'paused' }),
    ...emitter,
  }
})

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
    multiGet: jest.fn(async () => []),
    multiSet: jest.fn(async () => undefined),
    getAllKeys: jest.fn(async () => []),
  },
}))
