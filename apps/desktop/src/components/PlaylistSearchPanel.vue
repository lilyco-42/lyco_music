<script setup lang="ts">
/**
 * 歌单搜索面板（桌面端共用）。
 *
 * 搜索页和发现页以前各写一份歌单搜索，结果都不区分「歌单名命中」和
 * 「创建者昵称命中」—— 搜 lilyco42 会混进一堆作者叫 Lily Collins 的歌单，
 * 用户完全看不出为什么。这里把两件事统一掉：
 *   1. 每条结果按关键词本地归类，打上「歌单名 / 创建者 / 相关推荐」；
 *   2. 提供「只看同名创建者」和卡片上的「只看 TA 的歌单」，走用户主页接口
 *      拿全量，而不是在本次 24 条结果里过滤（会漏歌单）。
 *
 * 只负责搜索与展示，点开详情交给父页面（emit open）。
 */
import { computed, ref, watch } from 'vue'
import { Search, UserRound, X } from 'lucide-vue-next'
import {
  searchWyPlaylists,
  searchWyPlaylistsByCreator,
  type WyPlaylistBrief,
  type WyPlaylistMatch,
} from '@lxmn/core'

const props = withDefaults(defineProps<{
  /** 外部给的关键词（搜索页来自 /search?q=） */
  initialKeyword?: string
  /** true = 关键词变化时自动搜，且隐藏输入框（搜索页用） */
  auto?: boolean
}>(), { initialKeyword: '', auto: false })

const emit = defineEmits<{
  (e: 'open', id: string, name: string, cover: string): void
  /** 本次结果总数，给搜索页在标题旁显示「共 N 个歌单」 */
  (e: 'result', total: number): void
}>()

const keyword = ref(props.initialKeyword)
const playlists = ref<WyPlaylistBrief[]>([])
const total = ref(0)
const searched = ref(false)
const busy = ref(false)
const error = ref('')
const matchFilter = ref<'all' | WyPlaylistMatch>('all')
const creatorOnly = ref(false)
const creatorName = ref('')

const filtered = computed(() => matchFilter.value === 'all'
  ? playlists.value
  : playlists.value.filter(p => (p.match ?? 'other') === matchFilter.value))

const counts = computed(() => {
  const c = { all: playlists.value.length, name: 0, creator: 0, other: 0 }
  for (const p of playlists.value) c[p.match ?? 'other']++
  return c
})

const filterTabs = computed(() => [
  { id: 'all' as const, label: '全部', count: counts.value.all },
  { id: 'name' as const, label: '歌单名', count: counts.value.name },
  { id: 'creator' as const, label: '创建者', count: counts.value.creator },
  { id: 'other' as const, label: '相关推荐', count: counts.value.other },
])

function matchLabel(p: WyPlaylistBrief): string {
  if (p.match === 'name') return '歌单名'
  if (p.match === 'creator') return '创建者'
  return '相关推荐'
}

function fmtPlayCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return ''
  if (n >= 1e8) return (n / 1e8).toFixed(1) + ' 亿'
  if (n >= 1e4) return Math.round(n / 1e4) + ' 万'
  return String(n)
}

function resetResult(): void {
  error.value = ''
  matchFilter.value = 'all'
}

async function runSearch(raw?: string): Promise<void> {
  const q = String(raw ?? keyword.value).trim()
  if (!q) return
  keyword.value = q
  busy.value = true
  searched.value = true
  creatorOnly.value = false
  resetResult()
  try {
    const r = await searchWyPlaylists(q, 1, 24)
    playlists.value = r.list
    total.value = r.total
    emit('result', r.total)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    playlists.value = []
    total.value = 0
    emit('result', 0)
  } finally {
    busy.value = false
  }
}

/** 按创建者精确搜：先 type=1002 找用户，再拉用户主页歌单（含被搜索挤掉的那几张） */
async function onlyCreator(name: string): Promise<void> {
  const q = String(name || keyword.value).trim()
  if (!q) return
  busy.value = true
  searched.value = true
  resetResult()
  try {
    const r = await searchWyPlaylistsByCreator(q)
    playlists.value = r.list
    total.value = r.total
    emit('result', r.total)
    creatorOnly.value = true
    creatorName.value = r.creator || q
    if (!r.list.length) error.value = '没找到这个创建者的公开歌单'
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    playlists.value = []
    total.value = 0
    emit('result', 0)
  } finally {
    busy.value = false
  }
}

function backToKeyword(): void {
  void runSearch()
}

watch(() => props.initialKeyword, v => {
  keyword.value = v
  if (props.auto) void runSearch(v)
}, { immediate: true })
</script>

<template>
  <div>
    <div v-if="!auto" class="mb-4 flex flex-wrap items-center gap-2">
      <input
        v-model="keyword"
        type="search"
        spellcheck="false"
        placeholder="搜歌单，例如「通勤」「爵士」「周杰伦」"
        class="min-w-[260px] flex-1 rounded-[8px] border border-ncm-divider bg-ncm-bg px-3 py-1.5 text-[13px] text-ncm-fg outline-none placeholder:text-ncm-fainter focus:border-ncm-accent"
        @keydown.enter.prevent="runSearch()"
      />
      <button
        type="button"
        class="flex items-center gap-1.5 rounded-pill bg-ncm-accent px-4 py-1.5 text-[13px] text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        :disabled="busy || !keyword.trim()"
        @click="runSearch()"
      >
        <Search :size="14" aria-hidden="true" />{{ busy ? '搜索中…' : '搜索歌单' }}
      </button>
    </div>

    <!-- 命中分类：解释「为什么搜出来这个」 -->
    <div v-if="searched || auto" class="mb-3 flex flex-wrap items-center gap-2">
      <button
        v-for="f in filterTabs"
        :key="f.id"
        type="button"
        class="rounded-full border px-3 py-1 text-[12px] transition-colors"
        :class="matchFilter === f.id
          ? 'border-ncm-accent bg-ncm-accent/10 text-ncm-accent'
          : 'border-ncm-divider text-ncm-faint hover:border-ncm-accent hover:text-ncm-accent'"
        :aria-pressed="matchFilter === f.id"
        @click="matchFilter = f.id"
      >{{ f.label }} <span class="ml-1 opacity-70">{{ f.count }}</span></button>

      <button
        v-if="creatorOnly"
        type="button"
        class="flex items-center gap-1 rounded-pill border border-ncm-divider px-3 py-1 text-[12px] text-ncm-muted hover:bg-black/5"
        @click="backToKeyword"
      ><X :size="12" aria-hidden="true" />返回关键词搜索</button>
      <button
        v-else-if="keyword.trim()"
        type="button"
        class="flex items-center gap-1 rounded-pill border border-ncm-divider px-3 py-1 text-[12px] text-ncm-muted hover:bg-black/5 disabled:opacity-40"
        :disabled="busy"
        @click="onlyCreator(keyword)"
      ><UserRound :size="12" aria-hidden="true" />只看同名创建者</button>
    </div>

    <p v-if="creatorOnly && playlists.length" class="mb-2 text-[12px] text-ncm-faint">
      只看创建者「{{ creatorName }}」：共 {{ total }} 张自建歌单（已排除 TA 收藏的别人的歌单）
    </p>
    <p v-else-if="searched && !busy && playlists.length" class="mb-2 text-[12px] text-ncm-faint">
      共 {{ total }} 个歌单，显示前 {{ playlists.length }} 个 · 网易云会同时匹配歌单名和创建者昵称，标签按本次关键词归类
    </p>
    <p v-if="error" class="mb-3 text-[14px] text-ncm-accent">{{ error }}</p>
    <p v-else-if="searched && !busy && !playlists.length" class="mb-3 text-[14px] text-ncm-faint">没有找到相关歌单</p>
    <p v-else-if="auto && busy" class="mb-3 text-[14px] text-ncm-faint">搜索歌单中…</p>

    <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      <div v-for="item in filtered" :key="item.id" class="group">
        <button
          type="button"
          class="w-full text-left"
          @click="emit('open', item.id, item.name, item.cover)"
        >
          <div class="relative aspect-square w-full overflow-hidden rounded-cover bg-ncm-fainter/25">
            <img
              v-if="item.cover"
              :src="item.cover"
              alt=""
              class="size-full object-cover transition-transform group-hover:scale-[1.03]"
              loading="lazy"
              referrerpolicy="no-referrer"
            />
            <span
              v-if="fmtPlayCount(item.playCount)"
              class="absolute right-1.5 top-1.5 rounded-full bg-black/45 px-1.5 py-0.5 text-[11px] text-white"
            >{{ fmtPlayCount(item.playCount) }}</span>
          </div>
          <p class="mt-2 line-clamp-2 text-[13px] leading-[18px] text-ncm-fg">{{ item.name }}</p>
          <p class="mt-0.5 truncate text-[11px] text-ncm-faint">{{ item.trackCount }} 首 · {{ item.creator }}</p>
        </button>
        <div class="mt-1 flex flex-wrap items-center gap-1.5">
          <span
            class="rounded-md px-1.5 py-0.5 text-[10px]"
            :class="item.match === 'creator'
              ? 'bg-ncm-accent/10 text-ncm-accent'
              : item.match === 'name' ? 'bg-black/5 text-ncm-muted' : 'bg-black/5 text-ncm-fainter'"
          >{{ matchLabel(item) }}</span>
          <button
            v-if="item.match === 'creator' && !creatorOnly"
            type="button"
            class="text-[10px] text-ncm-faint underline decoration-dotted hover:text-ncm-accent"
            @click="onlyCreator(item.creator)"
          >只看 TA 的歌单</button>
        </div>
      </div>
    </div>

    <div v-if="!searched && !auto" class="mt-8 flex flex-col items-center text-ncm-fainter">
      <p class="text-[13px]">输入关键词后回车，搜的是歌单而不是单曲</p>
    </div>
  </div>
</template>
