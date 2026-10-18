import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { ensureDesktopPlatform } from './lib/platform'
import { useMembership } from './lib/membership'
import { initTheme } from './lib/theme'
import { installHotkeys } from './lib/hotkeys'
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

// 主题色要在首屏渲染前应用，否则会先闪一下默认红
initTheme()

// 全局快捷键（空格播放、←/→ 快进、Ctrl+←/→ 切歌、M 静音、L 歌词、Ctrl+K 搜索）
installHotkeys()

createApp(App).use(router).mount('#app')
