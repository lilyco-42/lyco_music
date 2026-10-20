/**
 * 云同步客户端
 *
 * 默认服务器 https://lain42.top/studio —— 用户什么都不用填，
 * 填了订阅链接就自动带上同一个令牌做同步（会员身份即同步身份，
 * 不额外注册账号）。也允许填自建地址，那时用独立的同步令牌。
 *
 * 冲突用「版本号 + 合并」处理而不是「最后写入者胜出」：
 * 后者会让两台设备来回覆盖对方，用户会看到收藏莫名其妙地消失。
 * 这里永远先拉远端、本地合并、再带版本号提交；服务端发现版本号落后
 * 就返回 409 带上最新文档，客户端合并后重试一次。
 */
import { getPlatform } from '../registry'
import { parseLooseHttpUrl } from '../util/url'
import { emptyPayload, type SyncClientOptions, type SyncDocument, type SyncOutcome, type SyncPayload } from './types'
import { mergePayload, payloadSize } from './merge'

/**
 * 服务端根地址。
 *
 * 必须带 /studio 前缀：pingap 只把 https://lain42.top/studio/api/* 反代到
 * billing 服务；裸域名的 /api/* 会命中前端 SPA 并返回 HTML。
 */
export const DEFAULT_SYNC_BASE = 'https://lain42.top/studio'

const DEFAULT_KEY = 'lxmn.sync'
/** 超过这个大小就拒绝提交，避免把服务端撑爆（正常几百条收藏也就几十 KB） */
const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024

interface CachedState {
  /** 同步令牌（会员订阅令牌或自建令牌） */
  token: string
  baseUrl: string
  revision: number
  /** 上次同步时间，毫秒 */
  syncedAt: number
  payload: SyncPayload
}

function normalizeBase(input: string | undefined): string {
  const raw = (input ?? DEFAULT_SYNC_BASE).trim()
  if (!raw) return DEFAULT_SYNC_BASE
  // 允许用户只填域名。
  // 用自带的 parseLooseHttpUrl 而不是 new URL()：Hermes 的 URL polyfill
  // 没有实现 protocol getter，访问即抛错，会把整个模块带崩（见 util/url.ts）。
  const url = parseLooseHttpUrl(raw)
  if (!url) return DEFAULT_SYNC_BASE
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error('[lxmn/sync] 同步服务器必须使用 https')
  }
  // 去掉尾部斜杠；已经带了 /studio 就不重复加
  let base = url.origin + url.pathname.replace(/\/+$/, '')
  if (!/\/studio$/.test(base) && /(^|\.)lain42\.top$/.test(url.hostname)) {
    base = url.origin + '/studio'
  }
  return base
}

/** 把服务端返回的 JSON 收成 SyncDocument；形状不对就抛错而不是静默接受 */
export function parseSyncDocument(input: unknown): SyncDocument {
  if (!input || typeof input !== 'object') {
    throw new Error('[lxmn/sync] 同步内容不是合法的 JSON 对象')
  }
  const d = input as Record<string, unknown>
  if (d.ok !== true) {
    throw new Error(`[lxmn/sync] 同步失败：${String(d.error ?? d.message ?? '服务端拒绝了请求')}`)
  }
  const raw = d.payload
  if (!raw || typeof raw !== 'object') {
    throw new Error('[lxmn/sync] 同步内容缺少 payload')
  }
  const p = raw as Record<string, unknown>
  const payload: SyncPayload = {
    settings: (p.settings && typeof p.settings === 'object' ? p.settings : {}) as SyncPayload['settings'],
    favorites: Array.isArray(p.favorites) ? (p.favorites as SyncPayload['favorites']) : [],
    playlists: Array.isArray(p.playlists) ? (p.playlists as SyncPayload['playlists']) : [],
    history: Array.isArray(p.history) ? (p.history as SyncPayload['history']) : [],
  }
  return {
    payload,
    revision: Number(d.revision) || 0,
    updatedAt: String(d.updated_at ?? d.updatedAt ?? ''),
    device: d.device ? String(d.device) : undefined,
  }
}

export class SyncClient {
  private readonly baseUrl: string
  private readonly storageKey: string
  private readonly deviceName: string
  private cache: CachedState | null = null

  constructor(options: SyncClientOptions = {}) {
    this.baseUrl = normalizeBase(options.baseUrl)
    this.storageKey = options.storageKey ?? DEFAULT_KEY
    this.deviceName = options.deviceName ?? 'LX Music'
  }

  get server(): string {
    return this.baseUrl
  }

  /** 是否已经配置过同步（有令牌 + 有本地缓存） */
  async configured(): Promise<boolean> {
    if (this.cache) return true
    return (await this.restore()).configured
  }

  /** 从本地缓存恢复，离线也能拿到上次同步的数据 */
  async restore(): Promise<{ configured: boolean; payload: SyncPayload; revision: number; syncedAt: number }> {
    if (this.cache) {
      return {
        configured: true,
        payload: this.cache.payload,
        revision: this.cache.revision,
        syncedAt: this.cache.syncedAt,
      }
    }
    try {
      const raw = await getPlatform().storage.get(this.storageKey)
      if (!raw) return { configured: false, payload: emptyPayload(), revision: 0, syncedAt: 0 }
      const parsed = JSON.parse(raw) as CachedState
      if (!parsed?.token) return { configured: false, payload: emptyPayload(), revision: 0, syncedAt: 0 }
      this.cache = {
        token: String(parsed.token),
        baseUrl: normalizeBase(parsed.baseUrl),
        revision: Number(parsed.revision) || 0,
        syncedAt: Number(parsed.syncedAt) || 0,
        payload: {
          settings: parsed.payload?.settings ?? {},
          favorites: parsed.payload?.favorites ?? [],
          playlists: parsed.payload?.playlists ?? [],
          history: parsed.payload?.history ?? [],
        },
      }
      return {
        configured: true,
        payload: this.cache.payload,
        revision: this.cache.revision,
        syncedAt: this.cache.syncedAt,
      }
    } catch {
      return { configured: false, payload: emptyPayload(), revision: 0, syncedAt: 0 }
    }
  }

  private async persist(): Promise<void> {
    if (!this.cache) return
    try {
      await getPlatform().storage.set(this.storageKey, JSON.stringify(this.cache))
    } catch {
      // 缓存失败不影响主流程
    }
  }

  /** 配置（或更换）同步令牌。传空字符串表示关闭同步。 */
  async configure(token: string, baseUrl?: string): Promise<void> {
    const t = token.trim()
    if (!t) {
      await this.clear()
      return
    }
    this.cache = {
      token: t,
      baseUrl: normalizeBase(baseUrl ?? this.baseUrl),
      revision: 0,
      syncedAt: 0,
      payload: this.cache?.payload ?? emptyPayload(),
    }
    await this.persist()
  }

  /** 关闭同步并清除本地缓存 */
  async clear(): Promise<void> {
    this.cache = null
    try {
      await getPlatform().storage.remove(this.storageKey)
    } catch {
      // ignore
    }
  }

  /** 当前令牌（供界面展示掩码） */
  async token(): Promise<string> {
    if (!this.cache) await this.restore()
    return this.cache?.token ?? ''
  }

  private async call(
    method: 'GET' | 'POST',
    body?: unknown,
    baseUrlOverride?: string,
  ): Promise<{ statusCode: number; json: unknown }> {
    if (!this.cache) await this.restore()
    const state = this.cache
    if (!state?.token) throw new Error('[lxmn/sync] 尚未配置同步令牌')
    const base = normalizeBase(baseUrlOverride ?? state.baseUrl)
    const { http } = getPlatform()
    const res = await http.request({
      url: `${base}/api/sync/data`,
      method,
      headers: {
        Authorization: `Bearer ${state.token}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      timeout: 20000,
    })
    let json: unknown = null
    try {
      json = JSON.parse(res.body)
    } catch {
      json = null
    }
    return { statusCode: res.statusCode, json }
  }

  /**
   * 同步一次。
   *
   * 流程固定为「先拉后推」：
   *   1. GET 远端文档
   *   2. 本地与远端合并
   *   3. 若合并结果与远端不同，带 revision 提交
   *   4. 409 说明期间有别的设备写过 → 用返回的最新文档再合并、再提交一次
   *
   * 只重试一次是刻意的：连续冲突说明有设备在疯狂刷，再多试只会加剧，
   * 让用户看到「稍后再试」比无限循环好。
   */
  async sync(local: SyncPayload): Promise<SyncOutcome> {
    if (!this.cache) {
      const r = await this.restore()
      if (!r.configured) return { state: 'disabled', reason: '尚未配置同步令牌' }
    }
    if (payloadSize(local) > MAX_PAYLOAD_BYTES) {
      return { state: 'error', reason: '本地数据过大，已跳过同步' }
    }

    try {
      const pulled = await this.call('GET')
      if (pulled.statusCode === 401 || pulled.statusCode === 403) {
        return { state: 'error', reason: '同步令牌无效或会员已过期' }
      }
      if (pulled.statusCode !== 200) {
        return { state: 'error', reason: `同步服务器返回 HTTP ${pulled.statusCode}` }
      }

      const remote = parseSyncDocument(pulled.json)
      let merged = mergePayload(local, remote.payload)

      // 合并结果与远端一致 → 没什么可推的，直接采用远端
      if (JSON.stringify(merged) === JSON.stringify(remote.payload)) {
        this.cache = { ...(this.cache as CachedState), revision: remote.revision, syncedAt: Date.now(), payload: merged }
        await this.persist()
        return { state: 'ok', document: { ...remote, payload: merged }, pushed: false }
      }

      let pushed = await this.call('POST', { revision: remote.revision, payload: merged, device: this.deviceName })

      // 版本号落后：别的设备刚写过。用服务端返回的最新文档再合并一次。
      if (pushed.statusCode === 409) {
        const latest = parseSyncDocument(pushed.json)
        merged = mergePayload(merged, latest.payload)
        pushed = await this.call('POST', { revision: latest.revision, payload: merged, device: this.deviceName })
        if (pushed.statusCode === 409) {
          return { state: 'conflict', document: latest, merged }
        }
      }

      if (pushed.statusCode === 401 || pushed.statusCode === 403) {
        return { state: 'error', reason: '同步令牌无效或会员已过期' }
      }
      if (pushed.statusCode !== 200) {
        return { state: 'error', reason: `同步写入失败（HTTP ${pushed.statusCode}）` }
      }

      const saved = parseSyncDocument(pushed.json)
      this.cache = { ...(this.cache as CachedState), revision: saved.revision, syncedAt: Date.now(), payload: saved.payload }
      await this.persist()
      return { state: 'ok', document: saved, pushed: true }
    } catch (e) {
      return { state: 'error', reason: e instanceof Error ? e.message : String(e) }
    }
  }
}

export { normalizeBase }
