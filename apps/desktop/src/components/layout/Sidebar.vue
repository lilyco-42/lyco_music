<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  Disc3, Music2, Sparkles, Podcast, Compass, UsersRound, Trophy,
  Heart, History, Download, Ellipsis, Crown, Cloud, UserRound,
  ListMusic, ListOrdered, FolderInput, Plus, Settings2,
} from 'lucide-vue-next'
import { useSync } from '@/lib/sync'
import { t } from '@/lib/i18n'

const route = useRoute()
const router = useRouter()
const { playlists, restore } = useSync()
onMounted(() => { void restore() })

// 标签走 t()（7.4）：数组放在 computed 里，切语言时整排立刻跟着变
const navMain = computed(() => [
  { key: 'recommend', label: t('nav.recommend'), icon: Music2, route: '/' },
  { key: 'featured', label: t('nav.featured'), icon: Sparkles, query: '精选' },
  { key: 'podcast', label: t('nav.podcast'), icon: Podcast, query: '播客' },
  { key: 'roam', label: t('nav.roam'), icon: Compass, query: '轻音乐' },
  { key: 'discover', label: t('nav.discover'), icon: Trophy, route: '/discover' },
  { key: 'follow', label: t('nav.follow'), icon: UsersRound, route: '/friends' },
])
const navServices = computed(() => [
  { key: 'membership', label: t('nav.membership'), icon: Crown, route: '/membership' },
  { key: 'sync', label: t('nav.sync'), icon: Cloud, route: '/sync' },
  { key: 'friends', label: t('nav.friends'), icon: UsersRound, route: '/friends' },
  { key: 'settings', label: t('nav.settings'), icon: Settings2, route: '/settings' },
  { key: 'account', label: t('nav.account'), icon: UserRound, route: '/account' },
])
const navMine = computed(() => [
  // 试听列表放在第一位：lx 用户点歌之后第一件事就是去这里看队列
  { key: 'trial', label: t('nav.trial'), icon: ListOrdered, route: '/my', tab: 'trial' },
  { key: 'like', label: t('nav.like'), icon: Heart, route: '/my', tab: 'fav' },
  { key: 'recent', label: t('nav.recent'), icon: History, route: '/my', tab: 'recent' },
  { key: 'download', label: t('nav.download'), icon: Download, route: '/downloads', tab: '' },
  { key: 'import', label: t('nav.import'), icon: FolderInput, route: '/import', tab: '' },
  { key: 'more', label: t('nav.more'), icon: Ellipsis, route: '/account', tab: '' },
])

type NavItem = { key: string; label: string; route?: string; query?: string; tab?: string }

function go(item: NavItem) {
  if (item.route === '/my') {
    void router.push({ path: '/my', query: { tab: item.tab || 'fav' } })
  } else if (item.route) {
    void router.push(item.route)
  } else if (item.query) {
    void router.push({ name: 'search', query: { q: item.query } })
  }
}

/** 点侧边栏的「+」：跳到我的音乐并直接打开新建输入框 */
function newPlaylist(): void {
  void router.push({ path: '/my', query: { new: '1' } })
}

function selected(item: NavItem) {
  if (item.route === '/') return route.name === 'home'
  if (item.route === '/my') {
    // 我的音乐三个页签共用一个路由，靠 ?tab= 区分，别让两个条目同时高亮
    if (route.path !== '/my' || route.query.pl) return false
    return (route.query.tab ?? 'fav') === (item.tab || 'fav')
  }
  if (item.route && route.path === item.route) return true
  return !!item.query && route.name === 'search' && route.query.q === item.query
}
const rowClass = 'mx-4 flex h-11 w-[calc(100%-2rem)] shrink-0 items-center gap-3 rounded-xl px-4 text-left text-[15px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ncm-accent'
</script>

<template>
  <aside class="flex h-full flex-col overflow-y-auto border-r border-ncm-divider bg-ncm-sidebar">
    <div class="flex items-center gap-3 px-6 pb-5 pt-7">
      <span class="flex size-10 items-center justify-center rounded-full bg-ncm-accent text-white">
        <Disc3 :size="24" :stroke-width="1.8" />
      </span>
      <span class="text-[22px] font-semibold tracking-tight text-ncm-fg">Lyco Music</span>
    </div>

    <nav :aria-label="t('sidebar.group.discover')" class="flex flex-col gap-0.5">
      <button v-for="item in navMain" :key="item.key" type="button" :class="[rowClass, selected(item) ? 'bg-ncm-accent-nav font-semibold text-white' : 'text-ncm-muted hover:bg-black/5']" @click="go(item)">
        <component :is="item.icon" :size="20" :stroke-width="1.8" class="shrink-0" aria-hidden="true" />
        <span>{{ item.label }}</span>
      </button>
    </nav>

    <div class="mx-6 my-4 border-t border-ncm-divider" />

    <nav :aria-label="t('sidebar.group.service')" class="flex flex-col gap-0.5">
      <button v-for="item in navServices" :key="item.key" type="button" :class="[rowClass, selected(item) ? 'bg-ncm-accent-nav font-semibold text-white' : 'text-ncm-muted hover:bg-black/5']" @click="go(item)">
        <component :is="item.icon" :size="20" :stroke-width="1.8" class="shrink-0" aria-hidden="true" />
        <span>{{ item.label }}</span>
      </button>
    </nav>

    <div class="mb-1 mt-5 px-7 text-xs font-medium text-ncm-fainter">{{ t('sidebar.group.mine') }}</div>
    <nav :aria-label="t('sidebar.group.mine')" class="flex flex-col gap-0.5">
      <button v-for="item in navMine" :key="item.key" type="button" :disabled="!item.route"
              :title="!item.route ? '下载管理界面正在开发中' : undefined"
              :class="[rowClass, selected(item) ? 'bg-ncm-accent-nav text-white' : 'text-ncm-muted hover:bg-black/5', !item.route ? 'cursor-not-allowed opacity-50' : '']"
              @click="go(item)">
        <component :is="item.icon" :size="20" :stroke-width="1.8" class="shrink-0" aria-hidden="true" />
        <span>{{ item.label }}</span>
      </button>
    </nav>

    <div class="mb-2 mt-5 flex items-center gap-2 px-7 text-xs text-ncm-fainter">
      <ListMusic :size="16" :stroke-width="1.8" aria-hidden="true" />
      <span class="flex-1">{{ t('sidebar.playlists') }}（{{ playlists.length }}）</span>
      <button
        type="button"
        class="-mr-1 rounded-full p-1 transition-colors hover:bg-black/5 hover:text-ncm-accent"
        :title="t('sidebar.newPlaylist')"
        :aria-label="t('sidebar.newPlaylist')"
        @click="newPlaylist"
      >
        <Plus :size="15" :stroke-width="2.6" aria-hidden="true" />
      </button>
    </div>
    <p v-if="!playlists.length" class="px-7 pb-6 text-xs text-ncm-fainter">{{ t('sidebar.empty') }}</p>
    <button v-for="pl in playlists" :key="pl.id" type="button"
            class="mx-4 flex min-h-11 items-center gap-3 rounded-lg px-4 text-left text-sm transition-colors"
            :class="route.query.pl === pl.id ? 'bg-ncm-accent-nav text-white' : 'text-ncm-muted hover:bg-black/5'"
            @click="router.push({ path: '/my', query: { pl: pl.id } })">
      <ListMusic :size="16" :stroke-width="1.8" class="shrink-0" aria-hidden="true" />
      <span class="min-w-0 flex-1 truncate">{{ pl.name }}</span>
      <span class="shrink-0 text-[11px] opacity-60">{{ pl.items.length }}</span>
    </button>
  </aside>
</template>
