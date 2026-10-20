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

/**
 * safe-area-context 靠原生视图（RNCSafeAreaProvider）量 WindowInsets。
 * 在 Node 里它永远量不出结果，Provider 的子节点渲染不出来，SafeAreaView
 * 也会退化成空壳 —— 于是整棵树都查不到元素。
 *
 * 这里给一份固定 inset：测试只关心「有没有渲染、点了有没有反应」，
 * 具体像素值在真机/模拟器上验证（见 theme.ts 里 useTopInset 的说明）。
 */
jest.mock('react-native-safe-area-context', () => {
  const React = require('react')
  const { View } = require('react-native')
  const insets = { top: 24, bottom: 0, left: 0, right: 0 }
  const frame = { x: 0, y: 0, width: 390, height: 844 }
  return {
    __esModule: true,
    SafeAreaProvider: ({ children }) => React.createElement(View, null, children),
    // edges / mode 是 safe-area 专有属性，别透传给 View（会触发 RN 的未知属性告警）
    SafeAreaView: ({ children, style, edges, mode, ...rest }) =>
      React.createElement(View, { style, ...rest }, children),
    SafeAreaInsetsContext: React.createContext(insets),
    useSafeAreaInsets: () => insets,
    useSafeAreaFrame: () => frame,
    initialWindowMetrics: { insets, frame },
  }
})
