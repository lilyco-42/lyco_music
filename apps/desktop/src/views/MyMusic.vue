<script setup lang="ts">
/**
 * 我的音乐：我喜欢的音乐 / 最近播放 / 我的歌单（桌面端）
 *
 * 歌单在这里创建和管理：新建、改名、删单、把歌加进来或移出去。
 * 曲库是内核级的（packages/core），桌面端与移动端读的是同一份数据 ——
 * 在这里建好的歌单会跟着云同步走。
 *
 * 取名不用 window.prompt：Electron 不支持它（调用直接报错），
 * 所以新建和改名都用页面内的输入框。
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ChevronLeft, ListMusic, Pencil, Play, Plus } from 'lucide-vue-next'
import { usePlayer } from '@/lib/player'
import { useSync } from '@/lib/sync'
import { useSharing } from '@/lib/share'
import type { MusicItem, SourceId } from '@lxmn/core'

const { library, favorites, history, playlists } = useSync()
const player = usePlayer()
const { getShared } = useSharing()
const route = useRoute()
const router = useRouter()

type Tab = 'fav' | 'recent' | 'playlist'
const tab = ref<Tab>('fav')

/** 当前打开的歌单 id；null = 停在歌单列表 */
const openId = ref<string | null>(null)
const opened = computed(() => (openId.value ? playlists.value.find(p => p.id === openId.value) ?? null : null))

// —— 分享导入：好友页或手输分享码跳转过来时，sessionStorage 里带着码 ——
const importPrompt = ref<{ code: string; name: string; count: number } | null>(null)
const importBusy = ref(false)

onMounted(async () => {
  const code = sessionStorage.getItem('lyco-import-share')
  if (!code) return
  sessionStorage.removeItem('lyco-import-share')
  try {
    const s = await getShared(code)
    importPrompt.value = { code, name: s.name, count: s.trackCount }
  } catch { /* 分享失效就静默忽略，不打断页面 */ }
})

async function confirmImport(): Promise<void> {
  const pr = importPrompt.value
  if (!pr) return
  importBusy.value = true
  try {
    const s = await getShared(pr.code)
    const pl = await library.createPlaylist(uniqueName(s.name || '导入的歌单'))
    for (const t of s.tracks) {
      await library.addToPlaylist(pl.id, { ...t, id: t.songmid, source: t.source as SourceId })
    }
    importPrompt.value = null
    setTab('playlist')
    openPlaylist(pl.id)
  } catch { /* 导入失败静默；歌单页会显示实际结果 */ } finally {
    importBusy.value = false
  }
}

function dismissImport(): void {
  importPrompt.value = null
}

/** 列表项：把 playedAt 显式提出来，模板里就不用做类型断言（vue-tsc 不接受模板中的 as） */
interface Row {
  item: MusicItem
  playedAt: number
}

const list = computed<Row[]>(() => {
  if (tab.value === 'fav') {
    return favorites.value.map(item => ({ item, playedAt: 0 }))
  }
  return history.value.map(h => ({ item: h, playedAt: h.playedAt }))
})

const plain = computed<MusicItem[]>(() => list.value.map(r => r.item))
const detailItems = computed<MusicItem[]>(() => opened.value?.items ?? [])

function keyOf(i: MusicItem): string {
  return i.source + '-' + String(i.songmid)
}

async function play(item: MusicItem): Promise<void> {
  await player.play(item, plain.value)
}

async function unfav(item: MusicItem): Promise<void> {
  await library.removeFavorite(item)
}

async function addTo(playlistId: string, item: MusicItem): Promise<void> {
  await library.addToPlaylist(playlistId, item)
}

/**
 * <select> 的 change 事件：把选中的歌单 id 取出来并复位。
 * '__new__' 是「新建歌单…」这一项 —— 顺手建一个并把这歌放进去。
 */
function onPick(item: MusicItem, e: Event): void {
  const el = e.target as HTMLSelectElement
  const v = el.value
  el.value = ''
  if (!v) return
  if (v === '__new__') {
    void startCreate(item)
    return
  }
  void addTo(v, item)
}

function fmtTime(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function fmtDay(ms: number): string {
  if (!ms) return '—'
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/* ------------------------------------------------ 歌单：列表 / 详情 */

function coverOf(pl: { items: MusicItem[] }): string {
  const first = pl.items.find(i => i.picUrl)
  return first?.picUrl ? String(first.picUrl) : ''
}

function setTab(t: Tab): void {
  tab.value = t
  creating.value = false
  if (t !== 'playlist') {
    openId.value = null
    if (route.query.pl) void router.replace({ query: {} })
  }
}

function openPlaylist(id: string): void {
  tab.value = 'playlist'
  openId.value = id
  if (route.query.pl !== id) void router.replace({ query: { pl: id } })
}

function closeDetail(): void {
  openId.value = null
  renaming.value = false
  confirmDelete.value = false
  if (route.query.pl) void router.replace({ query: {} })
}

async function playAll(): Promise<void> {
  const items = detailItems.value
  if (!items.length) return
  const first = items[0]
  if (first) await player.play(first, items)
}

async function removeTrack(item: MusicItem): Promise<void> {
  const pl = opened.value
  if (!pl) return
  await library.removeFromPlaylist(pl.id, item)
}

/* ------------------------------------------------ 新建 */

const creating = ref(false)
const createBusy = ref(false)
const newName = ref('')
const createErr = ref('')
const nameInput = ref<HTMLInputElement | null>(null)
/** 从「加入歌单…→新建歌单」进来时，建好后要顺手加进去的那首 */
let pendingTrack: MusicItem | null = null

/**
 * 重名就自动加序号：两个「我的歌单」在侧边栏和列表里无法分辨，
 * 用户点哪个都可能是错的。
 */
function uniqueName(raw: string): string {
  const base = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 32) || '新建歌单'
  const used = new Set(playlists.value.map(p => p.name))
  if (!used.has(base)) return base
  let n = 2
  while (used.has(`${base} ${n}`)) n++
  return `${base} ${n}`
}

/**
 * 打开新建输入框。带上 `also` 时，建好后顺手把这首加进去
 * （列表里的「新建歌单…」走这条路径，少一步操作）。
 */
async function startCreate(also?: MusicItem): Promise<void> {
  setTab('playlist')
  creating.value = true
  createBusy.value = false
  createErr.value = ''
  newName.value = ''
  pendingTrack = also ?? null
  await nextTick()
  nameInput.value?.focus()
  nameInput.value?.select()
}

function cancelCreate(): void {
  creating.value = false
  newName.value = ''
  createErr.value = ''
  pendingTrack = null
}

async function submitCreate(): Promise<void> {
  if (createBusy.value) return
  createBusy.value = true
  createErr.value = ''
  try {
    const pl = await library.createPlaylist(uniqueName(newName.value))
    const also = pendingTrack
    pendingTrack = null
    creating.value = false
    newName.value = ''
    if (also) await library.addToPlaylist(pl.id, also)
    openPlaylist(pl.id)
  } catch (e) {
    createErr.value = e instanceof Error ? e.message : String(e)
  } finally {
    createBusy.value = false
  }
}

/* ------------------------------------------------ 改名 / 删除 */

const renaming = ref(false)
const renameText = ref('')
const renameErr = ref('')
const renameInput = ref<HTMLInputElement | null>(null)

async function startRename(): Promise<void> {
  const pl = opened.value
  if (!pl) return
  renaming.value = true
  renameErr.value = ''
  renameText.value = pl.name
  confirmDelete.value = false
  await nextTick()
  renameInput.value?.focus()
  renameInput.value?.select()
}

async function submitRename(): Promise<void> {
  const pl = opened.value
  if (!pl) return
  const next = renameText.value.replace(/\s+/g, ' ').trim()
  if (!next) {
    renameErr.value = '名字不能为空'
    return
  }
  if (next === pl.name) {
    renaming.value = false
    return
  }
  const ok = await library.renamePlaylist(pl.id, next)
  if (!ok) {
    renameErr.value = '已有同名歌单，换一个名字'
    return
  }
  renaming.value = false
  renameErr.value = ''
}

const confirmDelete = ref(false)

async function doDelete(): Promise<void> {
  const pl = opened.value
  if (!pl) return
  await library.deletePlaylist(pl.id)
  confirmDelete.value = false
  renaming.value = false
  closeDetail()
}

/* ------------------------------------------------ 路由深链（侧边栏点歌单） */

/**
 * 侧边栏用 /my?pl=<id> 打开某个歌单，用 /my?new=1 直接进新建。
 * playlists 是异步加载的：先记下 id，等数据到了再落地。
 */
function applyRoute(): void {
  if (route.name !== 'my') return
  const q = route.query.pl
  const want = typeof q === 'string' ? q : ''
  if (want) {
    if (playlists.value.some(p => p.id === want)) {
      tab.value = 'playlist'
      openId.value = want
    }
    return
  }
  if (route.query.new) {
    void router.replace({ query: {} }).then(() => startCreate())
    return
  }
  const t = route.query.tab
  if (t === 'fav' || t === 'recent' || t === 'playlist') {
    tab.value = t
    if (t !== 'playlist') openId.value = null
  }
}

onMounted(applyRoute)
watch(() => [route.query.pl, route.query.new], applyRoute)
watch(playlists, () => {
  const q = route.query.pl
  if (typeof q === 'string' && q && !openId.value) applyRoute()
})
</script>

<template>
  <div class="pt-2">
    <div class="flex items-start justify-between gap-4">
      <h1 class="text-[30px] font-bold leading-10 text-ncm-fg">我的音乐</h1>
      <button
        type="button"
        class="mt-1 flex shrink-0 items-center gap-1.5 rounded-pill bg-ncm-accent px-4 py-2 text-[14px] text-white transition-opacity hover:opacity-90"
        @click="startCreate()"
      >
        <Plus :size="17" :stroke-width="2.4" aria-hidden="true" />
        <span>新建歌单</span>
      </button>
    </div>

    <!-- 切换 -->
    <div class="mt-5 flex flex-wrap gap-2">
      <button
        type="button"
        class="rounded-pill px-5 py-2 text-[15px] transition-colors"
        :class="tab === 'fav' ? 'bg-ncm-accent text-white' : 'bg-white text-ncm-muted hover:bg-black/5'"
        @click="setTab('fav')"
      >我喜欢的音乐 {{ favorites.length }}</button>
      <button
        type="button"
        class="rounded-pill px-5 py-2 text-[15px] transition-colors"
        :class="tab === 'recent' ? 'bg-ncm-accent text-white' : 'bg-white text-ncm-muted hover:bg-black/5'"
        @click="setTab('recent')"
      >最近播放 {{ history.length }}</button>
      <button
        type="button"
        class="rounded-pill px-5 py-2 text-[15px] transition-colors"
        :class="tab === 'playlist' ? 'bg-ncm-accent text-white' : 'bg-white text-ncm-muted hover:bg-black/5'"
        @click="setTab('playlist')"
      >我的歌单 {{ playlists.length }}</button>
    </div>

    <!-- 新建歌单输入条 -->
    <form
      v-if="creating"
      class="mt-4 flex items-center gap-2 rounded-nav border border-ncm-accent/30 bg-ncm-accent/5 p-3"
      @submit.prevent="submitCreate"
    >
      <ListMusic :size="18" :stroke-width="1.9" class="shrink-0 text-ncm-accent" aria-hidden="true" />
      <input
        ref="nameInput"
        v-model="newName"
        type="text"
        maxlength="40"
        placeholder="给歌单起个名字，回车确认"
        class="min-w-0 flex-1 rounded-[6px] border border-ncm-divider bg-white px-3 py-1.5 text-[14px] text-ncm-fg outline-none placeholder:text-ncm-fainter focus:border-ncm-accent"
        @keydown.esc="cancelCreate"
      />
      <button
        type="submit"
        class="shrink-0 rounded-pill bg-ncm-accent px-4 py-1.5 text-[13px] text-white disabled:opacity-50"
        :disabled="createBusy"
      >{{ createBusy ? '创建中…' : '创建' }}</button>
      <button
        type="button"
        class="shrink-0 rounded-pill border border-ncm-divider px-4 py-1.5 text-[13px] text-ncm-muted hover:bg-black/5"
        @click="cancelCreate"
      >取消</button>
    </form>
    <p v-if="createErr" class="mt-2 text-[13px] text-red-500">{{ createErr }}</p>

    <!-- 分享导入确认条 -->
    <div v-if="importPrompt" class="mt-4 flex items-center gap-3 rounded-nav border border-ncm-accent/30 bg-ncm-accent/5 p-4">
      <span class="flex-1 text-[14px] text-ncm-fg">
        导入歌单「<b class="font-semibold">{{ importPrompt.name }}</b>」（{{ importPrompt.count }} 首）？
      </span>
      <button class="rounded-pill bg-ncm-accent px-4 py-1.5 text-[13px] text-white disabled:opacity-50" :disabled="importBusy" @click="confirmImport">导入</button>
      <button class="rounded-pill border border-ncm-divider px-4 py-1.5 text-[13px] text-ncm-muted hover:bg-black/5" @click="dismissImport">取消</button>
    </div>

    <!-- ============ 歌单列表 ============ -->
    <div v-if="tab === 'playlist' && !opened" class="mt-6">
      <div v-if="!playlists.length" class="mt-10 flex flex-col items-center">
        <img :src="'./art/empty-favorites.jpg'" alt="" class="w-[180px] rounded-cover opacity-90" loading="lazy" />
        <p class="mt-4 text-[15px] text-ncm-faint">还没有歌单。点右上角「新建歌单」建一个。</p>
      </div>
      <div v-else class="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-5">
        <button
          v-for="pl in playlists"
          :key="pl.id"
          type="button"
          class="group flex flex-col text-left"
          @click="openPlaylist(pl.id)"
        >
          <div class="relative aspect-square w-full overflow-hidden rounded-cover bg-ncm-fainter/30">
            <img
              v-if="coverOf(pl)"
              :src="coverOf(pl)"
              alt=""
              class="size-full object-cover transition-transform duration-300 group-hover:scale-105"
              loading="lazy"
              @error="($event.target as HTMLImageElement).src = './art/cover-default.jpg'"
            />
            <img v-else :src="'./art/cover-default.jpg'" alt="" class="size-full object-cover" loading="lazy" />
            <span class="absolute right-2 top-2 rounded-pill bg-black/45 px-2 py-0.5 text-[12px] text-white">{{ pl.items.length }} 首</span>
          </div>
          <span class="mt-2 line-clamp-2 text-[14px] leading-5 text-ncm-fg group-hover:text-ncm-accent">{{ pl.name }}</span>
        </button>
      </div>
    </div>

    <!-- ============ 歌单详情 ============ -->
    <div v-if="tab === 'playlist' && opened" class="mt-5">
      <button
        type="button"
        class="mb-4 flex items-center gap-1 text-[13px] text-ncm-muted transition-colors hover:text-ncm-accent"
        @click="closeDetail"
      >
        <ChevronLeft :size="16" :stroke-width="2" aria-hidden="true" />
        <span>全部歌单</span>
      </button>

      <div class="flex items-start gap-5">
        <div class="size-[132px] shrink-0 overflow-hidden rounded-cover bg-ncm-fainter/30">
          <img
            :src="coverOf(opened) || './art/cover-default.jpg'"
            alt=""
            class="size-full object-cover"
            loading="lazy"
            @error="($event.target as HTMLImageElement).src = './art/cover-default.jpg'"
          />
        </div>

        <div class="min-w-0 flex-1">
          <div v-if="!renaming" class="flex items-center gap-2">
            <h2 class="min-w-0 truncate text-[24px] font-semibold leading-8 text-ncm-fg">{{ opened.name }}</h2>
            <button
              type="button"
              class="shrink-0 rounded-full p-1.5 text-ncm-faint transition-colors hover:bg-black/5 hover:text-ncm-accent"
              title="给歌单改名"
              aria-label="给歌单改名"
              @click="startRename"
            >
              <Pencil :size="15" :stroke-width="1.9" />
            </button>
          </div>

          <form v-else class="flex items-center gap-2" @submit.prevent="submitRename">
            <input
              ref="renameInput"
              v-model="renameText"
              type="text"
              maxlength="40"
              class="min-w-0 flex-1 rounded-[6px] border border-ncm-divider bg-white px-3 py-1.5 text-[15px] text-ncm-fg outline-none focus:border-ncm-accent"
              @keydown.esc="renaming = false"
            />
            <button type="submit" class="shrink-0 rounded-pill bg-ncm-accent px-3 py-1.5 text-[13px] text-white">保存</button>
            <button type="button" class="shrink-0 rounded-pill border border-ncm-divider px-3 py-1.5 text-[13px] text-ncm-muted hover:bg-black/5" @click="renaming = false">取消</button>
          </form>
          <p v-if="renameErr" class="mt-1 text-[12px] text-red-500">{{ renameErr }}</p>

          <p class="mt-1.5 text-[13px] text-ncm-fainter">{{ opened.items.length }} 首 · 创建于 {{ fmtDay(opened.createdAt) }}</p>

          <div class="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              class="flex items-center gap-1.5 rounded-pill bg-ncm-accent px-4 py-1.5 text-[13px] text-white disabled:opacity-40"
              :disabled="!opened.items.length"
              @click="playAll"
            >
              <Play :size="15" :stroke-width="2.2" aria-hidden="true" />
              <span>播放全部</span>
            </button>

            <template v-if="!confirmDelete">
              <button
                type="button"
                class="rounded-pill border border-ncm-divider px-4 py-1.5 text-[13px] text-ncm-muted transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-600"
                @click="confirmDelete = true; renaming = false"
              >删除歌单</button>
            </template>
            <template v-else>
              <span class="text-[13px] text-ncm-muted">删掉「{{ opened.name }}」？不可恢复。</span>
              <button type="button" class="rounded-pill bg-red-500 px-4 py-1.5 text-[13px] text-white" @click="doDelete">确认删除</button>
              <button type="button" class="rounded-pill border border-ncm-divider px-4 py-1.5 text-[13px] text-ncm-muted hover:bg-black/5" @click="confirmDelete = false">取消</button>
            </template>
          </div>
        </div>
      </div>

      <p v-if="!opened.items.length" class="mt-8 text-[15px] text-ncm-faint">
        这个歌单还是空的。到「我喜欢的音乐」或搜索页，用「加入歌单…」把歌放进来。
      </p>

      <ul v-else class="mt-5 flex flex-col">
        <li
          v-for="(item, i) in opened.items"
          :key="keyOf(item)"
          class="group flex h-[62px] cursor-pointer items-center gap-4 rounded-nav px-3 transition-colors hover:bg-black/5"
          @dblclick="play(item)"
        >
          <span class="w-6 shrink-0 text-center text-[15px] text-ncm-fainter">{{ i + 1 }}</span>

          <div class="relative size-[44px] shrink-0 overflow-hidden rounded-[5px] bg-ncm-fainter/30">
            <img
              v-if="item.picUrl"
              :src="String(item.picUrl)"
              alt=""
              class="size-full object-cover"
              loading="lazy"
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
            <div class="truncate text-[13px] text-ncm-faint">{{ item.singer }}</div>
          </div>

          <button
            type="button"
            class="shrink-0 rounded-pill border border-ncm-divider px-3 py-1 text-[12px] text-ncm-muted opacity-0 transition-opacity hover:border-red-300 hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 focus-visible:opacity-100"
            :aria-label="'从歌单移除 ' + item.name"
            @click.stop="removeTrack(item)"
          >移除</button>
        </li>
      </ul>
    </div>

    <!-- ============ 我喜欢的音乐 / 最近播放 ============ -->
    <template v-if="tab !== 'playlist'">
      <div v-if="!list.length" class="mt-10 flex flex-col items-center">
        <img
          :src="tab === 'fav' ? './art/empty-favorites.jpg' : './art/empty-history.jpg'"
          alt=""
          class="w-[180px] rounded-cover opacity-90"
          loading="lazy"
        />
        <p class="mt-4 text-[15px] text-ncm-faint">
          {{ tab === 'fav' ? '还没有收藏。在搜索页点右侧的心形即可收藏。' : '还没有播放记录。' }}
        </p>
      </div>

      <ul v-else class="mt-5 flex flex-col">
        <li
          v-for="(row, i) in list"
          :key="keyOf(row.item)"
          class="group flex h-[62px] cursor-pointer items-center gap-4 rounded-nav px-3 transition-colors hover:bg-black/5"
          @dblclick="play(row.item)"
        >
          <span class="w-6 shrink-0 text-center text-[15px] text-ncm-fainter">{{ i + 1 }}</span>

          <div class="relative size-[44px] shrink-0 overflow-hidden rounded-[5px] bg-ncm-fainter/30">
            <img
              v-if="row.item.picUrl"
              :src="String(row.item.picUrl)"
              alt=""
              class="size-full object-cover"
              loading="lazy"
              @error="($event.target as HTMLImageElement).src = './art/cover-default.jpg'"
            />
            <img v-else :src="'./art/cover-default.jpg'" alt="" class="size-full object-cover" loading="lazy" />
            <button
              type="button"
              class="absolute inset-0 flex items-center justify-center bg-black/35 opacity-0 transition-opacity group-hover:opacity-100"
              :aria-label="'播放 ' + row.item.name"
              @click.stop="play(row.item)"
            >
              <svg viewBox="0 0 24 24" class="size-4 fill-white"><path d="M8 5v14l11-7z" /></svg>
            </button>
          </div>

          <div class="min-w-0 flex-1">
            <div class="truncate text-[16px] text-ncm-fg">{{ row.item.name }}</div>
            <div class="truncate text-[13px] text-ncm-faint">{{ row.item.singer }}</div>
          </div>

          <!-- 加进歌单：永远可见，没有歌单时也能从这里新建 -->
          <select
            class="shrink-0 rounded-[6px] border border-ncm-divider bg-white px-2 py-1.5 text-[13px] text-ncm-muted outline-none"
            @click.stop
            @change="onPick(row.item, $event)"
          >
            <option value="">加入歌单…</option>
            <option v-for="pl in playlists" :key="pl.id" :value="pl.id">{{ pl.name }}</option>
            <option value="__new__">＋ 新建歌单</option>
          </select>

          <span v-if="tab === 'recent'" class="w-[92px] shrink-0 text-right text-[13px] text-ncm-fainter">
            {{ fmtTime(row.playedAt) }}
          </span>

          <button
            v-if="tab === 'fav'"
            type="button"
            class="shrink-0 rounded-full p-2 transition-colors hover:bg-black/5"
            aria-label="取消收藏"
            title="取消收藏"
            @click.stop="unfav(row.item)"
          >
            <svg viewBox="0 0 24 24" class="size-[18px] fill-ncm-accent">
              <path d="M12 21s-7.5-4.9-9.3-9.2C1.2 8.3 3.3 5 6.7 5c2 0 3.6 1.1 4.4 2.7l.9 1.7.9-1.7C13.7 6.1 15.3 5 17.3 5c3.4 0 5.5 3.3 4 6.8C19.5 16.1 12 21 12 21z" />
            </svg>
          </button>
        </li>
      </ul>

      <p v-if="list.length" class="mt-4 text-[13px] text-ncm-fainter">双击播放。</p>
    </template>
  </div>
</template>
