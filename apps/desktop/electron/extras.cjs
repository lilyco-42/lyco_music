/**
 * 系统集成的三块：HTTP 代理、Scheme URL、开放 API。
 *
 * 为什么单独一个文件：main.cjs 已经装了窗口、歌词窗口、下载、本地音乐、
 * OAuth、崩溃取证，再往里塞这三块会变成上千行的单文件。
 * 这里只依赖注入进来的 electron 对象和几个回调，不碰全局状态。
 *
 * 用法（main.cjs）：
 *   const extras = require('./extras.cjs')
 *   extras.install({ app, ipcMain, session, path, getWin, showMainWindow, sendToRenderer, logCrash })
 */
const http = require('node:http')
const path = require('node:path')

const URL_SCHEME = 'lxmusic'

/** 开放 API 暴露的端点（/test 里会回这份清单，方便调用方自查） */
const API_ENDPOINTS = [
  '/status', '/play', '/pause', '/skip-next', '/skip-prev', '/seek?time=30',
  '/volume?v=60', '/mute?mute=1', '/collect', '/uncollect', '/lyric',
  '/lyric-all', '/subscribe-player-status', '/test',
]

function install(ctx) {
  const { app, ipcMain, session, getWin, showMainWindow, sendToRenderer, logCrash } = ctx

  /* ---------------- HTTP 代理（6.8） ---------------- */

  /**
   * 代理走 session 级配置，而不是给每个请求手加 header。
   *
   * 这样渲染层的 fetch、主进程的 net.fetch、<audio> 的流媒体全都自动走代理，
   * 不会出现「接口通了、音频还是直连」的半吊子状态。
   * 账号密码不能拼进 proxyRules（那会把密码写进 URL），走 login 事件。
   */
  let proxyAuth = null

  app.on('login', (event, _wc, _details, authInfo, callback) => {
    if (!authInfo.isProxy || !proxyAuth) return
    event.preventDefault()
    callback(proxyAuth.username, proxyAuth.password)
  })

  ipcMain.handle('lxmn:proxy:apply', async (_e, cfg) => {
    const c = cfg || {}
    const win = getWin()
    const ses = win && !win.isDestroyed() ? win.webContents.session : session.defaultSession
    const host = String(c.host || '').trim()
    const port = Number(c.port) || 0
    if (!c.enabled || !host) {
      proxyAuth = null
      await ses.setProxy({ mode: 'direct' })
      return { mode: 'direct' }
    }
    const rules = port > 0 ? `http=${host}:${port};https=${host}:${port}` : `http=${host};https=${host}`
    // <local> 让 localhost / 内网地址绕过代理：本地音源和调试端口不该被代理
    await ses.setProxy({ proxyRules: rules, proxyBypassRules: '<local>' })
    proxyAuth = c.username ? { username: String(c.username), password: String(c.password || '') } : null
    return { mode: 'proxy', rules }
  })

  /* ---------------- Scheme URL（6.6） ---------------- */

  /**
   * 外部程序用 `lxmusic://…` 唤起播放器。
   *
   * Windows 上参数是随「第二个实例」的 argv 进来的，macOS 走 open-url ——
   * 两条路都要接，否则就是「Win 能用、Mac 不能用」。
   *
   * 支持的形态：
   *   lxmusic://player/{play|pause|skipNext|skipPrev|togglePlay|collect|uncollect|dislike}
   *   lxmusic://music/search?keyword=起风了
   *   lxmusic://music/searchPlay?keyword=起风了
   *   lxmusic://music/play?source=wy&songmid=123&name=..&singer=..
   *   lxmusic://music/{source}/{songmid}
   */
  function parseSchemeUrl(raw) {
    const text = String(raw || '').trim()
    if (!text.toLowerCase().startsWith(URL_SCHEME + '://')) return null
    let url
    try { url = new URL(text) } catch { return null }
    const kind = url.hostname.toLowerCase()
    const action = url.pathname.replace(/^\/+/, '').toLowerCase()
    const q = url.searchParams
    if (kind === 'player') return { kind, action }
    if (kind === 'music') {
      if (action === 'search') return { kind: 'search', keyword: q.get('keyword') || q.get('name') || '' }
      if (action === 'searchplay') return { kind: 'searchPlay', keyword: q.get('keyword') || q.get('name') || '' }
      if (action === 'play') {
        return {
          kind: 'play',
          item: {
            source: q.get('source') || 'wy',
            songmid: q.get('songmid') || q.get('id') || '',
            name: q.get('name') || '',
            singer: q.get('singer') || '',
          },
        }
      }
      const parts = url.pathname.split('/').filter(Boolean)
      if (parts.length >= 2) {
        return { kind: 'play', item: { source: parts[0], songmid: parts[1], name: '', singer: '' } }
      }
    }
    return null
  }

  function handleSchemeUrl(raw) {
    const parsed = parseSchemeUrl(raw)
    if (!parsed) return
    showMainWindow()
    // 窗口刚被唤起时渲染层可能还没挂监听，等一拍再发
    setTimeout(() => sendToRenderer('lxmn:scheme', parsed), 300)
  }

  function registerSchemeClient() {
    try {
      if (process.defaultApp && process.argv.length >= 2) {
        // 开发模式必须把入口脚本一起注册，否则唤起时 Electron 不知道跑哪个 app
        app.setAsDefaultProtocolClient(URL_SCHEME, process.execPath, [path.resolve(process.argv[1])])
      } else {
        app.setAsDefaultProtocolClient(URL_SCHEME)
      }
    } catch (e) {
      logCrash('scheme-register', e && e.message ? e.message : String(e))
    }
  }

  app.on('open-url', (event, url) => {
    event.preventDefault()
    handleSchemeUrl(url)
  })

  /* ---------------- 开放 API（6.5） ---------------- */

  /**
   * 本地 HTTP 控制接口（对标 lx 的 openApi）。
   *
   * 三个刻意的决定：
   *   1. **只监听 127.0.0.1**。这个接口能控制播放、能读歌词，绑 0.0.0.0
   *      等于把播放器交给同网段所有人。
   *   2. **命令转发给渲染层执行**。播放状态只有渲染层那一份，主进程自己
   *      存一份会立刻出现两个真相，状态接口就开始骗人。
   *   3. **每个命令 5 秒超时**。渲染层卡死时 HTTP 必须能返回，
   *      不能把调用方（OBS 脚本、直播工具）一起拖死。
   */
  let apiServer = null
  let apiSeq = 0
  const apiPending = new Map()
  let apiState = {}
  const apiStreams = new Set()

  function apiCommand(cmd, args) {
    return new Promise((resolve, reject) => {
      const win = getWin()
      if (!win || win.isDestroyed()) { reject(new Error('窗口未就绪')); return }
      const id = ++apiSeq
      const timer = setTimeout(() => {
        apiPending.delete(id)
        reject(new Error('命令超时'))
      }, 5000)
      apiPending.set(id, { resolve, reject, timer })
      try {
        win.webContents.send('lxmn:api:command', { id, cmd, args })
      } catch (e) {
        clearTimeout(timer)
        apiPending.delete(id)
        reject(e)
      }
    })
  }

  ipcMain.handle('lxmn:api:reply', (_e, id, result) => {
    const p = apiPending.get(Number(id))
    if (!p) return false
    clearTimeout(p.timer)
    apiPending.delete(Number(id))
    p.resolve(result)
    return true
  })

  ipcMain.handle('lxmn:api:state', (_e, state) => {
    apiState = state && typeof state === 'object' ? state : {}
    const payload = 'data: ' + JSON.stringify(apiState) + '\n\n'
    for (const res of apiStreams) {
      try { res.write(payload) } catch { apiStreams.delete(res) }
    }
    return true
  })

  function sendJson(res, code, body) {
    const text = JSON.stringify(body)
    res.writeHead(code, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(text),
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
    })
    res.end(text)
  }

  async function handleApiRequest(req, res) {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers': 'content-type',
      })
      res.end()
      return
    }

    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const pathname = url.pathname.replace(/\/+$/, '') || '/'
    const q = url.searchParams

    try {
      switch (pathname) {
        case '/':
        case '/test':
          sendJson(res, 200, { ok: true, name: 'Lyco Music', version: app.getVersion(), endpoints: API_ENDPOINTS })
          return
        case '/status':
          sendJson(res, 200, apiState)
          return
        case '/subscribe-player-status': {
          res.writeHead(200, {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-cache',
            connection: 'keep-alive',
            'access-control-allow-origin': '*',
          })
          res.write('data: ' + JSON.stringify(apiState) + '\n\n')
          apiStreams.add(res)
          req.on('close', () => apiStreams.delete(res))
          return
        }
        case '/play':
          sendJson(res, 200, await apiCommand('play'))
          return
        case '/pause':
          sendJson(res, 200, await apiCommand('pause'))
          return
        case '/skip-next':
          sendJson(res, 200, await apiCommand('next'))
          return
        case '/skip-prev':
          sendJson(res, 200, await apiCommand('prev'))
          return
        case '/seek':
          sendJson(res, 200, await apiCommand('seek', { time: Number(q.get('time') ?? q.get('t') ?? 0) }))
          return
        case '/volume':
          sendJson(res, 200, await apiCommand('volume', { value: Number(q.get('v') ?? q.get('volume') ?? 0) }))
          return
        case '/mute':
          sendJson(res, 200, await apiCommand('mute', { value: String(q.get('mute') ?? q.get('m') ?? '1') !== '0' }))
          return
        case '/collect':
          sendJson(res, 200, await apiCommand('collect', { value: true }))
          return
        case '/uncollect':
          sendJson(res, 200, await apiCommand('collect', { value: false }))
          return
        case '/lyric':
          sendJson(res, 200, await apiCommand('lyric'))
          return
        case '/lyric-all':
          sendJson(res, 200, await apiCommand('lyricAll'))
          return
        default:
          sendJson(res, 404, { error: 'unknown endpoint', path: pathname })
      }
    } catch (e) {
      sendJson(res, 500, { error: e && e.message ? e.message : String(e) })
    }
  }

  function stopApi() {
    if (!apiServer) return
    for (const res of apiStreams) { try { res.end() } catch { /* ignore */ } }
    apiStreams.clear()
    try { apiServer.close() } catch { /* ignore */ }
    apiServer = null
  }

  ipcMain.handle('lxmn:api:set-enabled', async (_e, cfg) => {
    const c = cfg || {}
    stopApi()
    if (!c.enabled) return { running: false }
    const port = Number(c.port) || 23330
    return await new Promise(resolve => {
      const server = http.createServer((req, res) => { void handleApiRequest(req, res) })
      server.on('error', err => {
        apiServer = null
        resolve({ running: false, error: err && err.message ? err.message : String(err) })
      })
      server.listen(port, '127.0.0.1', () => {
        apiServer = server
        resolve({ running: true, port })
      })
    })
  })

  return {
    registerSchemeClient,
    handleSchemeUrl,
    /** Windows 的 scheme 唤起走「第二个实例带参数启动」 */
    consumeArgv(argv) {
      const link = (argv || []).find(a => typeof a === 'string' && a.toLowerCase().startsWith(URL_SCHEME + '://'))
      if (link) handleSchemeUrl(link)
    },
    URL_SCHEME,
  }
}

module.exports = { install, URL_SCHEME, API_ENDPOINTS }
