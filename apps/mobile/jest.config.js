/**
 * 移动端组件测试（jest + @testing-library/react-native）。
 *
 * 之所以要它：这台机器上没有 Android SDK / 模拟器，真机验证不了，
 * 于是 UI 逻辑（筛选、收藏、评论切换、播放模式）只能靠「类型检查 + 打包成功」兜底。
 * 有了 act + 测试渲染器，至少能在 Node 里把交互跑一遍。
 */
module.exports = {
  preset: 'react-native',
  setupFiles: ['<rootDir>/jest.setup.js'],
  testMatch: ['<rootDir>/__tests__/**/*.test.tsx', '<rootDir>/__tests__/**/*.test.ts'],
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|@react-native-community|react-native-track-player)/)',
  ],
  moduleNameMapper: {
    '^@lxmn/core$': '<rootDir>/../../packages/core/src/index.ts',
  },
  testEnvironment: 'node',
  collectCoverage: false,
}
