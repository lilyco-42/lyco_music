<script setup lang="ts">
import { useI18n } from '@/lib/i18n'

const { t } = useI18n()
/**
 * 云同步页（桌面端）
 *
 * 默认服务器就是 lain42.top —— 用户什么都不用填。
 * 会员用户直接点「用会员订阅开通」即可，同步令牌复用订阅令牌。
 * 也支持自建服务器（填地址 + 令牌）。
 */
import { computed, onMounted, ref } from 'vue'
import { Monitor, RefreshCw } from 'lucide-vue-next'
import { useSync } from '../lib/sync'
import { useMembership } from '../lib/membership'

const {
  favorites, playlists, history,
  configured, tokenMask, baseUrl, busy, error, lastSyncedAt, lastMessage, server,
  restore, connect, connectWithMembership, disconnect, syncNow,
  devices, devicesError, loadDevices, revokeDevice,
} = useSync()

const { isActive } = useMembership()

const token = ref('')
const customBase = ref('')
const showCustom = ref(false)

function fmtTime(ms: number): string {
  if (!ms) return '从未'
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 服务端给的是 ISO 时间串，这里只显示到分钟 */
function fmtIso(iso: string): string {
  if (!iso) return '未知'
  const t = Date.parse(iso)
  return Number.isFinite(t) ? fmtTime(t) : iso
}

async function onConnect() {
  await connect(token.value, showCustom.value ? customBase.value : undefined)
  if (!error.value) token.value = ''
  await loadDevices()
}

/* ---------------- 已认证设备（8.3） ---------------- */

/**
 * 撤销要按两次。
 *
 * 撤销是单向的：那台设备之后会被服务端拒绝，只能重新配对。
 * 一次点击就生效的话，手滑点一下手机就得重配。
 */
const armRevoke = ref('')
const revoking = ref('')

async function onRevoke(id: string): Promise<void> {
  if (armRevoke.value !== id) {
    armRevoke.value = id
    return
  }
  armRevoke.value = ''
  revoking.value = id
  await revokeDevice(id)
  revoking.value = ''
}

/* ---------------- 自建同步服务器（8.2） ---------------- */

const srv = ref<LxmnSyncServerStatus | null>(null)
const srvPort = ref(23331)
const srvBusy = ref(false)
const srvMsg = ref('')
const srvErr = ref('')

const srvAvailable = computed(() => typeof window !== 'undefined' && Boolean(window.lxmnNative?.syncServer))

async function refreshSrv(): Promise<void> {
  const api = window.lxmnNative?.syncServer
  if (!api) return
  try {
    srv.value = await api.status()
    srvPort.value = srv.value.port || srvPort.value
  } catch (e) {
    srvErr.value = e instanceof Error ? e.message : String(e)
  }
}

async function toggleSrv(on: boolean): Promise<void> {
  const api = window.lxmnNative?.syncServer
  if (!api || srvBusy.value) return
  srvBusy.value = true
  srvMsg.value = ''
  srvErr.value = ''
  try {
    srv.value = on ? await api.start({ port: srvPort.value }) : await api.stop()
    if (on && !srv.value.running) srvErr.value = srv.value.error || '启动失败'
    else srvMsg.value = on ? '服务器已启动' : '已停止'
  } catch (e) {
    srvErr.value = e instanceof Error ? e.message : String(e)
  } finally {
    srvBusy.value = false
  }
}

/** 把本机接到自己这台服务器上：地址用 127.0.0.1，不走局域网绕一圈 */
async function useLocalServer(): Promise<void> {
  const s = srv.value
  if (!s?.running) return
  await connect(s.token, `http://127.0.0.1:${s.port}`)
  await loadDevices()
}

const copied = ref('')
async function copyText(text: string, tag: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = tag
    setTimeout(() => { if (copied.value === tag) copied.value = '' }, 1600)
  } catch {
    copied.value = ''
  }
}

onMounted(async () => {
  await restore()
  await loadDevices()
  await refreshSrv()
})

</script>

<template>
  <div class="mx-auto max-w-[1000px] py-2">
    <h1 class="text-[30px] font-bold leading-40 text-ncm-fg">{{ t('page.sync', '云同步') }}</h1>
    <p class="mt-2 text-[15px] text-ncm-faint">
      收藏、歌单、播放记录在桌面端与移动端之间自动同步
    </p>

    <!-- 服务器信息 -->
    <section class="mt-7 rounded-banner border border-ncm-divider bg-white p-7">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-[19px] font-semibold text-ncm-fg">{{ t('sync.server', '同步服务器') }}</h2>
          <p class="mt-1.5 text-[14px] text-ncm-muted">{{ server }}</p>
        </div>
        <span
          class="rounded-pill px-3.5 py-1.5 text-[13px]"
          :class="configured ? 'bg-[#e8f6ec] text-[#2f7d47]' : 'bg-ncm-bg text-ncm-faint'"
        >{{ configured ? '已开通' : '未开通' }}</span>
      </div>

      <p class="mt-4 text-[13px] text-ncm-fainter">
        默认使用官方服务器，无需配置。会员身份即同步身份 —— 激活会员后自动开通。
      </p>

      <!-- 未开通：两种入口 -->
      <template v-if="!configured">
        <button
          v-if="isActive"
          type="button"
          class="mt-5 w-full rounded-pill bg-ncm-accent py-3.5 text-[17px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          :disabled="busy"
          @click="connectWithMembership"
        >{{ t('sync.oneClick', '用会员订阅一键开通') }}</button>

        <div v-else class="mt-5 rounded-channel bg-ncm-bg p-4">
          <p class="text-[14px] text-ncm-muted">
            还没开通会员。同步使用会员令牌，请先到「音乐会员」页激活订阅链接。
          </p>
        </div>

        <button
          type="button"
          class="mt-3 text-[14px] text-ncm-fainter hover:text-ncm-accent"
          @click="showCustom = !showCustom"
        >{{ showCustom ? '收起自建服务器' : '使用自建同步服务器' }}</button>

        <template v-if="showCustom">
          <input
            v-model="customBase"
            type="text"
            :placeholder="'服务器地址，如 https://sync.example.com/studio'"
            class="mt-4 w-full rounded-search border border-ncm-divider bg-ncm-bg px-4 py-3.5 text-[15px] text-ncm-fg outline-none placeholder:text-ncm-fainter focus:border-ncm-accent"
          />
          <input
            v-model="token"
            type="text"
            placeholder="同步令牌"
            class="mt-3 w-full rounded-search border border-ncm-divider bg-ncm-bg px-4 py-3.5 text-[15px] text-ncm-fg outline-none placeholder:text-ncm-fainter focus:border-ncm-accent"
            @keyup.enter="onConnect"
          />
          <button
            type="button"
            class="mt-3 w-full rounded-pill border border-ncm-divider py-3 text-[16px] text-ncm-fg transition-colors hover:bg-black/5 disabled:opacity-60"
            :disabled="busy"
            @click="onConnect"
          >{{ t('sync.connect', '连接') }}</button>
        </template>
      </template>

      <!-- 已开通 -->
      <template v-else>
        <div class="mt-5 flex items-center gap-6 rounded-channel bg-ncm-bg p-5">
          <div>
            <p class="text-[13px] text-ncm-faint">{{ t('sync.token', '同步令牌') }}</p>
            <p class="mt-1 font-mono text-[15px] text-ncm-fg">{{ tokenMask || '—' }}</p>
          </div>
          <div class="ml-auto text-right">
            <p class="text-[13px] text-ncm-faint">{{ t('sync.lastSync', '上次同步') }}</p>
            <p class="mt-1 text-[15px] text-ncm-fg">{{ fmtTime(lastSyncedAt) }}</p>
          </div>
        </div>

        <div class="mt-4 flex gap-3">
          <button
            type="button"
            class="flex-1 rounded-pill bg-ncm-accent py-3 text-[16px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            :disabled="busy"
            @click="syncNow"
          >{{ busy ? '同步中…' : '立即同步' }}</button>
          <button
            type="button"
            class="rounded-pill border border-ncm-divider px-7 py-3 text-[16px] text-ncm-fg transition-colors hover:bg-black/5 disabled:opacity-60"
            :disabled="busy"
            @click="disconnect"
          >{{ t('sync.disable', '关闭同步') }}</button>
        </div>
      </template>

      <p v-if="error" class="mt-3 text-[14px] text-ncm-accent">{{ error }}</p>
      <p v-else-if="lastMessage" class="mt-3 text-[14px] text-ncm-faint">{{ lastMessage }}</p>
    </section>

    <!-- 已认证设备（8.3） -->
    <section v-if="configured" class="mt-6 rounded-banner border border-ncm-divider bg-white p-7">
      <div class="flex items-center justify-between">
        <h2 class="text-[19px] font-semibold text-ncm-fg">{{ t('sync.devices', '已认证设备') }}</h2>
        <button
          type="button"
          class="flex items-center gap-1.5 rounded-full border border-ncm-divider px-3 py-1 text-[12px] text-ncm-muted hover:bg-ncm-bg"
          @click="loadDevices"
        >
          <RefreshCw :size="13" aria-hidden="true" />刷新
        </button>
      </div>
      <p class="mt-1.5 text-[13px] leading-[19px] text-ncm-faint">
        每台设备第一次同步时自动登记。撤销之后那台设备再也读不到同步数据，需要重新配对才能用 ——
        手机丢了就撤销那一台，不用把所有设备踢下线。
      </p>

      <p v-if="devicesError" class="mt-3 text-[13px] text-ncm-accent">{{ devicesError }}</p>
      <p v-else-if="!devices.length" class="mt-3 text-[13px] text-ncm-fainter">
        还没有设备记录（当前服务器可能不支持设备列表）
      </p>
      <ul v-else class="mt-4 divide-y divide-ncm-divider">
        <li v-for="d in devices" :key="d.id" class="flex items-center gap-3 py-3">
          <Monitor :size="16" class="shrink-0 text-ncm-faint" aria-hidden="true" />
          <div class="min-w-0 flex-1">
            <p class="truncate text-[14px]" :class="d.revoked ? 'text-ncm-fainter line-through' : 'text-ncm-fg'">{{ d.name }}</p>
            <p class="mt-0.5 text-[12px] text-ncm-faint">最近同步 {{ fmtIso(d.lastSeenAt) }} · 版本 {{ d.revision }}</p>
          </div>
          <span v-if="d.revoked" class="shrink-0 rounded-pill bg-ncm-bg px-2.5 py-1 text-[12px] text-ncm-fainter">{{ t('sync.revoked', '已撤销') }}</span>
          <button
            v-else
            type="button"
            class="shrink-0 rounded-pill border px-3 py-1 text-[12px] transition-colors"
            :class="armRevoke === d.id ? 'border-ncm-accent bg-ncm-accent/5 text-ncm-accent' : 'border-ncm-divider text-ncm-muted hover:bg-ncm-bg'"
            :disabled="revoking === d.id"
            @click="onRevoke(d.id)"
          >{{ revoking === d.id ? '撤销中…' : armRevoke === d.id ? '再点一次确认' : '撤销' }}</button>
        </li>
      </ul>
    </section>

    <!-- 自建同步服务器（8.2） -->
    <section v-if="srvAvailable" class="mt-6 rounded-banner border border-ncm-divider bg-white p-7">
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <h2 class="text-[19px] font-semibold text-ncm-fg">{{ t('sync.host', '把这台电脑变成同步服务器') }}</h2>
          <p class="mt-1.5 text-[13px] leading-[19px] text-ncm-faint">
            局域网里的手机、另一台电脑填下面的地址和令牌就能同步。数据只存在本机的
            <span class="font-mono text-[12px]">userData/sync-server</span> 目录，不经过任何第三方服务器。
          </p>
        </div>
        <span
          class="shrink-0 rounded-pill px-3.5 py-1.5 text-[13px]"
          :class="srv?.running ? 'bg-[#e8f6ec] text-[#2f7d47]' : 'bg-ncm-bg text-ncm-faint'"
        >{{ srv?.running ? '运行中' : '未启动' }}</span>
      </div>

      <div class="mt-5 flex flex-wrap items-center gap-3">
        <label class="text-[13px] text-ncm-faint" for="srv-port">{{ t('sync.port', '端口') }}</label>
        <input
          id="srv-port"
          v-model.number="srvPort"
          type="number"
          min="1024"
          max="65535"
          :disabled="srv?.running"
          class="w-[110px] rounded-[8px] border border-ncm-divider bg-ncm-bg px-2.5 py-1.5 text-[13px] text-ncm-fg outline-none focus:border-ncm-accent disabled:opacity-60"
        />
        <button
          type="button"
          class="rounded-pill bg-ncm-accent px-4 py-1.5 text-[13px] text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          :disabled="srvBusy"
          @click="toggleSrv(!srv?.running)"
        >{{ srvBusy ? '处理中…' : srv?.running ? '停止服务器' : '启动服务器' }}</button>
        <button
          v-if="srv?.running"
          type="button"
          class="rounded-pill border border-ncm-divider px-4 py-1.5 text-[13px] text-ncm-muted hover:bg-ncm-bg"
          @click="useLocalServer"
        >让本机连它</button>
      </div>

      <div v-if="srv?.running" class="mt-4 rounded-channel bg-ncm-bg p-4">
        <p class="text-[13px] text-ncm-faint">局域网地址（手机/其他电脑填这个）</p>
        <ul v-if="srv.urls.length" class="mt-1.5 space-y-1">
          <li v-for="u in srv.urls" :key="u" class="flex items-center gap-2">
            <span class="font-mono text-[14px] text-ncm-fg">{{ u }}</span>
            <button
              type="button"
              class="rounded-full border border-ncm-divider px-2 py-0.5 text-[11px] text-ncm-muted hover:bg-white"
              @click="copyText(u, u)"
            >{{ copied === u ? '已复制' : '复制' }}</button>
          </li>
        </ul>
        <p v-else class="mt-1.5 text-[13px] text-ncm-fainter">
          没检测到局域网地址（可能没连网络）。本机可以用 http://127.0.0.1:{{ srv.port }}
        </p>

        <div class="mt-3">
          <p class="text-[13px] text-ncm-faint">访问令牌</p>
          <div class="mt-1 flex items-center gap-2">
            <span class="font-mono text-[14px] text-ncm-fg">{{ srv.token }}</span>
            <button
              type="button"
              class="rounded-full border border-ncm-divider px-2 py-0.5 text-[11px] text-ncm-muted hover:bg-white"
              @click="copyText(srv.token, 'tok')"
            >{{ copied === 'tok' ? '已复制' : '复制' }}</button>
          </div>
        </div>
      </div>

      <p v-if="srvErr" class="mt-3 text-[13px] text-ncm-accent">{{ srvErr }}</p>
      <p v-else-if="srvMsg" class="mt-3 text-[13px] text-ncm-faint">{{ srvMsg }}</p>
    </section>

    <!-- 本地数据概览 -->
    <section class="mt-6 grid grid-cols-3 gap-4">
      <div class="rounded-channel border border-ncm-divider bg-white p-5">
        <p class="text-[26px] font-bold text-ncm-fg">{{ favorites.length }}</p>
        <p class="mt-1 text-[14px] text-ncm-faint">我喜欢的音乐</p>
      </div>
      <div class="rounded-channel border border-ncm-divider bg-white p-5">
        <p class="text-[26px] font-bold text-ncm-fg">{{ playlists.length }}</p>
        <p class="mt-1 text-[14px] text-ncm-faint">创建的歌单</p>
      </div>
      <div class="rounded-channel border border-ncm-divider bg-white p-5">
        <p class="text-[26px] font-bold text-ncm-fg">{{ history.length }}</p>
        <p class="mt-1 text-[14px] text-ncm-faint">最近播放</p>
      </div>
    </section>

    <!-- 说明：为什么不是「最后写入者胜出」 -->
    <section class="mt-6 rounded-channel border border-ncm-divider bg-white p-6">
      <h3 class="text-[16px] font-semibold text-ncm-fg">冲突是怎么处理的</h3>
      <ul class="mt-3 space-y-2">
        <li class="flex gap-3">
          <span class="mt-2 size-1.5 shrink-0 rounded-full bg-ncm-accent" />
          <span class="text-[14px] text-ncm-muted">收藏、歌单取并集 —— 任何一台设备上收藏过的歌都不会丢</span>
        </li>
        <li class="flex gap-3">
          <span class="mt-2 size-1.5 shrink-0 rounded-full bg-ncm-accent" />
          <span class="text-[14px] text-ncm-muted">播放次数取两边较大的值，不会因为同步而翻倍</span>
        </li>
        <li class="flex gap-3">
          <span class="mt-2 size-1.5 shrink-0 rounded-full bg-ncm-accent" />
          <span class="text-[14px] text-ncm-muted">歌单里歌曲的顺序以最近修改的那台设备为准，不重排</span>
        </li>
      </ul>
    </section>
  </div>
</template>
