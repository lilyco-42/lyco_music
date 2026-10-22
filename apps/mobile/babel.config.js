/**
 * 刻意保持最小化：只有 RN 官方 preset + 一个路径别名插件。
 *
 * 这里**不用** nativewind / reanimated 的 babel 插件——
 * 少一个 babel 变换，CI 上就少一个失败点。
 */
module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    [
      'module-resolver',
      {
        // 别名必须锚定到「这个配置文件所在的目录」，而不是 process.cwd()。
        //
        // module-resolver 默认按 cwd 解析 alias：Metro 在 apps/mobile 下启动时
        // cwd 恰好等于这里，所以打包一直是对的；但 jest 常常从仓库根跑，
        // cwd 变成仓库根，'../../packages/core/src/index.ts' 就被算成
        // D:/packages/core/src/index.ts —— 再相对化成 5 层 ../ 之后必然找不到。
        // 表现是 "Cannot find module '../../../../../packages/core/src/index.ts'"。
        //
        // 'babelrc' 表示从「当前被转换的文件」向上找 babel 配置并取其目录。
        // 对 apps/mobile 内的文件结果与原来完全一致（同一份 babel.config.js），
        // 但对从仓库根启动的 jest 也成立。
        cwd: 'babelrc',
        alias: {
          '^@lxmn/core$': '../../packages/core/src/index.ts',
          '^@lxmn/platform-mobile$': '../../packages/platform-mobile/src/index.ts',
        },
      },
    ],
  ],
}
