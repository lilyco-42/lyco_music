/**
 * Lyco Music 移动端入口
 *
 * 结构参照网易云：**四个标签 + 常驻迷你播放条 + 全屏播放页**。
 *
 * 之前的做法是七个标签（首页/搜索/我的/播放器/会员/同步/好友）平铺在一行，
 * 480px 宽的屏上每个只有 68px，文字挤成一团；播放页也只能挤在标签里，
 * 拿不到全屏空间。
 *
 * 现在：
 * - 标签只留 首页 / 搜索 / 我的 / 会员；
 * - 播放页从「标签」变成「从迷你条上滑出来的全屏 Modal」，可以占满整屏；
 * - 同步 / 好友 / 账户收进「我的」页的入口里（那里才是用户找它们的地方）。
 */
import { useEffect, useState } from 'react'
import { StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context'

import HomeScreen from './src/screens/HomeScreen'
import SearchScreen from './src/screens/SearchScreen'
import PlayerScreen from './src/screens/PlayerScreen'
import MembershipScreen from './src/screens/MembershipScreen'
import SyncScreen from './src/screens/SyncScreen'
import MyMusicScreen from './src/screens/MyMusicScreen'
import { ensurePlatform } from './src/platform'
import { setupPlayer, useTrackPlayerEvents } from './src/player'
import { colors, subscribeAccent, TAB_BAR_HEIGHT } from './src/theme'
import FriendsScreen from './src/screens/FriendsScreen'
import AccountScreen from './src/screens/AccountScreen'
import ErrorBoundary from './src/components/ErrorBoundary'
import MiniPlayer from './src/components/MiniPlayer'
import { recordError } from './src/lib/safe'

/**
 * 装配必须在模块加载期完成，不能等 useEffect。
 *
 * React 的 effect 是**子组件先执行、父组件后执行**：App 的 useEffect 排在
 * HomeScreen 的 useEffect 之后，首页那边 `listSources()` 拿到的是空表，
 * 界面直接显示「当前没有可用的音源」。
 *
 * 这里只做同步工作（setPlatform + registerSource），不碰原生模块，
 * 放模块顶层是安全的；真出问题也不能让整包白屏，所以兜住并记下来。
 */
try {
  ensurePlatform()
} catch (e) {
  recordError('启动装配', e)
}

type TabKey = 'home' | 'search' | 'my' | 'member' | 'sync' | 'friends' | 'account'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'home', label: '首页' },
  { key: 'search', label: '搜索' },
  { key: 'my', label: '我的' },
  { key: 'member', label: '会员' },
]

/** 二级页：从「我的」进，标签栏仍停在「我的」上，返回时不会跳回首页 */
const SUB_PAGES: TabKey[] = ['sync', 'friends', 'account']

export default function App() {
  const [tab, setTab] = useState<TabKey>('home')
  /** 主题色变化时强制重渲染：RN 没有 CSS 变量，样式是在渲染时读 colors 的 */
  const [, forceThemeRender] = useState(0)
  useEffect(() => subscribeAccent(() => forceThemeRender(n => n + 1)), [])
  /** 首页点歌单/频道时带过来的搜索词 */
  const [seedKeyword, setSeedKeyword] = useState('')
  const [playerOpen, setPlayerOpen] = useState(false)

  useEffect(() => {
    // 平台与音源已在模块加载期装配好（见文件顶部），这里只初始化原生播放器。
    // 失败不阻塞 UI：搜索和会员页不依赖它，只有真正点播放时才会再次尝试。
    void setupPlayer().catch(() => undefined)
  }, [])

  // 通知栏 / 耳机切歌时同步 JS 状态
  useTrackPlayerEvents()

  /** 二级页高亮「我的」那个标签 */
  const activeTab: TabKey = SUB_PAGES.includes(tab) ? 'my' : tab

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <ErrorBoundary>
        <View style={styles.root}>
          <StatusBar barStyle="light-content" backgroundColor={colors.bg} translucent={false} />

          <View style={styles.body}>
            {tab === 'home' ? (
              <HomeScreen
                onOpenSearch={kw => {
                  if (kw) setSeedKeyword(kw)
                  setTab('search')
                }}
              />
            ) : tab === 'search' ? (
              <SearchScreen initialKeyword={seedKeyword} />
            ) : tab === 'my' ? (
              <MyMusicScreen
                onOpenAccount={() => setTab('account')}
                onOpenSync={() => setTab('sync')}
                onOpenFriends={() => setTab('friends')}
              />
            ) : tab === 'member' ? (
              <MembershipScreen />
            ) : tab === 'friends' ? (
              <FriendsScreen onNeedMembership={() => setTab('member')} onOpenMy={() => setTab('my')} />
            ) : tab === 'account' ? (
              <AccountScreen onBack={() => setTab('my')} />
            ) : (
              <SyncScreen onBack={() => setTab('my')} />
            )}
          </View>

          {/* 迷你播放条：常驻，任何页面都能看到「现在在放什么」 */}
          <MiniPlayer onOpen={() => setPlayerOpen(true)} onOpenQueue={() => setPlayerOpen(true)} />

          {/* 底部标签栏 */}
          <View style={styles.tabBar}>
            {TABS.map(t => {
              const active = t.key === activeTab
              return (
                <TouchableOpacity
                  key={t.key}
                  style={styles.tabItem}
                  onPress={() => setTab(t.key)}
                  activeOpacity={0.6}
                >
                  <View style={[styles.tabIndicator, { backgroundColor: active ? colors.accent : 'transparent' }]} />
                  <Text style={[styles.tabLabel, { color: active ? colors.fg : colors.fainter, fontWeight: active ? '600' : '400' }]}>
                    {t.label}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>

          {/* 全屏播放页 */}
          <PlayerScreen visible={playerOpen} onClose={() => setPlayerOpen(false)} />
        </View>
      </ErrorBoundary>
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1 },
  tabBar: {
    flexDirection: 'row',
    height: TAB_BAR_HEIGHT,
    backgroundColor: colors.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  tabItem: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tabIndicator: { width: 20, height: 3, borderRadius: 2, marginBottom: 7 },
  // 只剩 4 个标签，字号可以放大到 13（7 个时挤成 12）
  tabLabel: { fontSize: 13 },
})
