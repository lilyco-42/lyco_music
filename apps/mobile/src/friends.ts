/**
 * 好友（移动端）
 *
 * 和桌面端同一套协议；身份复用会员令牌（license.ts 里的 subscription）。
 * Hermes 没有 fetch 的问题不存在 —— RN 自带 fetch。
 */
import { useState } from 'react'
import { DEFAULT_SYNC_BASE } from '@lxmn/core'
import { subscription } from './license'

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

export interface FriendsState {
  me: { friendCode: string; nickname: string; online: boolean } | null
  friends: FriendView[]
  pendingIn: FriendPendingIn[]
  pendingOut: { friendCode: string; nickname: string; createdAt: number }[]
}

/**
 * 带 HTTP 状态的错误。界面据此区分「真的没会员」和「服务器挂了」——
 * 以前只有一句中文，服务端 500 也会被显示成「好友功能需要音乐会员」。
 *
 * status：0 = 本地没令牌，-1 = 请求没发出去，≥400 = 服务端返回的错误码。
 */
export class FriendApiError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'FriendApiError'
    this.status = status
  }
  get isMembership(): boolean {
    return this.status === 0 || this.status === 401 || this.status === 403
  }
}

const OFFICIAL = DEFAULT_SYNC_BASE

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
    throw new FriendApiError('连不上服务器，请检查网络后重试', -1)
  }

  const data = (await r.json().catch(() => ({}))) as T & { detail?: string }
  if (!r.ok) {
    throw new FriendApiError(typeof data.detail === 'string' ? data.detail : '请求失败 ' + r.status, r.status)
  }
  return data
}

/** 服务端字段缺失时补空数组：漏一个就会在 render 里读 .length 崩掉 */
function normalize(raw: unknown): FriendsState {
  const r = (raw ?? {}) as Partial<FriendsState>
  return {
    me: r.me ?? null,
    friends: Array.isArray(r.friends) ? r.friends : [],
    pendingIn: Array.isArray(r.pendingIn) ? r.pendingIn : [],
    pendingOut: Array.isArray(r.pendingOut) ? r.pendingOut : [],
  }
}

export interface ChatMessage {
  id: number
  mine: boolean
  kind: 'text' | 'share'
  text: string
  shareCode: string
  shareName: string
  shareCount: number
  createdAt: number
  readAt: number
}

export function useFriendsApi() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  /** 明确判定为「没有会员身份」，只有这种情况才引导去开通 */
  const [denied, setDenied] = useState(false)

  async function run<T>(fn: () => Promise<T>): Promise<T | null> {
    setBusy(true)
    setError('')
    try {
      return await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : '请求失败')
      setDenied(e instanceof FriendApiError && e.isMembership)
      return null
    } finally {
      setBusy(false)
    }
  }

  return {
    busy, error, denied,
    /**
     * 两个请求独立结算。以前用 Promise.all：列表接口一失败（线上出现过
     * 500 —— 服务端好友档案并发写入撞唯一约束），身份也一起拿不到，
     * 界面就退化成「好友功能需要音乐会员」。
     */
    refresh: () => run(async () => {
      const [mineRes, listRes] = await Promise.allSettled([
        api<NonNullable<FriendsState['me']>>('GET', '/me'),
        api<unknown>('GET', ''),
      ])
      const mine = mineRes.status === 'fulfilled' ? mineRes.value : null
      const list = listRes.status === 'fulfilled' ? normalize(listRes.value) : normalize(null)

      const failures = [mineRes, listRes]
        .filter((x): x is PromiseRejectedResult => x.status === 'rejected')
        .map(x => x.reason)

      // 身份是整页的前提：拿不到身份就别假装「没有会员」，抛出去让页面给重试
      if (!mine) {
        throw (mineRes.status === 'rejected' ? mineRes.reason : new FriendApiError('好友身份加载失败', -1))
      }
      if (failures.length) {
        // 身份拿到了但列表没拿到：让上层继续用身份渲染，同时把错误显示出来
        setError(failures[0] instanceof Error ? failures[0].message : '好友列表加载失败')
        setDenied(false)
        return { mine, list }
      }
      setDenied(false)
      return { mine, list }
    }),
    addByCode: (code: string) => run(() => api('POST', '/requests', { friendCode: code.trim().toUpperCase() })),
    accept: (id: number) => run(() => api('POST', '/requests/' + id + '/accept')),
    decline: (id: number) => run(() => api('POST', '/requests/' + id + '/decline')),
    remove: (code: string) => run(() => api('DELETE', '/' + code)),
    rename: (nickname: string) => run(() => api('POST', '/nickname', { nickname })),

    /* ---------------- 聊天 ---------------- */
    /** 拉一段历史；after 传「我已有的最大 id」就是增量 */
    messages: (code: string, after = 0) =>
      run(() => api<{ messages: ChatMessage[] }>('GET', '/' + code + '/messages?after=' + after + '&limit=200')),
    sendText: (code: string, text: string) =>
      run(() => api('POST', '/' + code + '/messages', { text })),
    sendShare: (code: string, share: { shareCode: string; shareName: string; shareCount: number }) =>
      run(() => api('POST', '/' + code + '/messages', share)),
    unread: () => run(() => api<{ total: number; byCode: Record<string, number> }>('GET', '/chat/unread')),
  }
}
