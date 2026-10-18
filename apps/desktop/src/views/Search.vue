<script setup lang="ts">
/**
 * 搜索结果页
 *
 * 这一页是「能真的听歌」的入口：TopBar 的搜索框回车 -> /search?q=xxx
 * -> 调内核的 musicSearch -> 点条目播放。
 */
import { computed, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { getSource, hasSource, type MusicItem } from '@lxmn/core'
import { usePlayer } from '@/lib/player'
import { useSync } from '@/lib/sync'

const route = useRoute()
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

/* ---------- 音源筛选（对齐 lx-music 的「全部 / 网易云 / 酷狗 / 酷我 / 咪咕」） ---------- */

/** 当前选中的音源，'all' 表示不筛选 */
const activeSource = ref<'all' | string>('all')

/** 只列出本次结果里真实出现过的音源，避免出现点了没内容的空页签 */
const sourceTabs = computed(() => {
  const counts = new Map<string, number>()
  for (const item of list.value) counts.set(item.source, (counts.get(item.source) ?? 0) + 1)
  return [
    { id: 'all' as const, label: '全部', count: list.value.length },
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

async function run(): Promise<void> {
  list.value = []
  total.value = 0
  error.value = ''
  activeSource.value = 'all'
  if (!keyword.value) return
  loading.value = true
  try {
    const r = await player.search(keyword.value, 1, 30)
    list.value = r.list
    total.value = r.total
    void hydratePics(r.list)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

watch(keyword, run, { immediate: true })

async function play(item: MusicItem): Promise<void> {
  await player.play(item, list.value)
}

function fmtDuration(v: unknown): string {
  return typeof v === 'string' && v ? v : '--:--'
}
</script>

<template>
  <div class="pt-2">
    <div class="mb-4 flex items-baseline gap-3">
      <h1 class="text-[26px] font-bold text-ncm-fg">搜索「{{ keyword }}」</h1>
      <span v-if="total" class="text-[14px] text-ncm-faint">共 {{ total }} 首</span>
    </div>

    <!-- 音源筛选：一条结果里混着四个源，按源过滤（与 lx-music 一致） -->
    <div v-if="sourceTabs.length > 1" class="mb-3 flex flex-wrap items-center gap-2">
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

    <p v-if="loading" class="text-[15px] text-ncm-faint">搜索中…</p>
    <p v-else-if="error" class="text-[15px] text-ncm-accent">{{ error }}</p>
    <p v-else-if="!keyword" class="text-[15px] text-ncm-faint">在上方输入关键词后回车</p>
    <div v-else-if="!list.length" class="flex flex-col items-center">
      <img :src="'./art/empty-search.jpg'" alt="" class="w-[180px] rounded-cover opacity-90" loading="lazy" />
      <p class="mt-4 text-[15px] text-ncm-faint">没有找到相关歌曲</p>
    </div>

    <ul v-else class="flex flex-col">
      <li
        v-for="(item, i) in filtered"
        :key="item.source + '-' + item.songmid"
        class="group flex h-[62px] cursor-pointer items-center gap-4 rounded-nav px-3 transition-colors hover:bg-black/5"
        @dblclick="play(item)"
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
  </div>
</template>
