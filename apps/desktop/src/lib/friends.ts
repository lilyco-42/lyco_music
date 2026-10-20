/**
 * 好友（桌面端）
 *
 * 身份即订阅：好友身份直接复用会员令牌，界面里只展示好友码。
 * 所有请求走 https://lain42.top/studio，自建同步服务器不带好友功能
 * （好友是官方服务端的语义，不是同步文档的一部分）。
 */
import { computed, ref } from 'vue'
import { DEFAULT_SYNC_BASE } from '@lxmn/core'
import { subscription } from './subscription'

export interface FriendView {
  friendCode: string
  nickname: string
  online: boolean
  lastActiveAt: number
  friendsSince: number
}

export interface FriendPendingIn {
  id: number
  friendCode: string
  nickname: string
  createdAt: number
}

export interface FriendPendingOut {
  friendCode: string
  nickname: string
  createdAt: number
}

export interface FriendsState {
  me: { friendCode: string; nickname: string; online: boolean } | null
  friends: FriendView[]
  pendingIn: FriendPendingIn[]
  pendingOut: FriendPendingOut[]
}

/**
 * 带 HTTP 状态的错误。
 *
 * 以前这里只抛一句中文，界面无从判断「到底是没会员，还是服务器挂了」，
 * 于是把 500 也显示成「好友功能需要音乐会员」——用户看到的就是
 * 「我明明有 VIP，怎么掉了」。状态码必须一路传到界面。
 *
 * status 约定：
 *   0   本地没有订阅令牌（确实没开会员）
 *   -1  请求没发出去 / 网络断了
 *   ≥400 服务端返回的错误码
 */
export class FriendApiError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'FriendApiError'
    this.status = status
  }
  /** 真的是会员身份问题（没令牌 / 令牌不被认可），其余一律不算 */
  get isMembership(): boolean {
    return this.status === 0 || this.status === 401 || this.status === 403
  }
  /** 服务器暂时不可用 —— 该给「重试」，不该引导去开通 */
  get isTransient(): boolean {
    return this.status === -1 || this.status >= 500 || this.status === 429
  }
}

const OFFICIAL = DEFAULT_SYNC_BASE

const me = ref<FriendsState['me']>(null)
const friends = ref<FriendView[]>([])
const pendingIn = ref<FriendPendingIn[]>([])
const pendingOut = ref<FriendPendingOut[]>([])
const busy = ref(false)
/** 操作类错误（加好友 / 改昵称 / 接受请求） */
const error = ref('')
/** 加载类错误（拉身份和列表），和操作错误分开，免得串到「添加好友」卡片上 */
const loadError = ref('')
/** 明确判定为「没有会员身份」，只有这种情况才引导去开通 */
const denied = ref(false)
const loaded = ref(false)

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await subscription.token()
  if (!token) throw new FriendApiError('需要先开通会员', 0)

  let r: Response
  try {
    r = await fetch(OFFICIAL + '/api/friends' + path, {
      method,
      headers: {
        Authorization: 'Bearer ' + token,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    // fetch 只在「根本没拿到响应」时抛（DNS / 断网 / 证书），不是 HTTP 错误
    throw new FriendApiError('连不上服务器，请检查网络后重试', -1)
  }

  const data = (await r.json().catch(() => ({}))) as T & { detail?: string }
  if (!r.ok) {
    throw new FriendApiError(typeof data.detail === 'string' ? data.detail : '请求失败 ' + r.status, r.status)
  }
  return data
}

/**
 * 拉取我的身份 + 好友列表 + 待处理请求。
 *
 * 两个请求**独立结算**。以前用 Promise.all：列表接口一失败（线上真出现过
 * 500 —— 服务端好友档案并发写入撞唯一约束），身份也一起拿不到，
 * 界面就退化成「好友功能需要音乐会员」，用户以为会员掉了。
 */
async function refresh(force = false): Promise<void> {
  // 上次没拉全就不要再「命中缓存」—— 否则用户重进页面也看不到重试
  if (loaded.value && !force && !loadError.value) return
  busy.value = true
  loadError.value = ''
  try {
    const [mineRes, listRes] = await Promise.allSettled([
      api<NonNullable<FriendsState['me']>>('GET', '/me'),
      api<{}>('GET', ''),
    ])

    if (mineRes.status === 'fulfilled') me.value = mineRes.value
    if (listRes.status === 'fulfilled') {
      const l = listRes.value as unknown as FriendsState
      friends.value = l.friends ?? []
      pendingIn.value = l.pendingIn ?? []
      pendingOut.value = l.pendingOut ?? []
    }
    if (mineRes.status === 'fulfilled' || listRes.status === 'fulfilled') loaded.value = true

    const failures = [mineRes, listRes]
      .filter((x): x is PromiseRejectedResult => x.status === 'rejected')
      .map(x => x.reason)

    // 只有「所有请求都因身份被拒」才算没会员；单个失败不能下这个结论
    denied.value = failures.length > 0 && failures.every(e => e instanceof FriendApiError && e.isMembership)

    if (failures.length) {
      const first = failures[0]
      loadError.value = first instanceof Error ? first.message : '加载失败'
    }
  } finally {
    busy.value = false
  }
}

async function addByCode(code: string): Promise<void> {
  busy.value = true
  error.value = ''
  try {
    await api('POST', '/requests', { friendCode: code.trim().toUpperCase() })
    await refresh(true)
  } catch (e) {
    error.value = e instanceof Error ? e.message : '发送失败'
    throw e
  } finally {
    busy.value = false
  }
}

async function accept(id: number): Promise<void> {
  await api('POST', '/requests/' + id + '/accept')
  await refresh(true)
}

async function decline(id: number): Promise<void> {
  await api('POST', '/requests/' + id + '/decline')
  await refresh(true)
}

async function remove(code: string): Promise<void> {
  await api('DELETE', '/' + code)
  await refresh(true)
}

async function rename(nickname: string): Promise<void> {
  await api('POST', '/nickname', { nickname })
  await refresh(true)
}

export function useFriends() {
  return {
    me, friends, pendingIn, pendingOut, busy, error, loadError, denied, loaded,
    refresh, addByCode, accept, decline, remove, rename,
    hasFriends: computed(() => friends.value.length > 0),
  }
}
