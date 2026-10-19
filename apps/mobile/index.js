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
 */
const anyGlobal = globalThis as unknown as {
  ErrorUtils?: { setGlobalHandler?: (fn: (e: Error, isFatal?: boolean) => void) => void; getGlobalHandler?: () => (e: Error, isFatal?: boolean) => void }
}
const previous = anyGlobal.ErrorUtils?.getGlobalHandler?.()
anyGlobal.ErrorUtils?.setGlobalHandler?.((error: Error, isFatal?: boolean) => {
  recordError(isFatal ? '全局(致命)' : '全局', error)
  // 致命错误不再上抛：交给 ErrorBoundary / 页面自身恢复
  if (!isFatal && previous) previous(error, isFatal)
})

// 必须注册：应用退到后台 / 锁屏后，通知栏与耳机的播放控制由原生侧
// 拉起这个 service 来响应，普通组件此时已经不再挂载。
TrackPlayer.registerPlaybackService(() => playbackService)
