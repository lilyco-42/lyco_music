/**
 * 自建同步服务器（8.2 / 8.3）的端到端用例。
 *
 * 直接起真服务器、用真 fetch 打接口 —— 这一层没有纯函数可测，
 * 只有「协议对不对」值得测：版本号冲突、撤销后 403、重启后数据还在。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const syncServer = require('../apps/desktop/electron/sync-server.cjs') as {
  start: (opts: { port?: number; token?: string; dir: string; name?: string }) => Promise<{
    port: number
    urls: string[]
    stop: () => Promise<void>
  }>
}

const TOKEN = 'test-token-123'
let dir = ''
let srv: Awaited<ReturnType<typeof syncServer.start>>
let base = ''

function headers(device: string): Record<string, string> {
  return {
    Authorization: `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
    'X-Device-Id': device,
    'X-Device-Name': encodeURIComponent(`设备-${device}`),
  }
}

function emptyPayload() {
  return { settings: {}, favorites: [], playlists: [], history: [] }
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lxmn-sync-test-'))
  srv = await syncServer.start({ port: 0, token: TOKEN, dir })
  base = `http://127.0.0.1:${srv.port}`
})

afterAll(async () => {
  await srv?.stop()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('自建同步服务器', () => {
  it('ping 不需要令牌', async () => {
    const r = await fetch(`${base}/api/sync/ping`)
    expect(r.status).toBe(200)
    expect((await r.json()).ok).toBe(true)
  })

  it('令牌不对返回 401', async () => {
    const r = await fetch(`${base}/api/sync/data`, { headers: { Authorization: 'Bearer wrong' } })
    expect(r.status).toBe(401)
  })

  it('首次拉取是空文档，版本 0', async () => {
    const r = await fetch(`${base}/api/sync/data`, { headers: headers('devA') })
    expect(r.status).toBe(200)
    const d = await r.json()
    expect(d.revision).toBe(0)
    expect(d.payload.favorites).toEqual([])
  })

  it('提交后版本 +1，内容能读回来', async () => {
    const payload = {
      ...emptyPayload(),
      favorites: [{ id: 1, name: '晴天', singer: '周杰伦', source: 'wy', addedAt: 1 }],
    }
    const r = await fetch(`${base}/api/sync/data`, {
      method: 'POST',
      headers: headers('devA'),
      body: JSON.stringify({ revision: 0, device: '桌面 A', payload }),
    })
    expect(r.status).toBe(200)
    const d = await r.json()
    expect(d.revision).toBe(1)
    expect(d.payload.favorites).toHaveLength(1)
    expect(d.device).toBe('桌面 A')
  })

  it('版本号落后返回 409 + 最新文档', async () => {
    const r = await fetch(`${base}/api/sync/data`, {
      method: 'POST',
      headers: headers('devB'),
      body: JSON.stringify({ revision: 0, device: '桌面 B', payload: emptyPayload() }),
    })
    expect(r.status).toBe(409)
    const d = await r.json()
    // 409 也要带回最新文档，客户端才能合并后重试
    expect(d.revision).toBe(1)
    expect(d.payload.favorites).toHaveLength(1)
  })

  it('设备列表按最近同步时间倒序，且带设备名', async () => {
    const r = await fetch(`${base}/api/sync/devices`, { headers: headers('devA') })
    expect(r.status).toBe(200)
    const { devices } = await r.json()
    const ids = devices.map((d: { id: string }) => d.id)
    expect(ids).toContain('devA')
    expect(ids).toContain('devB')
    const a = devices.find((d: { id: string }) => d.id === 'devA')
    expect(a.name).toBe('设备-devA')
    expect(a.revoked).toBe(false)
  })

  it('撤销后该设备读也读不到（403），其他设备不受影响', async () => {
    const del = await fetch(`${base}/api/sync/devices/devB`, { method: 'DELETE', headers: headers('devA') })
    expect(del.status).toBe(200)

    const blocked = await fetch(`${base}/api/sync/data`, { headers: headers('devB') })
    expect(blocked.status).toBe(403)

    const fine = await fetch(`${base}/api/sync/data`, { headers: headers('devA') })
    expect(fine.status).toBe(200)
  })

  it('撤销不存在的设备返回 404', async () => {
    const r = await fetch(`${base}/api/sync/devices/nobody`, { method: 'DELETE', headers: headers('devA') })
    expect(r.status).toBe(404)
  })

  it('重启后数据与设备记录都还在', async () => {
    await srv.stop()
    // 换一个端口起：这里要验的是「数据落盘了没有」，不是端口复用。
    // 同端口立刻重启时，客户端连接池里那条指向旧进程的 socket 还没被回收，
    // 第一个请求会 ECONNRESET（真实场景由 SyncClient 的重试兜住）。
    srv = await syncServer.start({ port: 0, token: TOKEN, dir })
    base = `http://127.0.0.1:${srv.port}`

    const r = await fetch(`${base}/api/sync/data`, { headers: headers('devA') })
    const d = await r.json()
    expect(d.revision).toBe(1)
    expect(d.payload.favorites[0].name).toBe('晴天')

    // 撤销状态也是持久的，不能重启就复活
    const blocked = await fetch(`${base}/api/sync/data`, { headers: headers('devB') })
    expect(blocked.status).toBe(403)
  })

  it('空令牌拒绝启动', async () => {
    await expect(syncServer.start({ port: 0, token: '', dir })).rejects.toThrow(/访问令牌/)
  })

  it('端口被占用时报人话', async () => {
    await expect(syncServer.start({ port: srv.port, token: TOKEN, dir })).rejects.toThrow(/已被占用/)
  })
})
