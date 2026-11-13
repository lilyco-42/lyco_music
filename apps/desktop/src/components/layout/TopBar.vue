<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ChevronLeft, Search, Mic, UserRound, LogIn, Crown, Clock3, X, Trash2 } from 'lucide-vue-next'
import { useAccount } from '@/lib/auth'
import { useTheme } from '@/lib/theme'
import { t } from '@/lib/i18n'
import Menu from '@/components/ui/Menu.vue'
import { Palette } from 'lucide-vue-next'
import WindowControls from './WindowControls.vue'
import {
  pushSearchHistory,
  readSearchHistory,
  removeSearchHistory,
  clearSearchHistory,
} from '@/lib/search-history'

const router = useRouter()
const keyword = ref('')
const account = useAccount()
const theme = useTheme()

/**
 * 搜索历史：以前桌面端搜完就忘，移动端早就有（lxmn.mobile.searchHistory）。
 * 下拉挂在搜索框下，最多 12 条，支持单条删除与整体清空；数据落在 localStorage。
 */
const searchBox = ref<HTMLElement | null>(null)
const history = ref<string[]>([])
const historyOpen = ref(false)

const visibleHistory = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  if (!q) return history.value
  return history.value.filter(x => x.toLowerCase().includes(q))
})

function refreshHistory(): void {
  history.value = readSearchHistory()
}

function onDocPointerDown(e: PointerEvent): void {
  if (searchBox.value && !searchBox.value.contains(e.target as Node)) historyOpen.value = false
}

onMounted(() => {
  void account.restore()
  refreshHistory()
  document.addEventListener('pointerdown', onDocPointerDown)
})
onBeforeUnmount(() => { document.removeEventListener('pointerdown', onDocPointerDown) })

function focusSearch(): void {
  refreshHistory()
  historyOpen.value = history.value.length > 0
}

function hideHistory(): void {
  historyOpen.value = false
}

/** 主题菜单项：色块 + 名称；末尾附两套皮肤（材质不同，不只是颜色） */
const themeItems = [
  ...theme.presets.map(p => ({ value: p.id, label: p.name, hint: p.accent })),
  ...theme.skins.map(s => ({ value: 'skin:' + s.id, label: '皮肤 · ' + s.name, hint: '' })),
]

function search(): void {
  const q = keyword.value.trim()
  if (!q) return
  history.value = pushSearchHistory(q)
  hideHistory()
  void router.push({ name: 'search', query: { q } })
}

/** 点历史条目：直接复用关键词再搜一次，同时把它提到最前 */
function useHistory(q: string): void {
  keyword.value = q
  history.value = pushSearchHistory(q)
  hideHistory()
  void router.push({ name: 'search', query: { q } })
}

/** 单条删除：不触发外层的「重新搜索」 */
function deleteHistory(q: string): void {
  history.value = removeSearchHistory(q)
  if (!history.value.length) hideHistory()
}

function clearHistory(): void {
  history.value = clearSearchHistory()
  hideHistory()
}

function onSearchKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    hideHistory()
    ;(e.currentTarget as HTMLInputElement).blur()
  }
}
</script>

<template>
  <header class="flex min-w-0 items-center gap-2 border-b border-ncm-divider bg-ncm-topbar pl-6 pr-1 [app-region:drag]">
    <button
      type="button"
      class="flex size-10 shrink-0 items-center justify-center rounded-xl border border-ncm-divider text-ncm-faint transition-colors hover:bg-white hover:text-ncm-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ncm-accent [app-region:no-drag]"
      aria-label="返回上一页"
      @click="router.back()"
    >
      <ChevronLeft :size="20" :stroke-width="1.8" aria-hidden="true" />
    </button>

    <div
      ref="searchBox"
      class="relative flex h-11 min-w-[160px] max-w-[430px] flex-1 items-center gap-3 rounded-xl border border-ncm-divider bg-white px-4 focus-within:border-ncm-accent [app-region:no-drag]"
    >
      <Search :size="18" :stroke-width="1.8" class="shrink-0 text-ncm-faint" aria-hidden="true" />
      <input
        v-model="keyword"
        type="search"
        :placeholder="t('topbar.search')"
        class="w-full min-w-0 bg-transparent text-[15px] text-ncm-fg outline-none placeholder:text-ncm-fainter"
        aria-label="搜索歌曲或歌单"
        :aria-expanded="historyOpen && visibleHistory.length > 0"
        aria-controls="topbar-search-history"
        autocomplete="off"
        @focus="focusSearch"
        @keydown="onSearchKeydown"
        @keyup.enter="search"
      />

      <!-- 搜索历史：聚焦即显示；输入时按子串过滤，避免挡住新关键词 -->
      <div
        v-if="historyOpen && visibleHistory.length"
        id="topbar-search-history"
        class="absolute left-0 right-0 top-[48px] z-50 max-h-[320px] overflow-y-auto rounded-xl border border-ncm-divider bg-white py-1 shadow-xl [app-region:no-drag]"
        role="listbox"
        aria-label="搜索历史"
      >
        <div class="flex items-center justify-between px-3 py-1.5 text-[12px] text-ncm-faint">
          <span>搜索历史</span>
          <button
            type="button"
            class="flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:text-ncm-accent"
            aria-label="清空搜索历史"
            @click="clearHistory"
          ><Trash2 :size="12" :stroke-width="1.8" aria-hidden="true" />清空</button>
        </div>
        <div
          v-for="q in visibleHistory"
          :key="q"
          class="group flex cursor-pointer items-center gap-2 px-3 py-2 text-left text-[14px] text-ncm-fg transition-colors hover:bg-ncm-bg"
          role="option"
          :aria-selected="false"
          tabindex="0"
          @click="useHistory(q)"
          @keydown.enter.prevent="useHistory(q)"
          @keydown.space.prevent="useHistory(q)"
        >
          <Clock3 :size="14" :stroke-width="1.8" class="shrink-0 text-ncm-fainter" aria-hidden="true" />
          <span class="min-w-0 flex-1 truncate">{{ q }}</span>
          <button
            type="button"
            class="shrink-0 rounded p-1 text-ncm-fainter opacity-0 transition-opacity hover:text-ncm-accent group-hover:opacity-100 focus:opacity-100"
            :aria-label="'删除搜索历史：' + q"
            @click.stop="deleteHistory(q)"
          ><X :size="12" :stroke-width="2" aria-hidden="true" /></button>
        </div>
      </div>
    </div>

    <button
      type="button"
      disabled
      title="语音搜索暂未开放"
      class="flex size-10 shrink-0 cursor-not-allowed items-center justify-center rounded-xl border border-ncm-divider text-ncm-faint opacity-55 [app-region:no-drag]"
      aria-label="语音搜索暂未开放"
    >
      <Mic :size="20" :stroke-width="1.8" aria-hidden="true" />
    </button>

    <div class="min-w-0 flex-1" />

    <button type="button" class="flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-left text-ncm-fg hover:bg-black/5 [app-region:no-drag]" @click="router.push('/account')">
      <span class="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-ncm-divider text-ncm-muted">
        <img
          v-if="account.signedIn.value && account.profile.value?.avatar"
          :src="account.profile.value.avatar"
          alt=""
          class="size-full object-cover"
          referrerpolicy="no-referrer"
        />
        <UserRound v-else-if="account.signedIn.value" :size="20" :stroke-width="1.8" aria-hidden="true" />
        <LogIn v-else :size="20" :stroke-width="1.8" aria-hidden="true" />
      </span>
      <span class="max-w-[160px] truncate text-sm font-medium">{{ account.profile.value?.username || t('topbar.login') }}</span>
      <span v-if="account.vip.value" class="flex items-center gap-1 rounded-full border border-ncm-accent px-2 py-0.5 text-xs text-ncm-accent">
        <Crown :size="14" :stroke-width="1.8" aria-hidden="true" /> VIP
      </span>
    </button>

    <!-- 主题色：运行时改 CSS 变量，不影响结构色对比度 -->
    <Menu
      :items="themeItems"
      :model-value="theme.currentId.value"
      width="176px"
      placement="bottom"
      class="[app-region:no-drag]"
      @update:model-value="theme.setTheme"
    >
      <template #trigger="{ open, toggle }">
        <button
          type="button"
          class="flex size-9 shrink-0 items-center justify-center rounded-lg text-ncm-faint transition-colors hover:bg-black/5 hover:text-ncm-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ncm-accent [app-region:no-drag]"
          :aria-label="'主题色：' + theme.current.value.name"
          aria-haspopup="menu"
          :aria-expanded="open"
          @click="toggle"
        >
          <Palette :size="20" :stroke-width="1.8" aria-hidden="true" />
        </button>
      </template>
    </Menu>

    <!-- 无边框窗口的最小化 / 最大化 / 关闭（之前缺这一组，用户只能靠系统标题栏） -->
    <WindowControls class="shrink-0" />
  </header>
</template>
