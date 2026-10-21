/**
 * 自建同步服务器（PARITY 8.2 / 8.3）
 *
 * lx 可以把客户端本身变成一台同步服务器，给局域网里的其他设备用；
 * 这里做的是同一件事，但只依赖 `node:http`，不引任何第三方包。
 *
 * 协议就是我们的 SyncClient 已经在用的那三个端点：
 *   GET    /api/sync/data           → { ok, revision, updated_at, device, payload }
 *   POST   /api/sync/data           → 带 revision 提交；版本对不上返回 409 + 最新文档
 *   GET    /api/sync/devices        → 已认证设备列表（8.3）
 *   DELETE /api/sync/devices/{id}   → 撤销一台设备
 *   GET    /api/sync/ping           → 连通性探测
 *
 * 设计取舍：
 *   - **令牌即账号**：局域网自建场景没有注册流程，服务器只认一个访问令牌，
 *     所有设备用同一个令牌。令牌不对一律 401，不做「谁都能读」的开放服务。
 *   - **整份文档 + 版本号**：服务端不理解任何业务语义（不知道什么是收藏/歌单），
 *     只当一个带版本的 JSON 盒子 —— 客户端加字段不用升级服务端。
 *   - **落盘用原子写**：先写 `.tmp` 再 rename。断电时最坏是「丢了这一次」，
 *     不会留下一个半截的 JSON 让下次启动读不出来。
 */
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')

/** 单份文档上限：正常几千条收藏也就几百 KB，4MB 足够，也挡得住误传大文件 */
const MAX_BODY_BYTES = 4 * 1024 * 1024
const DATA_FILE = 'sync-data.json'

function nowIso() {
  return new Date().toISOString()
}

function emptyDoc() {
  return {
    revision: 0,
    updatedAt: nowIso(),
    device: '',
    payload: { settings: {}, favorites: [], playlists: [], history: [] },
    devices: {},
  }
}

/** 定长比较，避免按字符逐个比带来的时序差异 */
function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''))
  const y = Buffer.from(String(b ?? ''))
  if (x.length !== y.length) return false
  return crypto.timingSafeEqual(x, y)
}

function readDoc(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8')
    const d = JSON.parse(raw)
    if (!d || typeof d !== 'object') return emptyDoc()
    return {
      revision: Number(d.revision) || 0,
      updatedAt: String(d.updatedAt ?? nowIso()),
      device: String(d.device ?? ''),
      payload: d.payload && typeof d.payload === 'object' ? d.payload : emptyDoc().payload,
      devices: d.devices && typeof d.devices === 'object' ? d.devices : {},
    }
  } catch {
    return emptyDoc()
  }
}

function writeDoc(file, doc) {
  const tmp = file + '.tmp'
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(tmp, JSON.stringify(doc))
  fs.renameSync(tmp, file)
}

/** 本机的局域网地址，界面上要显示成「手机填这个」 */
function lanAddresses() {
  const out = []
  const ifaces = os.networkInterfaces()
  for (const name of Object.keys(ifaces)) {
    for (const a of ifaces[name] ?? []) {
      if (a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address })
    }
  }
  return out
}

/**
 * 启动服务器。
 *
 * @param {{ port?: number, token?: string, dir: string, name?: string }} opts
 * @returns {Promise<{ port: number, host: string, urls: string[], devices: number, stop: () => Promise<void> }>}
 */
async function start(opts) {
  // 注意别写成 `Number(opts.port) || 23331`：端口 0 是合法的
  // 「让系统分配一个空闲端口」，用 || 会把它变成 23331。
  const wanted = Number(opts.port)
  const port = Number.isFinite(wanted) && wanted >= 0 && wanted <= 65535 ? wanted : 23331
  const token = String(opts.token ?? '').trim()
  if (!token) throw new Error('自建同步服务器需要一个访问令牌')
  const file = path.join(opts.dir, DATA_FILE)
  const name = opts.name || 'Lyco Music 自建同步'

  let doc = readDoc(file)

  const json = (res, code, obj) => {
    const body = JSON.stringify(obj)
    res.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      // 客户端是 Electron / RN，本来不需要 CORS；留着是为了能直接用浏览器排查
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Device-Id, X-Device-Name',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Cache-Control': 'no-store',
    })
    res.end(body)
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const route = url.pathname.replace(/\/+$/, '')

    if (req.method === 'OPTIONS') {
      json(res, 204, {})
      return
    }

    if (route === '/api/sync/ping') {
      json(res, 200, { ok: true, name, revision: doc.revision })
      return
    }

    // ---- 认证：Bearer 令牌必须匹配 ----
    const auth = String(req.headers.authorization ?? '')
    const given = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
    if (!safeEqual(given, token)) {
      json(res, 401, { ok: false, error: '访问令牌不正确' })
      return
    }

    const deviceId = String(req.headers['x-device-id'] ?? '').trim()
    const deviceName = decodeURIComponent(String(req.headers['x-device-name'] ?? '')) || '未命名设备'

    // 被撤销的设备：连读都不给（否则「撤销」只是不能写，隐私上没意义）
    if (deviceId && doc.devices[deviceId]?.revoked) {
      json(res, 403, { ok: false, error: '这台设备已被撤销，请重新配对' })
      return
    }

    /** 每次请求都顺手登记设备：用户才能在列表里看到「它最后一次是什么时候来的」 */
    const touchDevice = (revision) => {
      if (!deviceId) return
      const prev = doc.devices[deviceId] ?? { id: deviceId, name: deviceName, lastSeenAt: '', revision: 0, revoked: false }
      doc.devices[deviceId] = {
        ...prev,
        name: deviceName || prev.name,
        lastSeenAt: nowIso(),
        revision: Math.max(prev.revision || 0, revision || 0),
      }
    }

    const sendDoc = (res, code) => {
      json(res, code, {
        ok: true,
        revision: doc.revision,
        updated_at: doc.updatedAt,
        device: doc.device,
        payload: doc.payload,
      })
    }

    if (route === '/api/sync/data') {
      if (req.method === 'GET') {
        touchDevice(doc.revision)
        sendDoc(res, 200)
        return
      }

      if (req.method === 'POST') {
        let size = 0
        const chunks = []
        req.on('data', c => {
          size += c.length
          if (size > MAX_BODY_BYTES) {
            json(res, 413, { ok: false, error: '同步内容超过 4MB 上限' })
            req.destroy()
            return
          }
          chunks.push(c)
        })
        req.on('end', () => {
          if (size > MAX_BODY_BYTES) return
          let body
          try {
            body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          } catch {
            json(res, 400, { ok: false, error: '请求体不是合法 JSON' })
            return
          }
          const baseRevision = Number(body?.revision)
          // 版本对不上 = 期间有别的设备写过。把最新文档带回去，客户端合并后重试。
          if (Number.isFinite(baseRevision) && baseRevision !== doc.revision) {
            touchDevice(doc.revision)
            sendDoc(res, 409)
            return
          }
          const payload = body?.payload
          if (!payload || typeof payload !== 'object') {
            json(res, 400, { ok: false, error: '缺少 payload' })
            return
          }
          doc = {
            ...doc,
            revision: doc.revision + 1,
            updatedAt: nowIso(),
            device: String(body?.device ?? deviceName),
            payload,
          }
          touchDevice(doc.revision)
          try {
            writeDoc(file, doc)
          } catch (e) {
            json(res, 500, { ok: false, error: '写入失败：' + (e instanceof Error ? e.message : String(e)) })
            return
          }
          sendDoc(res, 200)
        })
        return
      }

      json(res, 405, { ok: false, error: '方法不支持' })
      return
    }

    if (route === '/api/sync/devices') {
      if (req.method !== 'GET') {
        json(res, 405, { ok: false, error: '方法不支持' })
        return
      }
      const devices = Object.values(doc.devices)
        .map(d => ({
          id: d.id,
          name: d.name,
          lastSeenAt: d.lastSeenAt,
          revision: d.revision || 0,
          revoked: Boolean(d.revoked),
        }))
        .sort((a, b) => String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)))
      json(res, 200, { ok: true, devices })
      return
    }

    const m = /^\/api\/sync\/devices\/([^/]+)$/.exec(route)
    if (m && req.method === 'DELETE') {
      const id = decodeURIComponent(m[1])
      if (!doc.devices[id]) {
        json(res, 404, { ok: false, error: '没有这台设备' })
        return
      }
      doc.devices[id] = { ...doc.devices[id], revoked: true, lastSeenAt: nowIso() }
      try {
        writeDoc(file, doc)
      } catch (e) {
        json(res, 500, { ok: false, error: '写入失败：' + (e instanceof Error ? e.message : String(e)) })
        return
      }
      json(res, 200, { ok: true })
      return
    }

    json(res, 404, { ok: false, error: '未知接口' })
  })

  /** 记下所有连接：关闭时要优雅地断开，而不是直接 RST（见 stop 的注释） */
  const sockets = new Set()
  server.on('connection', s => {
    sockets.add(s)
    s.on('close', () => sockets.delete(s))
  })

  await new Promise((resolve, reject) => {
    const onError = (e) => {
      server.off('listening', onListening)
      reject(
        e && e.code === 'EADDRINUSE'
          ? new Error(`端口 ${port} 已被占用，换一个端口再试`)
          : e,
      )
    }
    const onListening = () => {
      server.off('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    // 监听 0.0.0.0：只监听 127.0.0.1 的话，同一局域网里的手机连不上，
    // 而「给局域网设备同步」正是这个功能的意义。
    server.listen(port, '0.0.0.0')
  })

  const actualPort = server.address().port
  const urls = lanAddresses().map(a => `http://${a.address}:${actualPort}`)

  return {
    port: actualPort,
    urls,
    devices: Object.keys(doc.devices).length,
    revision: doc.revision,
    /**
     * 停止服务。
     *
     * 关键在**优雅关闭**：对每条连接 `end()` 发 FIN，而不是 `destroy()` 直接 RST。
     * 客户端（Chromium / RN / undici）的连接池看到 FIN 才会把这条 socket 丢掉；
     * 被 RST 掉的 socket 它还留在池子里，下次同端口请求会撞上一条死连接
     * —— 表现就是「停掉再启动服务器后，第一次同步必失败」。
     * 500ms 后还没断干净的再强杀，避免 close 永远不回调。
     */
    stop: () =>
      new Promise(resolve => {
        server.close(() => resolve())
        for (const s of sockets) {
          try { s.end() } catch { /* 已经关了 */ }
        }
        const timer = setTimeout(() => {
          for (const s of sockets) {
            try { s.destroy() } catch { /* 已经关了 */ }
          }
        }, 500)
        if (typeof timer.unref === 'function') timer.unref()
      }),
  }
}

/* ---------------- 命令行入口：`node sync-server.cjs --port 23331 --token xxx` ---------------- */

if (require.main === module) {
  const arg = (name, fallback) => {
    const i = process.argv.indexOf('--' + name)
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
  }
  const port = Number(arg('port', 23331))
  const token = arg('token', process.env.LXMN_SYNC_TOKEN || '')
  const dir = arg('dir', path.join(process.cwd(), 'sync-data'))

  start({ port, token, dir })
    .then(s => {
      console.log(`[sync-server] 已启动，端口 ${s.port}`)
      for (const u of s.urls) console.log(`[sync-server]   ${u}`)
      console.log(`[sync-server] 数据目录 ${dir}`)
    })
    .catch(e => {
      console.error('[sync-server] 启动失败：', e instanceof Error ? e.message : e)
      process.exit(1)
    })
}

module.exports = { start, lanAddresses, DATA_FILE }
