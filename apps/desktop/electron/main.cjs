/**
 * Electron 主进程
 *
 * 只做外壳：加载 Vite 构建产物，保留 lx-music 上游的自定义音源能力
 * （渲染层可通过 preload 暴露的 API 读写本地文件 / 发起无 CORS 请求）。
 */
const { app, BrowserWindow, shell, ipcMain, net, safeStorage } = require('electron')
const path = require('node:path')
const fs = require('node:fs/promises')
const { startLoginFlow } = require('./oauth.cjs')

const isDev = !app.isPackaged
/** 允许在开发时用环境变量指向 vite dev server */
const devUrl = process.env.LXMN_DEV_URL

let win = null

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1000,
    minHeight: 670,
    backgroundColor: '#F4F6FB',
    title: 'Lyco Music',
    // 无边框：界面自己画右上角的最小化/最大化/关闭。
    // 之前 frame 默认为 true，系统标题栏和页面里的自绘按钮会同时出现，
    // 视觉上就是「多了一套缩放按钮」。
    frame: false,
    // macOS 上仍保留红绿灯的位置语义；Windows/Linux 完全由页面控制
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' } : {}),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (isDev && devUrl) {
    win.loadURL(devUrl)
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  // 外链走系统浏览器，不在应用内打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  // 最大化状态变化时通知渲染层，让自绘的最大化/还原图标跟着换
  const pushMaximized = () => {
    if (win && !win.isDestroyed()) win.webContents.send('lxmn:win:maximized', win.isMaximized())
  }
  win.on('maximize', pushMaximized)
  win.on('unmaximize', pushMaximized)

  win.on('closed', () => { win = null })
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})


/* ---------- 桌面歌词窗口（仿 lx-music 的独立置顶歌词） ---------- */

/**
 * 为什么要独立窗口：在主界面里画浮层，最小化主窗口就看不见了，
 * 也没法拖到屏幕任意位置、不能置顶穿透。lx-music 的做法是开一个
 * 无边框透明窗口，主窗口只负责把歌词数据推给它。
 */
let lyricWin = null

const lyricStatePath = () => path.join(app.getPath('userData'), 'lyric-window.json')

async function readLyricState() {
  try { return JSON.parse(await fs.readFile(lyricStatePath(), 'utf8')) } catch { return {} }
}

async function saveLyricState(patch) {
  const cur = await readLyricState()
  await fs.writeFile(lyricStatePath(), JSON.stringify({ ...cur, ...patch }), 'utf8')
}

async function createLyricWindow() {
  if (lyricWin && !lyricWin.isDestroyed()) return lyricWin
  const saved = await readLyricState()
  lyricWin = new BrowserWindow({
    width: saved.width || 900,
    height: saved.height || 170,
    x: typeof saved.x === 'number' ? saved.x : undefined,
    y: typeof saved.y === 'number' ? saved.y : undefined,
    frame: false,
    transparent: true,
    resizable: true,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    // 不抢焦点：用户点歌词不该把主窗口的输入打断
    focusable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  // 永远压在最上层（含全屏应用之上）
  lyricWin.setAlwaysOnTop(true, 'screen-saver')
  lyricWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  if (isDev && devUrl) lyricWin.loadURL(devUrl + '#/lyric-window')
  else lyricWin.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { hash: '/lyric-window' })

  const persistBounds = () => {
    if (!lyricWin || lyricWin.isDestroyed()) return
    const b = lyricWin.getBounds()
    void saveLyricState({ x: b.x, y: b.y, width: b.width, height: b.height })
  }
  lyricWin.on('moved', persistBounds)
  lyricWin.on('resized', persistBounds)
  lyricWin.on('closed', () => { lyricWin = null })

  // 歌曲信息推给歌词窗口（主窗口 -> 主进程 -> 歌词窗口）
  return lyricWin
}

/** 把歌词数据广播给歌词窗口；没有窗口就忽略 */
function pushLyric(payload) {
  if (lyricWin && !lyricWin.isDestroyed()) lyricWin.webContents.send('lxmn:lyric:data', payload)
}

ipcMain.handle('lxmn:lyric:open', async (_e, initial) => {
  const w = await createLyricWindow()
  w.showInactive()
  if (initial) pushLyric(initial)
  return true
})

ipcMain.handle('lxmn:lyric:close', async () => {
  if (lyricWin && !lyricWin.isDestroyed()) lyricWin.close()
  return true
})

ipcMain.handle('lxmn:lyric:is-open', async () => Boolean(lyricWin && !lyricWin.isDestroyed()))

/** 主窗口每次播放状态变化时推过来 */
ipcMain.handle('lxmn:lyric:update', async (_e, payload) => {
  pushLyric(payload)
  return true
})

/** 锁定：锁定后鼠标事件穿透到下面的窗口（lx-music 的「锁定歌词」语义） */
ipcMain.handle('lxmn:lyric:set-click-through', async (_e, through) => {
  if (!lyricWin || lyricWin.isDestroyed()) return false
  lyricWin.setIgnoreMouseEvents(Boolean(through), { forward: true })
  lyricWin.setFocusable(!through)
  return true
})

ipcMain.handle('lxmn:lyric:get-style', async () => {
  const s = await readLyricState()
  // 锁定状态不持久化：上次锁了、这次一打开就穿透，用户会以为窗口坏了
  return { fontSize: s.fontSize ?? 34, color: s.color ?? '#4ade80', locked: false }
})

ipcMain.handle('lxmn:lyric:set-style', async (_e, patch) => {
  const { locked: _ignored, ...persisted } = patch ?? {}
  if (Object.keys(persisted).length) await saveLyricState(persisted)
  return true
})

/* ---------- 渲染层需要的原生能力 ---------- */

/**
 * 无 CORS 限制的请求：音乐源接口普遍不带 CORS 头，
 * 渲染层直接 fetch 会被浏览器拦；这里用主进程 net 代发。
 */
/** 只允许 http(s) 外链，避免 file:// 等本地协议被滥用 */
ipcMain.handle('lxmn:open-external', async (_e, url) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false
  await shell.openExternal(url)
  return true
})

ipcMain.handle('lxmn:request', async (_e, options) => {
  const res = await net.fetch(options.url, {
    method: options.method || 'GET',
    headers: options.headers || {},
    body: options.body,
  })
  const buf = Buffer.from(await res.arrayBuffer())
  return {
    statusCode: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    body: buf.toString('utf8'),
    raw: buf,
  }
})

/** 简易本地存储（用户数据目录下的 JSON），用于订阅链接等 */
const storePath = () => path.join(app.getPath('userData'), 'lxmn-store.json')

async function readStore() {
  try { return JSON.parse(await fs.readFile(storePath(), 'utf8')) } catch { return {} }
}

ipcMain.handle('lxmn:storage:get', async (_e, key) => (await readStore())[key] ?? null)
ipcMain.handle('lxmn:storage:set', async (_e, key, value) => {
  const s = await readStore()
  s[key] = value
  await fs.writeFile(storePath(), JSON.stringify(s), 'utf8')
})
ipcMain.handle('lxmn:storage:remove', async (_e, key) => {
  const s = await readStore()
  delete s[key]
  await fs.writeFile(storePath(), JSON.stringify(s), 'utf8')
})
ipcMain.handle('lxmn:storage:keys', async () => Object.keys(await readStore()))

/* ---------- 窗口控制（无边框模式下页面自绘按钮要用） ---------- */

ipcMain.handle('lxmn:win:minimize', () => { win?.minimize(); return true })
ipcMain.handle('lxmn:win:toggle-maximize', () => {
  if (!win) return false
  if (win.isMaximized()) win.unmaximize()
  else win.maximize()
  return win.isMaximized()
})
ipcMain.handle('lxmn:win:close', () => { win?.close(); return true })
ipcMain.handle('lxmn:win:is-maximized', () => win?.isMaximized() ?? false)

ipcMain.handle('lxmn:app:info', async () => ({
  version: app.getVersion(),
  platform: process.platform,
  arch: process.arch,
}))

// Login tokens are written only when Electron can encrypt them with the OS key store.
// Never downgrade to plaintext on Linux/headless hosts.
const billingAuthFile = () => path.join(app.getPath('userData'), 'billing-auth.enc')
ipcMain.handle('lxmn:auth:save', async (_e, token) => {
  if (typeof token !== 'string' || token.length < 20 || token.length > 8192 ||
      !/^[a-zA-Z0-9_.-]+$/.test(token)) throw new Error('Invalid account session')
  if (!safeStorage.isEncryptionAvailable()) return false
  await fs.writeFile(billingAuthFile(), safeStorage.encryptString(token), { mode: 0o600 })
  return true
})
ipcMain.handle('lxmn:auth:load', async () => {
  if (!safeStorage.isEncryptionAvailable()) return ''
  try {
    const value = safeStorage.decryptString(await fs.readFile(billingAuthFile()))
    return value.length <= 8192 ? value : ''
  } catch { return '' }
})
ipcMain.handle('lxmn:auth:clear', async () => {
  await fs.rm(billingAuthFile(), { force: true })
  return true
})


/* ---------- 网站 OAuth 授权登录 ---------- */

/**
 * 授权码 + PKCE（RFC 8252）。密码只输入在 lain42.top 的页面上，
 * 本进程拿到的是一张有期限、可撤销的令牌。
 * 具体流程在 oauth.cjs 里，那边可以脱离 GUI 单独测试。
 */
const OAUTH_BASE = 'https://lain42.top/studio/api'
const OAUTH_CLIENT = 'lyco-music-desktop'
const OAUTH_SCOPE = 'profile entitlements offline_access'

const oauthFile = () => path.join(app.getPath('userData'), 'oauth-session.enc')

ipcMain.handle('lxmn:oauth:login', async () => {
  return startLoginFlow({
    baseUrl: OAUTH_BASE,
    clientId: OAUTH_CLIENT,
    scope: OAUTH_SCOPE,
    openExternal: (url) => shell.openExternal(url),
    fetchImpl: (url, init) => net.fetch(url, init),
  })
})

ipcMain.handle('lxmn:oauth:save', async (_e, session) => {
  if (!session || typeof session.accessToken !== 'string' ||
      session.accessToken.length > 8192 || !/^[a-zA-Z0-9_.-]+$/.test(session.accessToken)) {
    throw new Error('Invalid session')
  }
  if (typeof session.refreshToken === 'string' && session.refreshToken &&
      !/^[a-zA-Z0-9_-]+$/.test(session.refreshToken)) {
    throw new Error('Invalid session')
  }
  if (!safeStorage.isEncryptionAvailable()) return false
  const payload = JSON.stringify({
    accessToken: session.accessToken,
    refreshToken: session.refreshToken || '',
    expiresAt: Number(session.expiresAt) || 0,
  })
  await fs.writeFile(oauthFile(), safeStorage.encryptString(payload), { mode: 0o600 })
  return true
})

ipcMain.handle('lxmn:oauth:load', async () => {
  if (!safeStorage.isEncryptionAvailable()) return null
  try {
    const raw = safeStorage.decryptString(await fs.readFile(oauthFile()))
    const parsed = JSON.parse(raw)
    return typeof parsed.accessToken === 'string' ? parsed : null
  } catch { return null }
})

ipcMain.handle('lxmn:oauth:clear', async () => {
  await fs.rm(oauthFile(), { force: true })
  return true
})
