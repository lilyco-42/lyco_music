<script setup lang="ts">
import { useI18n } from '@/lib/i18n'

const { t } = useI18n()
/**
 * 好友页 —— 加好友 / 处理请求 / 看谁在线。
 *
 * 身份即订阅：没开会员时整个页面引导去开通，而不是报错 ——
 * 和云同步页一个套路，用户不用理解「令牌」是什么。
 */
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useFriends } from '../lib/friends'
import { useSharing, type FeedItem } from '../lib/share'

const { me, friends, pendingIn, pendingOut, busy, error, loadError, denied, refresh, addByCode, accept, decline, remove, rename } = useFriends()
const { feed, unread, feedBusy, pullFeed } = useSharing()
const router = useRouter()

const codeInput = ref('')
const nickInput = ref('')
const editingNick = ref(false)
const importCode = ref('')
const importing = ref(false)

onMounted(() => {
  void refresh()
  void pullFeed()
})

/** 打开好友分享的歌单：把分享码存 sessionStorage，「我的音乐」页识别后导入 */
function openShared(item: FeedItem) {
  sessionStorage.setItem('lyco-import-share', item.payload.shareCode)
  router.push({ name: 'my' })
}

async function submitImport() {
  const code = importCode.value.trim()
  if (!code) return
  importing.value = true
  try {
    sessionStorage.setItem('lyco-import-share', code.toUpperCase())
    importCode.value = ''
    router.push({ name: 'my' })
  } finally {
    importing.value = false
  }
}

function fmtFeedTime(t: number): string {
  const d = new Date(t * 1000)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  return sameDay
    ? String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
    : d.getMonth() + 1 + '/' + d.getDate()
}

async function submitAdd() {
  if (!codeInput.value.trim()) return
  try {
    await addByCode(codeInput.value)
    codeInput.value = ''
  } catch { /* error 已在 lib 里置好，界面展示 */ }
}

async function saveNick() {
  const n = nickInput.value.trim()
  if (!n) return
  try {
    await rename(n)
    editingNick.value = false
  } catch { /* 同上 */ }
}

async function copyCode(): Promise<void> {
  if (me.value) await navigator.clipboard.writeText(me.value.friendCode)
}

function fmtTime(t: number): string {
  if (!t) return '—'
  const d = new Date(t * 1000)
  return d.getMonth() + 1 + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}
</script>

<template>
  <div class="mx-auto w-full max-w-[980px] px-8 py-6">
    <h1 class="text-[26px] font-bold text-ncm-fg">{{ t('page.friends', '好友') }}</h1>

    <!-- 确实没有会员：引导去开通 -->
    <div v-if="!me && !busy && denied" class="mt-10 flex flex-col items-center rounded-nav bg-ncm-surface p-10">
      <img :src="'./art/avatar-default.jpg'" alt="" class="w-[120px] rounded-full opacity-90" />
      <p class="mt-5 text-[16px] text-ncm-fg">好友功能需要音乐会员</p>
      <p class="mt-2 text-[14px] text-ncm-faint">开通后用好友码加好友，同步歌单、看在线状态</p>
      <RouterLink
        to="/membership"
        class="mt-5 rounded-pill bg-ncm-accent px-6 py-2.5 text-[15px] text-white transition-opacity hover:opacity-90"
      >去开通</RouterLink>
    </div>

    <!--
      加载失败（服务器 500 / 断网）单独一条分支。
      以前这里和「没有会员」共用同一块，于是服务端一抖，界面就告诉用户
      「好友功能需要音乐会员」—— 明明有 VIP 也像是掉了。
    -->
    <div v-else-if="!me && !busy && loadError" class="mt-10 flex flex-col items-center rounded-nav bg-ncm-surface p-10">
      <p class="text-[16px] text-ncm-fg">好友列表加载失败</p>
      <p class="mt-2 max-w-[460px] text-center text-[14px] text-ncm-faint">{{ loadError }}</p>
      <button
        type="button"
        class="mt-5 rounded-pill border border-ncm-divider px-6 py-2.5 text-[15px] text-ncm-muted hover:bg-black/5"
        @click="() => { void refresh(true) }"
      >重新加载</button>
    </div>

    <template v-else-if="me">
      <!-- 身份拿到了但列表没拿到：只提示，不清空已有内容 -->
      <div v-if="loadError" class="mt-5 flex items-center gap-3 rounded-nav bg-ncm-surface px-5 py-3">
        <p class="min-w-0 flex-1 text-[13px] text-ncm-muted">好友列表没加载出来：{{ loadError }}</p>
        <button
          type="button"
          class="shrink-0 rounded-pill border border-ncm-divider px-4 py-1.5 text-[13px] text-ncm-muted hover:bg-black/5"
          @click="() => { void refresh(true) }"
        >重试</button>
      </div>

      <!-- 我的身份卡 -->
      <div class="mt-5 flex items-center gap-5 rounded-nav bg-ncm-surface p-5">
        <img :src="'./art/avatar-default.jpg'" alt="" class="size-[64px] rounded-full" />
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-3">
            <span class="truncate text-[18px] font-semibold text-ncm-fg">{{ me.nickname }}</span>
            <span class="rounded-full bg-ncm-accent/10 px-2.5 py-0.5 text-[12px] text-ncm-accent">{{ me.online ? '在线' : '离线' }}</span>
          </div>
          <div class="mt-1.5 flex items-center gap-2">
            <span class="text-[13px] text-ncm-faint">好友码</span>
            <code class="rounded bg-ncm-bg px-2 py-0.5 font-mono text-[15px] tracking-widest text-ncm-fg">{{ me.friendCode }}</code>
            <button
              type="button"
              class="text-[13px] text-ncm-accent hover:underline"
              @click="() => { void copyCode() }"
            >复制</button>
          </div>
        </div>
        <button
          type="button"
          class="rounded-pill border border-ncm-divider px-4 py-1.5 text-[13px] text-ncm-muted hover:bg-black/5"
          @click="editingNick = !editingNick"
        >改昵称</button>
      </div>

      <div v-if="editingNick" class="mt-3 flex gap-2">
        <input
          v-model="nickInput"
          maxlength="20"
          placeholder="新的昵称"
          class="w-[240px] rounded-search border border-ncm-divider bg-ncm-bg px-4 py-2 text-[14px] text-ncm-fg outline-none focus:border-ncm-accent"
        />
        <button class="rounded-pill bg-ncm-accent px-4 py-2 text-[13px] text-white" @click="saveNick">保存</button>
      </div>

      <!-- 好友动态 -->
      <div v-if="feed.length" class="mt-5 rounded-nav bg-ncm-surface p-5">
        <p class="text-[15px] font-semibold text-ncm-fg">好友动态</p>
        <ul class="mt-3 flex flex-col gap-2.5">
          <li v-for="(item, i) in feed" :key="i" class="flex items-center gap-3">
            <span class="min-w-0 flex-1 truncate text-[14px] text-ncm-fg">
              <b class="font-semibold">{{ item.nickname }}</b>
              分享了歌单「{{ item.payload.name }}」（{{ item.payload.count }} 首）
            </span>
            <span class="text-[12px] text-ncm-fainter">{{ fmtFeedTime(item.createdAt) }}</span>
            <button class="rounded-pill bg-ncm-accent/10 px-3 py-1 text-[12px] text-ncm-accent hover:bg-ncm-accent/20" @click="openShared(item)">导入</button>
          </li>
        </ul>
      </div>

    <!-- 导入分享码 -->
      <div class="mt-3 flex gap-2">
        <input v-model="importCode" maxlength="10" placeholder="输入歌单分享码" class="flex-1 rounded-search border border-ncm-divider bg-ncm-bg px-4 py-2 font-mono text-[14px] uppercase text-ncm-fg outline-none focus:border-ncm-accent" @keyup.enter="submitImport" />
        <button class="rounded-pill border border-ncm-divider px-4 py-2 text-[13px] text-ncm-muted hover:bg-black/5 disabled:opacity-50" :disabled="importing || !importCode.trim()" @click="submitImport">导入</button>
      </div>

    <!-- 加好友 -->
      <div class="mt-5 rounded-nav bg-ncm-surface p-5">
        <p class="text-[15px] font-semibold text-ncm-fg">添加好友</p>
        <div class="mt-3 flex gap-2">
          <input
            v-model="codeInput"
            maxlength="8"
            placeholder="输入对方的好友码（8 位）"
            class="flex-1 rounded-search border border-ncm-divider bg-ncm-bg px-4 py-2.5 font-mono text-[15px] tracking-widest text-ncm-fg uppercase outline-none focus:border-ncm-accent"
            @keyup.enter="submitAdd"
          />
          <button
            class="rounded-pill bg-ncm-accent px-6 py-2.5 text-[14px] text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            :disabled="busy || !codeInput.trim()"
            @click="submitAdd"
          >发送请求</button>
        </div>
        <p v-if="error" class="mt-2 text-[13px] text-ncm-accent">{{ error }}</p>
      </div>

      <!-- 收到的请求 -->
      <section v-if="pendingIn.length" class="mt-5">
        <h2 class="text-[16px] font-semibold text-ncm-fg">收到的请求（{{ pendingIn.length }}）</h2>
        <ul class="mt-3 flex flex-col gap-2">
          <li
            v-for="p in pendingIn"
            :key="p.id"
            class="flex items-center gap-4 rounded-nav bg-ncm-surface p-4"
          >
            <img :src="'./art/avatar-default.jpg'" alt="" class="size-[44px] rounded-full" />
            <div class="min-w-0 flex-1">
              <div class="truncate text-[15px] text-ncm-fg">{{ p.nickname }}</div>
              <div class="text-[12px] text-ncm-faint">{{ p.friendCode }} · {{ fmtTime(p.createdAt) }}</div>
            </div>
            <button class="rounded-pill bg-ncm-accent px-4 py-1.5 text-[13px] text-white" @click="() => { void accept(p.id) }">接受</button>
            <button class="rounded-pill border border-ncm-divider px-4 py-1.5 text-[13px] text-ncm-muted hover:bg-black/5" @click="() => { void decline(p.id) }">拒绝</button>
          </li>
        </ul>
      </section>

      <p v-if="pendingOut.length" class="mt-3 text-[13px] text-ncm-faint">
        已发送 {{ pendingOut.length }} 个请求等待对方处理
      </p>

      <!-- 好友列表 -->
      <section class="mt-5">
        <h2 class="text-[16px] font-semibold text-ncm-fg">我的好友（{{ friends.length }}）</h2>
        <p v-if="!friends.length" class="mt-3 text-[14px] text-ncm-faint">
          还没有好友。把你的好友码发给朋友，让他们来加你。
        </p>
        <ul v-else class="mt-3 flex flex-col gap-2">
          <li
            v-for="f in friends"
            :key="f.friendCode"
            class="group flex items-center gap-4 rounded-nav bg-ncm-surface p-4"
          >
            <div class="relative">
              <img :src="'./art/avatar-default.jpg'" alt="" class="size-[44px] rounded-full" />
              <span
                class="absolute bottom-0 right-0 size-[11px] rounded-full border-2 border-ncm-surface"
                :class="f.online ? 'bg-green-500' : 'bg-ncm-fainter'"
              />
            </div>
            <div class="min-w-0 flex-1">
              <div class="truncate text-[15px] text-ncm-fg">{{ f.nickname }}</div>
              <div class="text-[12px] text-ncm-faint">{{ f.online ? '在线' : '最近活跃 ' + fmtTime(f.lastActiveAt) }}</div>
            </div>
            <button
              type="button"
              class="rounded-pill border border-ncm-divider px-4 py-1.5 text-[13px] text-ncm-muted opacity-0 transition-opacity hover:bg-black/5 group-hover:opacity-100"
              @click="() => { void remove(f.friendCode) }"
            >删除</button>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
