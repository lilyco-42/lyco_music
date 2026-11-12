<script setup lang="ts">
import { useI18n } from '@/lib/i18n'

const { t } = useI18n()
/**
 * 发现音乐：排行榜 + 歌单搜索（PARITY 1.8 / 1.9）。
 *
 * 两件事放在一页，因为它们回答的是同一个问题：「除了我知道的歌名，
 * 还有什么可以听」。lx 也是把它们并到「发现」入口下。
 *
 * 数据都来自网易云：榜单是静态 id 表（见内核 WY_BOARDS），歌单搜索走
 * `/api/cloudsearch/pc?type=1000`。**不需要登录**，也不写回网易云 ——
 * 拿到的曲目只是元数据，播放仍走我们自己的四源串流兜底。
 *
 * 歌单搜索的 UI 抽成了 PlaylistSearchPanel（搜索页也用它）：type=1000 会同时
 * 模糊匹配歌单名和创建者昵称，所以面板按关键词给结果打「歌单名 / 创建者」
 * 标签，并提供「只看同名创建者」（走用户主页接口拿全量，不漏歌单）。
 */
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ListMusic, Play, Trophy } from 'lucide-vue-next'
import {
  WY_BOARDS,
  fetchWyPlaylist,
  type MusicItem,
} from '@lxmn/core'
import { usePlayer } from '@/lib/player'
import { library } from '@/lib/sync'
import { toast } from '@/lib/toast'
import PlaylistSearchPanel from '@/components/PlaylistSearchPanel.vue'

const player = usePlayer()
const router = useRouter()
const route = useRoute()

type Tab = 'boards' | 'playlists'
const tab = ref<Tab>('boards')

/* ---------------- 详情（点开一个榜单/歌单） ---------------- */

interface Detail {
  id: string
  name: string
  cover: string
  total: number
  tracks: MusicItem[]
}

const detail = ref<Detail | null>(null)
const detailLoading = ref(false)
const detailError = ref('')

async function openDetail(id: string, fallbackName: string, cover = ''): Promise<void> {
  detailLoading.value = true
  detailError.value = ''
  detail.value = { id, name: fallbackName, cover, total: 0, tracks: [] }
  try {
    const pl = await fetchWyPlaylist(id)
    detail.value = { id, name: pl.name || fallbackName, cover: pl.cover || cover, total: pl.total, tracks: pl.tracks }
  } catch (e) {
    detailError.value = e instanceof Error ? e.message : String(e)
  } finally {
    detailLoading.value = false
  }
}

function closeDetail(): void {
  detail.value = null
  detailError.value = ''
  // 从搜索页跳过来时 query 里带着歌单 id，返回列表要把它清掉，
  // 否则刷新又会自动弹回详情。
  if (route.query.pl) void router.replace({ query: {} })
}

/**
 * 搜索页点歌单结果会跳到 /discover?pl=<id>&name=…&cover=…。
 * 这里补上落地：详情页逻辑本来就在这页，不必在搜索页再复制一份。
 */
onMounted(() => {
  const id = typeof route.query.pl === 'string' ? route.query.pl : ''
  if (!id) return
  const name = typeof route.query.name === 'string' ? route.query.name : '歌单'
  const cover = typeof route.query.cover === 'string' ? route.query.cover : ''
  void openDetail(id, name, cover)
})

/* ---------------- 播放 / 收藏 ---------------- */

async function playAll(): Promise<void> {
  const tracks = detail.value?.tracks ?? []
  const first = tracks[0]
  if (!first) return
  await player.play(first, tracks)
}

async function playOne(item: MusicItem): Promise<void> {
  await player.playSong(item)
}

/** 把整张榜/歌单加进试听列表：不覆盖当前队列，只是「先收着」 */
async function addAllToTrial(): Promise<void> {
  const tracks = detail.value?.tracks ?? []
  if (!tracks.length) return
  let added = 0
  for (const item of tracks) {
    if (await library.addToTrial(item)) added++
  }
  toast(added ? `已加入试听列表 ${added} 首` : '这些歌都已经在试听列表里了')
}

/** 存成自建歌单：榜单天天变，用户想留住某一期就靠这个 */
async function saveAsPlaylist(): Promise<void> {
  const d = detail.value
  if (!d?.tracks.length) return
  const pl = await library.createPlaylist(d.name.slice(0, 40))
  let added = 0
  for (const item of d.tracks) {
    if (await library.addToPlaylist(pl.id, item)) added++
  }
  toast(`已存为歌单「${pl.name}」：${added} 首`)
  void router.push({ path: '/my', query: { pl: pl.id } })
}

/* ---------------- 展示辅助 ---------------- */

function fmtDuration(v: unknown): string {
  return typeof v === 'string' && v ? v : '--:--'
}

const tabs = computed(() => ([
  { id: 'boards' as const, label: '排行榜' },
  { id: 'playlists' as const, label: '歌单搜索' },
]))
</script>

<template>
  <div class="pt-2">
    <!-- ============ 详情：一个榜单 / 一个歌单 ============ -->
    <template v-if="detail">
      <div class="mb-4 flex items-center gap-3">
        <button
          type="button"
          class="rounded-full border border-ncm-divider px-3 py-1 text-[13px] text-ncm-muted hover:bg-black/5"
          @click="closeDetail"
        >返回</button>
        <h1 class="min-w-0 flex-1 truncate text-[24px] font-bold text-ncm-fg">{{ detail.name }}</h1>
        <span v-if="detail.total" class="shrink-0 text-[13px] text-ncm-faint">{{ detail.total }} 首</span>
      </div>

      <div v-if="detail.tracks.length" class="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="flex items-center gap-1.5 rounded-pill bg-ncm-accent px-3.5 py-1.5 text-[13px] text-white transition-opacity hover:opacity-90"
          @click="playAll"
        >
          <Play :size="14" :stroke-width="2.4" aria-hidden="true" />播放全部
        </button>
        <button
          type="button"
          class="flex items-center gap-1.5 rounded-pill border border-ncm-divider px-3.5 py-1.5 text-[13px] text-ncm-muted hover:bg-black/5"
          @click="addAllToTrial"
        >
          <ListMusic :size="14" aria-hidden="true" />加入试听列表
        </button>
        <button
          type="button"
          class="flex items-center gap-1.5 rounded-pill border border-ncm-divider px-3.5 py-1.5 text-[13px] text-ncm-muted hover:bg-black/5"
          @click="saveAsPlaylist"
        >存为我的歌单</button>
      </div>

      <p v-if="detailLoading" class="text-[15px] text-ncm-faint">读取曲目…</p>
      <p v-else-if="detailError" class="text-[15px] text-ncm-accent">{{ detailError }}</p>

      <ul v-else class="flex flex-col">
        <li
          v-for="(item, i) in detail.tracks"
          :key="item.source + '-' + String(item.songmid)"
          class="group flex h-[56px] cursor-pointer items-center gap-3 rounded-nav px-3 transition-colors hover:bg-black/5"
          @click="playOne(item)"
        >
          <span class="w-6 shrink-0 text-center text-[14px] text-ncm-fainter">{{ i + 1 }}</span>
          <div class="relative size-[40px] shrink-0 overflow-hidden rounded-[5px] bg-ncm-fainter/30">
            <img
              v-if="item.picUrl"
              :src="String(item.picUrl)"
              alt=""
              class="size-full object-cover"
              loading="lazy"
              referrerpolicy="no-referrer"
            />
            <button
              type="button"
              class="absolute inset-0 flex items-center justify-center bg-black/35 opacity-0 transition-opacity group-hover:opacity-100"
              :aria-label="'播放 ' + item.name"
              @click.stop="playOne(item)"
            ><Play :size="15" class="text-white" aria-hidden="true" /></button>
          </div>
          <div class="min-w-0 flex-1">
            <p class="truncate text-[14px] text-ncm-fg">{{ item.name }}</p>
            <p class="truncate text-[12px] text-ncm-faint">{{ item.singer }}</p>
          </div>
          <span class="hidden w-[180px] shrink-0 truncate text-[12px] text-ncm-faint sm:block">{{ item.albumName }}</span>
          <span class="w-[52px] shrink-0 text-right text-[12px] tabular-nums text-ncm-fainter">{{ fmtDuration(item.interval) }}</span>
        </li>
      </ul>
    </template>

    <!-- ============ 列表：排行榜 / 歌单搜索 ============ -->
    <template v-else>
      <div class="mb-5 flex flex-wrap items-center gap-3">
        <h1 class="text-[26px] font-bold text-ncm-fg">{{ t('page.discover', '发现音乐') }}</h1>
        <div class="flex items-center gap-1 rounded-full border border-ncm-divider p-0.5">
          <button
            v-for="t in tabs"
            :key="t.id"
            type="button"
            class="rounded-full px-3 py-1 text-[13px] transition-colors"
            :class="tab === t.id ? 'bg-ncm-accent text-white' : 'text-ncm-muted hover:bg-black/5'"
            :aria-pressed="tab === t.id"
            @click="tab = t.id"
          >{{ t.label }}</button>
        </div>
      </div>

      <!-- 排行榜 -->
      <div v-if="tab === 'boards'">
        <p class="mb-3 flex items-center gap-1.5 text-[13px] text-ncm-faint">
          <Trophy :size="14" aria-hidden="true" />
          网易云官方榜，点开就是完整曲目。榜单每天更新，想留住某一期用「存为我的歌单」。
        </p>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <button
            v-for="b in WY_BOARDS"
            :key="b.id"
            type="button"
            class="rounded-xl border border-ncm-divider p-4 text-left transition-all hover:border-ncm-accent/60 hover:bg-ncm-accent/5"
            @click="openDetail(b.id, b.name)"
          >
            <p class="text-[15px] font-medium text-ncm-fg">{{ b.name }}</p>
            <p class="mt-1 text-[12px] leading-[17px] text-ncm-faint">{{ b.desc }}</p>
          </button>
        </div>
      </div>

      <!-- 歌单搜索：与搜索页共用同一面板，命中类型 / 创建者筛选都在面板里 -->
      <div v-else>
        <PlaylistSearchPanel @open="openDetail" />
      </div>
    </template>
  </div>
</template>
