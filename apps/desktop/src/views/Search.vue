<script setup lang="ts">
/**
 * 搜索结果页
 *
 * 这一页是「能真的听歌」的入口：TopBar 的搜索框回车 -> /search?q=xxx
 * -> 调内核的 musicSearch -> 点条目播放。
 */
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ListMusic, Play, RotateCw } from 'lucide-vue-next'
import { getSource, hasSource, type MusicItem } from '@lxmn/core'
import { usePlayer } from '@/lib/player'
import { useSync } from '@/lib/sync'
import { useI18n } from '@/lib/i18n'
import PlaylistSearchPanel from '@/components/PlaylistSearchPanel.vue'
import {
  readSearchSnapshot,
  saveSearchSnapshot,
  patchSearchSnapshot,
  clearSearchSnapshot,
} from '@/lib/search-cache'

const { t, tf } = useI18n()
const route = useRoute()
const router = useRouter()
const player = usePlayer()
const { library, favorites } = useSync()

/** 收藏状态由曲库决定；这里用 favorites 驱动重算，收藏后按钮立刻变实心 */
function isFav(item: MusicItem): boolean {
  return favorites.value.some(f => f.source === item.source && String(f.songmid) === String(item.songmid))
}

async function toggleFav(item: MusicItem): Promise<void> {
  await library.toggleFavorite(item)
}

const loading = ref(false)
const error = ref('')
const list = ref<MusicItem[]>([])
const total = ref(0)
const SOURCE_LABELS: Record<string, string> = {
  wy: '网易云', kw: '酷我', kg: '酷狗', mg: '咪咕',
}


const keyword = computed(() => String(route.query.q ?? '').trim())

/**
 * 搜索页以前只能搜单曲，想找歌单得先想起来去「发现」页再搜一次。
 * 现在同一个关键词同时给「单曲 / 歌单」两个结果页签；歌单面板与发现页
 * 共用，所以命中类型标注、只看创建者这些能力两边一致。
 */
type SearchTab = 'songs' | 'playlists'
const searchTab = ref<SearchTab>('songs')
const playlistTotal = ref(0)

/** 点歌单卡片：详情页在 Discover.vue，带 id 跳过去直接展开 */
function openWyPlaylist(id: string, name: string, cover: string): void {
  void router.push({ path: '/discover', query: { pl: id, name, cover } })
}

/* ---------- 音源筛选（对齐 lx-music 的「全部 / 网易云 / 酷狗 / 酷我 / 咪咕」） ---------- */

/** 当前选中的音源，'all' 表示不筛选 */
const activeSource = ref<'all' | string>('all')

/** 只列出本次结果里真实出现过的音源，避免出现点了没内容的空页签 */
const sourceTabs = computed(() => {
  const counts = new Map<string, number>()
  for (const item of list.value) counts.set(item.source, (counts.get(item.source) ?? 0) + 1)
  return [
    { id: 'all' as const, label: t('search.all', '全部'), count: list.value.length },
    ...[...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id, count]) => ({ id, label: SOURCE_LABELS[id] ?? id, count })),
  ]
})

const filtered = computed(() =>
  activeSource.value === 'all' ? list.value : list.value.filter(i => i.source === activeSource.value))

/* ---------- 封面补齐：酷我搜索不带图，靠 getPic 逐条补 ---------- */

const pics = reactive<Record<string, string>>({})
const keyOf = (item: MusicItem): string => item.source + '-' + String(item.songmid)

function picOf(item: MusicItem): string {
  return pics[keyOf(item)] || (typeof item.picUrl === 'string' ? item.picUrl : '')
}

async function hydratePics(items: MusicItem[]): Promise<void> {
  const missing = items.filter(i => !picOf(i) && hasSource(i.source) && Boolean(getSource(i.source).getPic))
  let cursor = 0
  const worker = async (): Promise<void> => {
    while (cursor < missing.length) {
      const item = missing[cursor++]
      if (!item) continue
      try {
        const info = await getSource(item.source).getPic!(item)
        if (info.url) pics[keyOf(item)] = info.url
      } catch {
        // 单条失败不影响列表
      }
    }
  }
  // 并发 3 个，避免一次打十几个请求把接口打停
  await Promise.all([worker(), worker(), worker()])
}

/**
 * 同一关键词在 5 分钟内回到搜索页时，直接还原上次的结果与筛选状态。
 * 痛点：点进播放器模式看歌词，收起时组件被重建，原来会重新联网搜一遍；
 * 现在收起动作也会原路回到 /search?q=...，这里命中缓存即可瞬间显示。
 */
let requestSeq = 0

async function run(): Promise<void> {
  const q = keyword.value
  const seq = ++requestSeq
  error.value = ''
  if (!q) {
    list.value = []
    total.value = 0
    playlistTotal.value = 0
    activeSource.value = 'all'
    loading.value = false
    clearSearchSnapshot()
    return
  }

  const cached = readSearchSnapshot(q)
  if (cached) {
    list.value = cached.list
    total.value = cached.total
    activeSource.value = cached.source
    searchTab.value = cached.tab
    playlistTotal.value = cached.playlistTotal
    loading.value = false
    // 组件重建后封面缓存也没了，补一次
    void hydratePics(cached.list)
    // 刷新 TTL：从现在起再给五分钟
    saveSearchSnapshot({
      keyword: q,
      list: cached.list,
      total: cached.total,
      source: cached.source,
      tab: cached.tab,
      playlistTotal: cached.playlistTotal,
    })
    return
  }

  list.value = []
  total.value = 0
  playlistTotal.value = 0
  activeSource.value = 'all'
  searchTab.value = 'songs'
  clearSearchSnapshot()
  loading.value = true
  try {
    const r = await player.search(q, 1, 30)
    if (seq !== requestSeq) return
    list.value = r.list
    total.value = r.total
    loading.value = false
    saveSearchSnapshot({
      keyword: q,
      list: r.list,
      total: r.total,
      source: activeSource.value,
      tab: searchTab.value,
      playlistTotal: playlistTotal.value,
    })
    void hydratePics(r.list)
  } catch (e) {
    if (seq !== requestSeq) return
    error.value = e instanceof Error ? e.message : String(e)
    loading.value = false
  }
}

watch(keyword, () => { void run() }, { immediate: true })

/** 筛选状态也要跟着还原，否则回来后「歌单 / 网易云」页签又跳回默认 */
watch(searchTab, tab => { patchSearchSnapshot({ tab }) })
watch(activeSource, source => { patchSearchSnapshot({ source }) })
watch(playlistTotal, n => { patchSearchSnapshot({ playlistTotal: n }) })

/**
 * 搜索结果里点一首歌 → 走单曲点播（先进试听列表，再从试听列表播）。
 *
 * 与 lx 一致：点歌之后「下一首」是你之前点过的歌，而不是搜索结果的下一行。
 * 想看搜索结果连着听，用上方的「播放全部」。
 */
async function play(item: MusicItem): Promise<void> {
  await player.playSong(item)
}

/** 连着听当前这批搜索结果：队列 = 结果列表，不经过试听列表 */
async function playAll(): Promise<void> {
  const items = filtered.value
  const first = items[0]
  if (!first) return
  await player.play(first, items)
}

/** 手动刷新：清掉会话缓存再搜一次，避免五分钟内一直看旧结果 */
function refresh(): void {
  clearSearchSnapshot()
  void run()
}

function fmtDuration(v: unknown): string {
  return typeof v === 'string' && v ? v : '--:--'
}
</script>

<template>
  <div class="pt-2">
    <div class="mb-4 flex items-baseline gap-3">
      <h1 class="text-[26px] font-bold text-ncm-fg">{{ tf('search.title', { q: keyword }, '搜索「' + keyword + '」') }}</h1>
      <span v-if="searchTab === 'songs' && total" class="text-[14px] text-ncm-faint">{{ tf('search.total', { n: total }, '共 ' + total + ' 首') }}</span>
      <span v-else-if="searchTab === 'playlists' && playlistTotal" class="text-[14px] text-ncm-faint">共 {{ playlistTotal }} 个歌单</span>
      <!--
        「播放全部」不是装饰：点单曲会把队列切成试听列表（lx 的心智模型），
        想连着听当前这批搜索结果就必须从这里进。
      -->
      <div class="ml-auto flex shrink-0 items-center gap-2">
        <button
          v-if="keyword"
          type="button"
          class="flex items-center gap-1.5 rounded-pill border border-ncm-divider px-3 py-1.5 text-[13px] text-ncm-muted transition-colors hover:border-ncm-accent hover:text-ncm-accent"
          :disabled="loading"
          aria-label="重新搜索"
          @click="refresh"
        ><RotateCw :size="13" :stroke-width="2" aria-hidden="true" />刷新</button>
        <button
          v-if="searchTab === 'songs' && filtered.length"
          type="button"
          class="flex items-center gap-1.5 rounded-pill bg-ncm-accent px-3.5 py-1.5 text-[13px] text-white transition-opacity hover:opacity-90"
          @click="playAll"
        >
          <Play :size="14" :stroke-width="2.4" aria-hidden="true" />
          <span>{{ t('search.playAll', '播放全部') }}</span>
        </button>
      </div>
    </div>

    <!-- 单曲 / 歌单：同一个关键词，不用再绕去「发现」页搜一遍 -->
    <div v-if="keyword" class="mb-4 flex items-center gap-2">
      <button
        type="button"
        class="flex items-center gap-1.5 rounded-pill px-4 py-1.5 text-[13px] transition-colors"
        :class="searchTab === 'songs' ? 'bg-ncm-accent text-white' : 'border border-ncm-divider text-ncm-muted hover:bg-black/5'"
        :aria-pressed="searchTab === 'songs'"
        @click="searchTab = 'songs'"
      >单曲<span v-if="total" class="opacity-70">{{ total }}</span></button>
      <button
        type="button"
        class="flex items-center gap-1.5 rounded-pill px-4 py-1.5 text-[13px] transition-colors"
        :class="searchTab === 'playlists' ? 'bg-ncm-accent text-white' : 'border border-ncm-divider text-ncm-muted hover:bg-black/5'"
        :aria-pressed="searchTab === 'playlists'"
        @click="searchTab = 'playlists'"
      ><ListMusic :size="14" aria-hidden="true" />歌单<span v-if="playlistTotal" class="opacity-70">{{ playlistTotal }}</span></button>
    </div>

    <PlaylistSearchPanel
      v-if="searchTab === 'playlists' && keyword"
      :initial-keyword="keyword"
      auto
      @open="openWyPlaylist"
      @result="playlistTotal = $event"
    />

    <!-- 音源筛选：一条结果里混着四个源，按源过滤（与 lx-music 一致） -->
    <div v-else-if="sourceTabs.length > 1" class="mb-3 flex flex-wrap items-center gap-2">
      <button
        v-for="t in sourceTabs"
        :key="t.id"
        type="button"
        class="rounded-full border px-3 py-1 text-[13px] transition-colors"
        :class="activeSource === t.id
          ? 'border-ncm-accent bg-ncm-accent/10 text-ncm-accent'
          : 'border-ncm-divider text-ncm-faint hover:border-ncm-accent hover:text-ncm-accent'"
        :aria-pressed="activeSource === t.id"
        @click="activeSource = t.id"
      >
        {{ t.label }}
        <span class="ml-1 text-[11px] opacity-70">{{ t.count }}</span>
      </button>
    </div>

    <template v-if="searchTab === 'songs'">
    <p v-if="loading" class="text-[15px] text-ncm-faint">{{ t('search.loading', '搜索中…') }}</p>
    <p v-else-if="error" class="text-[15px] text-ncm-accent">{{ error }}</p>
    <p v-else-if="!keyword" class="text-[15px] text-ncm-faint">在上方输入关键词后回车</p>
    <div v-else-if="!list.length" class="flex flex-col items-center">
      <img :src="'./art/empty-search.jpg'" alt="" class="w-[180px] rounded-cover opacity-90" loading="lazy" />
      <p class="mt-4 text-[15px] text-ncm-faint">{{ t('search.empty', '没有找到相关歌曲') }}</p>
    </div>

    <ul v-else class="flex flex-col">
      <li
        v-for="(item, i) in filtered"
        :key="item.source + '-' + item.songmid"
        class="group flex h-[62px] cursor-pointer items-center gap-4 rounded-nav px-3 transition-colors hover:bg-black/5"
        :title="'点击播放：' + item.name"
        @click="play(item)"
      >
        <span class="w-6 shrink-0 text-center text-[15px] text-ncm-fainter">{{ i + 1 }}</span>

        <div class="relative size-[44px] shrink-0 overflow-hidden rounded-[5px] bg-ncm-fainter/30">
          <img
            v-if="picOf(item)"
            :src="picOf(item)"
            alt=""
            class="size-full object-cover"
            loading="lazy"
            referrerpolicy="no-referrer"
            @error="($event.target as HTMLImageElement).src = './art/cover-default.jpg'"
          />
          <img v-else :src="'./art/cover-default.jpg'" alt="" class="size-full object-cover" loading="lazy" />
          <button
            type="button"
            class="absolute inset-0 flex items-center justify-center bg-black/35 opacity-0 transition-opacity group-hover:opacity-100"
            :aria-label="'播放 ' + item.name"
            @click.stop="play(item)"
          >
            <svg viewBox="0 0 24 24" class="size-4 fill-white"><path d="M8 5v14l11-7z" /></svg>
          </button>
        </div>

        <div class="min-w-0 flex-1">
          <div class="truncate text-[16px] text-ncm-fg">{{ item.name }}</div>
          <div class="flex min-w-0 items-center gap-2 text-[13px] text-ncm-faint">
            <span class="truncate">{{ item.singer }}</span>
            <span class="shrink-0 rounded-md bg-ncm-divider px-2 py-0.5 text-[11px]">{{ SOURCE_LABELS[item.source] || item.source }}</span>
          </div>
        </div>

        <button
          type="button"
          class="shrink-0 rounded-full p-2 transition-colors hover:bg-black/5"
          :aria-label="isFav(item) ? '取消收藏' : '收藏'"
          :title="isFav(item) ? '取消收藏' : '收藏'"
          @click.stop="toggleFav(item)"
        >
          <svg
            viewBox="0 0 24 24"
            class="size-[18px] transition-colors"
            :class="isFav(item) ? 'fill-ncm-accent' : 'fill-none stroke-ncm-fainter stroke-2'"
          >
            <path d="M12 21s-7.5-4.9-9.3-9.2C1.2 8.3 3.3 5 6.7 5c2 0 3.6 1.1 4.4 2.7l.9 1.7.9-1.7C13.7 6.1 15.3 5 17.3 5c3.4 0 5.5 3.3 4 6.8C19.5 16.1 12 21 12 21z" />
          </svg>
        </button>

        <div class="hidden w-[240px] shrink-0 truncate text-[14px] text-ncm-faint md:block">
          {{ item.albumName }}
        </div>
        <div class="w-[60px] shrink-0 text-right text-[14px] text-ncm-fainter">
          {{ fmtDuration(item.interval) }}
        </div>
      </li>
    </ul>

    <p v-if="filtered.length" class="mt-4 text-[13px] text-ncm-fainter">
      双击播放。搜索已整合多个音源，可优先选择有播放权限的版本；VIP 专享或下架歌曲需遵守原平台版权要求。
    </p>
    </template>
  </div>
</template>
