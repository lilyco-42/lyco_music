/**
 * Electron 主进程
 *
 * 只做外壳：加载 Vite 构建产物，保留 lx-music 上游的自定义音源能力
 * （渲染层可通过 preload 暴露的 API 读写本地文件 / 发起无 CORS 请求）。
 */
const { app, BrowserWindow, shell, ipcMain, net, safeStorage, screen, dialog } = require('electron')
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
/** 锁定状态只在内存里：窗口一关就复位（不写盘，见 get-style 注释） */
let lyricLocked = false
/**
 * 右键样式面板打开时窗口临时加高，关掉要还原。
 * 记下「加高之前」的高度，同时阻止 resized 事件把它当成用户改的尺寸写盘。
 */
let lyricBaseHeight = 0
/** 正在被用户拖动：这期间不把 moved 写盘 */
let lyricDragging = false

const lyricStatePath = () => path.join(app.getPath('userData'), 'lyric-window.json')

/**
 * 样式落盘前的兜底归一化。
 *
 * 真正的规则在 src/lib/lyric-style.ts（有单测）；这里是主进程侧的防线：
 * 渲染层一旦传进 NaN / 非法颜色，写进 style 的表现是「歌词凭空消失」，
 * 而界面上看不出任何异常，排查成本极高。所以宁可在这里再夹一次。
 */
const LYRIC_STYLE_KEYS = ['fontSize', 'playedColor', 'unplayedColor', 'fontFamily', 'stroke', 'lines']
const LYRIC_FONT_STACKS = new Set([
  '',
  '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif',
  'KaiTi, "Kaiti SC", STKaiti, "Noto Serif SC", serif',
  '"YouYuan", "Yuanti SC", "Microsoft YaHei", sans-serif',
  'ui-monospace, Consolas, "Cascadia Mono", monospace',
])
const HEX = /^#[0-9a-f]{6}$/i

function clampInt(v, min, max, fallback) {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

function normalizeLyricStyle(raw) {
  const s = raw || {}
  const color = (v, fb) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : fb)
  return {
    fontSize: clampInt(s.fontSize, 18, 72, 34),
    playedColor: color(s.playedColor ?? s.color, '#4ade80'),
    unplayedColor: color(s.unplayedColor ?? s.color, '#4ade80'),
    fontFamily: LYRIC_FONT_STACKS.has(s.fontFamily) ? s.fontFamily : '',
    stroke: clampInt(s.stroke, 0, 3, 1),
    lines: Number(s.lines) === 1 ? 1 : 2,
  }
}

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
    // 面板展开导致的高度变化不是用户意图，不能写进「下次打开的位置尺寸」
    if (lyricBaseHeight) return
    // 拖动过程中每一帧都会触发 moved，等松手再落盘一次就够了
    if (lyricDragging) return
    const b = lyricWin.getBounds()
    void saveLyricState({ x: b.x, y: b.y, width: b.width, height: b.height })
  }
  lyricWin.on('moved', persistBounds)
  lyricWin.on('resized', persistBounds)
  lyricWin.on('closed', () => { lyricWin = null; lyricLocked = false; stopLyricDrag(false) })

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

/**
 * 歌词窗口点时间条/歌词行要跳转。
 *
 * 歌词窗口是另一个渲染进程，碰不到主窗口的 player store，所以只能
 * 「歌词窗口 -> 主进程 -> 主窗口」绕一圈。主窗口收到后自己 seek，
 * 再由它把新的 currentTime 推回来，两边才不会各算一套。
 */
ipcMain.handle('lxmn:lyric:seek', async (_e, time) => {
  const t = Number(time)
  if (!Number.isFinite(t) || t < 0) return false
  if (win && !win.isDestroyed()) win.webContents.send('lxmn:lyric:seek-request', t)
  return true
})

/** 锁定：锁定后鼠标事件穿透到下面的窗口（lx-music 的「锁定歌词」语义） */
ipcMain.handle('lxmn:lyric:set-click-through', async (_e, through) => {
  if (!lyricWin || lyricWin.isDestroyed()) return false
  lyricLocked = Boolean(through)
  lyricWin.setIgnoreMouseEvents(lyricLocked, { forward: true })
  lyricWin.setFocusable(!lyricLocked)
  return true
})

/**
 * 锁定状态放在主进程内存里：锁定后歌词窗口收不到任何鼠标事件（穿透），
 * 它自己没法「记得自己锁了」，只能由主窗口问主进程。
 * 播放器底栏的「词」按钮靠这两个接口给用户留一条解锁的路。
 */
ipcMain.handle('lxmn:lyric:is-locked', async () => Boolean(lyricLocked && lyricWin && !lyricWin.isDestroyed()))

ipcMain.handle('lxmn:lyric:set-lock', async (_e, locked) => {
  if (!lyricWin || lyricWin.isDestroyed()) return false
  lyricLocked = Boolean(locked)
  lyricWin.setIgnoreMouseEvents(lyricLocked, { forward: true })
  lyricWin.setFocusable(!lyricLocked)
  return lyricLocked
})

/**
 * 拖动歌词窗口。
 *
 * 为什么不用 -webkit-app-region: drag：这个窗口是 transparent + focusable:false，
 * 拖动区一旦是 pointer-events:none（原来那 24px 的条子）就根本命中不到；
 * 而把整块设成 drag 又会让工具条/面板上的按钮点不动。
 *
 * 为什么坐标要主进程自己取：渲染层能拿到的只有 clientX/screenX，
 * 而窗口是「跟着鼠标动」的 —— 这两种坐标都会随着窗口移动而变，
 * 算出来的位移会自激（实测拖 150px，窗口跑了 754px）。
 * screen.getCursorScreenPoint() 是操作系统的真实光标位置，不受窗口影响。
 *
 * 顺带解决 DPI：缩放不是 100% 时 setPosition 会按比例重新取整，
 * 拖一次窗口就胖一点（实测拖 18 次从 907 涨到 1088），所以固定用 setBounds 带着原尺寸。
 */
let lyricDrag = null

function stopLyricDrag(persist = true) {
  if (!lyricDrag) return
  clearInterval(lyricDrag.timer)
  const drag = lyricDrag
  lyricDrag = null
  lyricDragging = false
  if (!persist || !lyricWin || lyricWin.isDestroyed()) return
  const b = lyricWin.getBounds()
  // 尺寸用拖动开始时的值：setBounds 在非 100% 缩放下会取整，每次 +1px 会越拖越胖
  void saveLyricState({ x: b.x, y: b.y, width: drag.width, height: drag.height })
}

ipcMain.handle('lxmn:lyric:drag-start', async () => {
  if (!lyricWin || lyricWin.isDestroyed()) return null
  stopLyricDrag(false)
  const b = lyricWin.getBounds()
  const start = screen.getCursorScreenPoint()
  lyricDragging = true
  lyricDrag = {
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    cursor: start,
    still: 0,
    timer: setInterval(() => {
      if (!lyricWin || lyricWin.isDestroyed()) { stopLyricDrag(false); return }
      const p = screen.getCursorScreenPoint()
      if (p.x === lyricDrag.cursor.x && p.y === lyricDrag.cursor.y) {
        // 鼠标松手事件万一丢了，光标长时间不动就别一直跟着（5 秒）
        // 不能太短：按住不动超过阈值的话，再拖就拖不动了
        if (++lyricDrag.still > 300) stopLyricDrag()
        return
      }
      lyricDrag.still = 0
      lyricWin.setBounds({
        x: lyricDrag.x + (p.x - lyricDrag.cursor.x),
        y: lyricDrag.y + (p.y - lyricDrag.cursor.y),
        width: lyricDrag.width,
        height: lyricDrag.height,
      })
    }, 16),
  }
  return b
})

ipcMain.handle('lxmn:lyric:drag-end', async () => {
  stopLyricDrag()
  return true
})

ipcMain.handle('lxmn:lyric:get-style', async () => {
  const s = await readLyricState()
  // 锁定状态不持久化：上次锁了、这次一打开就穿透，用户会以为窗口坏了
  return { ...normalizeLyricStyle(s), locked: false }
})

/**
 * 给右键面板腾地方：透明窗口里画不下就往外长。
 * 面板是渲染层的普通流内元素，所以这里只负责把窗口高度加上去，
 * 位置尽量不动（往下长），贴到屏幕底边时再往上顶。
 */
ipcMain.handle('lxmn:lyric:reserve', async (_e, extra) => {
  if (!lyricWin || lyricWin.isDestroyed()) return false
  const b = lyricWin.getBounds()
  if (!lyricBaseHeight) lyricBaseHeight = b.height
  const want = Math.max(0, Math.round(Number(extra) || 0))
  const height = lyricBaseHeight + want
  const area = screen.getDisplayMatching(b).workArea
  let y = b.y
  if (y + height > area.y + area.height) y = Math.max(area.y, area.y + area.height - height)
  lyricWin.setBounds({ x: b.x, y, width: b.width, height })
  return true
})

ipcMain.handle('lxmn:lyric:release', async () => {
  if (!lyricWin || lyricWin.isDestroyed()) { lyricBaseHeight = 0; return false }
  if (lyricBaseHeight) {
    const b = lyricWin.getBounds()
    lyricWin.setBounds({ x: b.x, y: b.y, width: b.width, height: lyricBaseHeight })
  }
  lyricBaseHeight = 0
  return true
})

ipcMain.handle('lxmn:lyric:set-style', async (_e, patch) => {
  const { locked: _ignored, ...rest } = patch ?? {}
  const cur = normalizeLyricStyle(await readLyricState())
  // 只接受白名单字段，并且落盘的是归一化之后的值 ——
  // 渲染层传个 NaN 进来会让歌词直接看不见，而界面上「看起来正常」
  const next = normalizeLyricStyle({ ...cur, ...rest }, cur)
  await saveLyricState(next)
  return next
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

/**
 * 保存文件：歌词导出（content）与音频下载（url）共用一条通道。
 *
 * 放在主进程而不是渲染层用 <a download>，是为了两件渲染层做不到的事：
 *   1. 弹系统「另存为」对话框 —— 用户能选目录、能改文件名，
 *      而跨域的 <a download> 在 file:// 页面里文件名会被服务器路径覆盖；
 *   2. 直接抓音频流 —— 渲染层抓 CDN 会被 CORS 拦，主进程的 net.fetch 不会。
 */
ipcMain.handle('lxmn:save-file', async (_e, payload) => {
  const { filename, content, url, dir } = payload || {}
  if (typeof filename !== 'string' || !filename) return { ok: false, error: '缺少文件名' }
  // 先校验再弹框：参数不对时弹出一个「另存为」再失败，用户只会觉得莫名其妙
  const hasContent = typeof content === 'string'
  const hasUrl = typeof url === 'string' && /^https?:\/\//i.test(url)
  if (!hasContent && !hasUrl) return { ok: false, error: '没有可保存的内容' }

  // 给了目录就直接存（第二次以后的下载不该再弹框，批量下十首歌弹十次是灾难）。
  // 目录由渲染层记住「用户上次选的目录」，所以不会写到他不知道的地方。
  let filePath = ''
  if (typeof dir === 'string' && dir) {
    try {
      await fs.mkdir(dir, { recursive: true })
      filePath = path.join(dir, path.basename(filename))
    } catch (e) {
      return { ok: false, error: '下载目录不可写：' + (e && e.message ? e.message : String(e)) }
    }
  } else {
    const picked = await dialog.showSaveDialog(win ?? undefined, { defaultPath: filename })
    if (picked.canceled || !picked.filePath) return { ok: false, canceled: true }
    filePath = picked.filePath
  }

  try {
    if (hasContent) {
      await fs.writeFile(filePath, content, 'utf8')
      return { ok: true, path: filePath, size: Buffer.byteLength(content, 'utf8') }
    }
    if (!hasUrl) return { ok: false, error: '没有可保存的内容' }
    const res = await net.fetch(url)
    if (!res.ok) return { ok: false, error: `下载失败（HTTP ${res.status}）` }
    const buf = Buffer.from(await res.arrayBuffer())
    // 空文件说明这条地址已经失效（酷狗/酷我的签名地址过期就是这个表现）
    if (!buf.length) return { ok: false, error: '下载到的文件是空的，地址可能已过期' }
    await fs.writeFile(filePath, buf)
    return { ok: true, path: filePath, size: buf.length }
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) }
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
