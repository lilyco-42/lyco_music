import { AppRegistry } from 'react-native'
import TrackPlayer from 'react-native-track-player'

import App from './App'
import { name as appName } from './app.json'
import playbackService from './src/playback/service'
import { recordError } from './src/lib/safe'

AppRegistry.registerComponent(appName, () => App)

/**
 * 兜底：release 包里没有红屏，任何未捕获异常都会直接杀掉 JS 线程
 * （用户看到的就是「点一下就闪退」）。这里接管全局错误，至少让进程活着，
 * 并把原因记下来供 ErrorBoundary 展示。
 *
 * 注意：这个文件必须是纯 JS —— Metro 对 .js 走 Flow 解析，写 TS 语法
 * （as / 类型注解）会直接 bundle 失败，Android 构建也就跟着红。
 */
const errorUtils = globalThis.ErrorUtils
const previous = errorUtils && typeof errorUtils.getGlobalHandler === 'function'
  ? errorUtils.getGlobalHandler()
  : null

if (errorUtils && typeof errorUtils.setGlobalHandler === 'function') {
  errorUtils.setGlobalHandler((error, isFatal) => {
    recordError(isFatal ? '全局(致命)' : '全局', error)
    // 致命错误不再上抛：交给 ErrorBoundary / 页面自身恢复
    if (!isFatal && previous) previous(error, isFatal)
  })
}

// 必须注册：应用退到后台 / 锁屏后，通知栏与耳机的播放控制由原生侧
// 拉起这个 service 来响应，普通组件此时已经不再挂载。
TrackPlayer.registerPlaybackService(() => playbackService)
