import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { ensureDesktopPlatform } from './lib/platform'
import { useMembership } from './lib/membership'
import { library } from './lib/sync'
import { initTheme } from './lib/theme'
import { initTexture } from './lib/texture'
import { installHotkeys } from './lib/hotkeys'
import { installShellIntegration } from './lib/shell'
import { installLyricBridge } from './lib/lyric-window'
import './styles/main.css'

// 安装平台适配器 + 注册内核里已移植的音源（幂等）
ensureDesktopPlatform()

/**
 * 启动即恢复会员与音源池。
 *
 * 这一步以前只在「音乐会员」页面挂载时才做，于是有个很隐蔽的后果：
 * 用户从没点开过会员页 -> 音源池一直是空的 -> 所有串源兜底都失效，
 * 表现就是「有些歌点了没反应」，而他并不知道要先去某个页面。
 *
 * 音源是播放的基础设施，不是设置项，所以放在这里无条件执行。
 * restore() 内部是静默的：命中缓存就立刻可用，没有就什么都不发生。
 */
void useMembership().restore()

/**
 * 曲库也要在启动时载入。
 *
 * 「不喜欢的歌曲」的跳过逻辑是**同步**判断（切歌时不该多一个 await），
 * 依赖 load() 时建好的规则索引。如果只在「我的音乐」页挂载时才 load，
 * 用户从首页直接开播就完全跳过不生效 —— 表现是「设置了不喜欢但还在放」。
 *
 * load() 是幂等的，Sidebar 里的 restore() 再调一次没有额外开销。
 */
void library.load()

// 主题色要在首屏渲染前应用，否则会先闪一下默认红
initTheme()

// 质感滤镜同理：晚一步就会先出现一帧没有纹理的纯色面板
initTexture()

/**
 * 桌面歌词窗口的透明背景必须**在挂载之前**打上。
 *
 * 以前这个标记是在 DesktopLyric.vue 的 onMounted 里加的，于是第一帧
 * 走的是普通界面的白底 + 侧栏 + 底栏 —— 用户看到的是一大块白色面板
 * 盖在应用上（截图里那个「初始化窗口错乱」就是这么来的）。
 * 这里直接读 hash 判断，和路由解析无关，首帧就是透明的。
 */
const IS_LYRIC_WINDOW = location.hash.includes('/lyric-window')
if (IS_LYRIC_WINDOW) document.documentElement.dataset.window = 'lyric'

// 全局快捷键（空格播放、←/→ 快进、Ctrl+←/→ 切歌、M 静音、L 歌词、Ctrl+K 搜索）
installHotkeys()

// 系统集成：托盘、任务栏进度、播放时防休眠、界面缩放、启动自动播放
installShellIntegration()

createApp(App).use(router).mount('#app')

// 桌面歌词窗口的数据桥（只在 Electron 里生效，浏览器下是 no-op）
installLyricBridge()
