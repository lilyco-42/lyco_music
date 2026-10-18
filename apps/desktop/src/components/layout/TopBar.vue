<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ChevronLeft, Search, Mic, UserRound, LogIn, Crown } from 'lucide-vue-next'
import { useAccount } from '@/lib/auth'
import WindowControls from './WindowControls.vue'

const router = useRouter()
const keyword = ref('')
const account = useAccount()
onMounted(() => { void account.restore() })

function search() {
  const q = keyword.value.trim()
  if (q) void router.push({ name: 'search', query: { q } })
}
</script>

<template>
  <header class="flex min-w-0 items-center gap-3 border-b border-ncm-divider bg-ncm-topbar px-7 [app-region:drag]">
    <button
      type="button"
      class="flex size-10 shrink-0 items-center justify-center rounded-xl border border-ncm-divider text-ncm-faint transition-colors hover:bg-white hover:text-ncm-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ncm-accent [app-region:no-drag]"
      aria-label="返回上一页"
      @click="router.back()"
    >
      <ChevronLeft :size="20" :stroke-width="1.8" aria-hidden="true" />
    </button>

    <div class="flex h-11 min-w-[160px] max-w-[430px] flex-1 items-center gap-3 rounded-xl border border-ncm-divider bg-white px-4 focus-within:border-ncm-accent [app-region:no-drag]">
      <Search :size="18" :stroke-width="1.8" class="shrink-0 text-ncm-faint" aria-hidden="true" />
      <input v-model="keyword" type="search" placeholder="搜索歌曲、歌手" class="w-full min-w-0 bg-transparent text-[15px] text-ncm-fg outline-none placeholder:text-ncm-fainter" @keyup.enter="search" />
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
      <span class="max-w-[160px] truncate text-sm font-medium">{{ account.profile.value?.username || '登录 / 注册' }}</span>
      <span v-if="account.vip.value" class="flex items-center gap-1 rounded-full border border-ncm-accent px-2 py-0.5 text-xs text-ncm-accent">
        <Crown :size="14" :stroke-width="1.8" aria-hidden="true" /> VIP
      </span>
    </button>

    <!-- 无边框窗口的最小化 / 最大化 / 关闭（之前缺这一组，用户只能靠系统标题栏） -->
    <WindowControls class="ml-1 shrink-0" />
  </header>
</template>
