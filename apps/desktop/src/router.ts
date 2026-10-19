import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  { path: '/', name: 'home', component: () => import('./views/Home.vue') },
  { path: '/search', name: 'search', component: () => import('./views/Search.vue') },
  { path: '/player', name: 'player', component: () => import('./views/Player.vue') },
  { path: '/account', name: 'account', component: () => import('./views/Account.vue') },
  { path: '/membership', name: 'membership', component: () => import('./views/Membership.vue') },
  { path: '/sync', name: 'sync', component: () => import('./views/Sync.vue') },
  { path: '/my', name: 'my', component: () => import('./views/MyMusic.vue') },
  { path: '/friends', name: 'friends', component: () => import('./views/Friends.vue') },
  { path: '/settings', name: 'settings', component: () => import('./views/Settings.vue') },
  // 桌面歌词窗口（独立 BrowserWindow 加载这个路由）
  { path: '/lyric-window', name: 'lyric-window', component: () => import('./views/DesktopLyric.vue') },
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

export default router
