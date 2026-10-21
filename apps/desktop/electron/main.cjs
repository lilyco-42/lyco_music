/**
 * Electron 主进程
 *
 * 只做外壳：加载 Vite 构建产物，保留 lx-music 上游的自定义音源能力
 * （渲染层可通过 preload 暴露的 API 读写本地文件 / 发起无 CORS 请求）。
 */
const {
  app, BrowserWindow, shell, ipcMain, net, safeStorage, screen, dialog,
  Tray, Menu, nativeImage, powerSaveBlocker,
} = require('electron')
const path = require('node:path')
const fs = require('node:fs/promises')
const { startLoginFlow } = require('./oauth.cjs')
const download = require('./download.cjs')
const local = require('./local.cjs')

const isDev = !app.isPackaged
/** 允许在开发时用环境变量指向 vite dev server */
const devUrl = process.env.LXMN_DEV_URL

let win = null

/* ---------- 崩溃取证 ---------- */

/**
 * 闪退以前完全不留痕迹：主进程没有 uncaughtException / unhandledRejection
 * 处理，Node 遇到未捕获异常会直接退出 —— Windows 事件日志里也查不到
 * （那不是原生崩溃，只是进程自己退了），用户只能说「它闪退了」。
 *
 * 现在把异常、渲染进程崩溃、子进程崩溃都落到 userData/crash.log，
 * 并且**不让异常带走进程**：音乐播放器崩掉一个请求不该整个退出。
 * 日志超过 256KB 就轮转一次，长期运行也不会无限涨。
 */
const CRASH_LOG_MAX = 256 * 1024

function crashLogPath() {
  try {
    return path.join(app.getPath('userData'), 'crash.log')
  } catch {
    return null
  }
}

function logCrash(kind, detail) {
  const file = crashLogPath()
  const text = detail == null ? '' : String(detail)
  try {
    console.error(`[${kind}] ${text}`)
  } catch { /* 没有控制台就算了 */ }
  if (!file) return
  try {
    const st = require('node:fs').statSync(file, { throwIfNoEntry: false })
    if (st && st.size > CRASH_LOG_MAX) require('node:fs').renameSync(file, file + '.1')
  } catch { /* 轮转失败不影响写入 */ }
  fs.appendFile(file, `[${new Date().toISOString()}] ${kind} ${text}\n`).catch(() => undefined)
}

process.on('uncaughtException', (err) => {
  logCrash('uncaughtException', err && err.stack ? err.stack : err)
})
process.on('unhandledRejection', (reason) => {
  logCrash('unhandledRejection', reason instanceof Error ? (reason.stack || reason.message) : reason)
})

/* ---------- 单实例 ---------- */

/**
 * 只允许一个实例，这是「VIP 莫名掉了」的真正原因。
 *
 * 用户双击两次（或者点了托盘/快捷方式但旧窗口没到前面）就会起两个进程，
 * 它们共用同一个 userData 目录。Chromium 的 Local Storage 是 leveldb，
 * 同一份数据只能被一个进程锁住 —— 后启动的那个**读不到任何 localStorage**：
 *   订阅缓存（lxmn.lxmn.subscription）读出来是 null
 *   → client.restore() 判定为 none
 *   → 会员页显示「尚未激活会员」
 * 而顶栏的 VIP 徽标来自 OAuth 凭证（safeStorage 加密文件，另一个进程也能读），
 * 照常显示。同一屏两个说法，用户看到的就是「我的 VIP 掉了」。
 *
 * 实测过一次：两个 MAIN 进程分别在 22:59 和 00:07 启动，缓存文件里明明
 * 有有效期到 2027 年的订阅文档，界面却写着尚未激活。
 */
const singleInstance = app.requestSingleInstanceLock()
if (!singleInstance) {
  // 立刻退出，别让 whenReady 抢在前面开出第二个窗口
  app.exit(0)
}

app.on('second-instance', () => {
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  /**
   * Windows 上只 show+focus 经常拉不到前台（焦点窃取保护）：
   * 用户双击图标后什么都没发生，就会以为「闪退了」。
   * 闪一下置顶再取消，是可靠度最高的做法。
   */
  win.setAlwaysOnTop(true)
  win.focus()
  setTimeout(() => { if (win && !win.isDestroyed()) win.setAlwaysOnTop(false) }, 300)
})

/**
 * 启动参数（6.7）。
 *
 * lx 的 `-hidden` 语义是「开机自启时不弹窗，直接蹲在托盘里」——
 * 它和「关闭窗口最小化到托盘」是一对：没有前者，开机自启每次都会
 * 抢走焦点，用户开电脑第一件事就是关掉它。
 */
const START_HIDDEN = process.argv.some(a => a === '-hidden' || a === '--hidden' || a === '--start-hidden')

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
    show: !START_HIDDEN,
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

  /**
   * 音频输出设备选择（2.5）需要两件事：
   *   1. `enumerateDevices()` 要能拿到设备**名字**，否则下拉框里全是
   *      「扬声器 (1)」这种占位符，用户根本分不清；
   *   2. `setSinkId()` 本身在 Chromium 里也走 speaker-selection 权限。
   * 其余权限一律拒绝 —— 这个应用不需要摄像头、麦克风、通知。
   */
  win.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'speaker-selection' || permission === 'media')
  })

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

  /**
   * 关闭 → 最小化到托盘（6.4）。
   *
   * 三个必须做对的细节：
   *   1. 只有用户开了这个开关才拦截，默认关 —— 否则「点 × 不退出」
   *      在用户眼里就是「关不掉」。
   *   2. 真的退出时（托盘菜单「退出」/ app.quit()）不能再拦，
   *      否则进程永远退不掉，任务管理器里会留一堆。
   *   3. 第一次拦截时给一次提示：用户不知道「去托盘里找」，
   *      会以为程序卡死了。
   */
  win.on('close', (e) => {
    if (!closeToTray || quitting) return
    e.preventDefault()
    win.hide()
    if (!closeHintShown) {
      closeHintShown = true
      if (tray) {
        try {
          tray.displayBalloon?.({
            title: 'Lyco Music 还在后台运行',
            content: '点托盘图标可以重新打开；要完全退出请用托盘菜单里的「退出」。',
          })
        } catch { /* Linux 不支持气泡提示 */ }
      }
    }
  })

  win.on('closed', () => { win = null })
}

/* ---------- 托盘（6.3 / 6.4） ---------- */

let tray = null
/** 关闭窗口时是否隐藏到托盘，由渲染层按用户设置同步过来 */
let closeToTray = false
/** 用户真的要退出（托盘菜单 / app.quit）：此时不能再拦 close */
let quitting = false
/** 只提示一次「还在后台运行」 */
let closeHintShown = false
/** 渲染层推来的播放状态，用来画托盘菜单与提示文字 */
let trayState = { playing: false, name: '', singer: '', favorite: false }

app.on('before-quit', () => { quitting = true })

/**
 * 托盘图标路径。
 *
 * 打包后 appPath 是 asar 根，`build/icon.png` 靠 electron-builder.yml 的
 * files 白名单带进去 —— 少写这一行，打包版托盘会是一个空白方块，
 * 而 dev 里一切正常。
 */
function trayIcon() {
  const file = path.join(app.getAppPath(), 'build', 'icon.png')
  const img = nativeImage.createFromPath(file)
  if (img.isEmpty()) return nativeImage.createEmpty()
  // Windows 托盘是 16×16，直接给 512 会被系统缩得很脏
  return img.resize({ width: 16, height: 16 })
}

function showMainWindow() {
  if (!win || win.isDestroyed()) {
    createWindow()
    return
  }
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function sendToRenderer(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

/** 托盘菜单：每换一首歌都要重画（菜单里显示当前曲目） */
function refreshTrayMenu() {
  if (!tray) return
  const { playing, name, singer, favorite } = trayState
  const title = name ? `${name}${singer ? ' - ' + singer : ''}` : '还没有播放'
  tray.setToolTip(name ? `Lyco Music · ${title}` : 'Lyco Music')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: title.length > 40 ? title.slice(0, 40) + '…' : title, enabled: false },
    { type: 'separator' },
    { label: playing ? '暂停' : '播放', click: () => sendToRenderer('lxmn:tray:command', 'toggle') },
    { label: '上一首', click: () => sendToRenderer('lxmn:tray:command', 'prev') },
    { label: '下一首', click: () => sendToRenderer('lxmn:tray:command', 'next') },
    {
      label: favorite ? '取消收藏' : '收藏',
      enabled: Boolean(name),
      click: () => sendToRenderer('lxmn:tray:command', 'favorite'),
    },
    { type: 'separator' },
    { label: '显示主界面', click: showMainWindow },
    {
      label: '桌面歌词',
      click: () => {
        showMainWindow()
        sendToRenderer('lxmn:tray:command', 'lyric')
      },
    },
    { type: 'separator' },
    {
      label: '退出 Lyco Music',
      click: () => { quitting = true; app.quit() },
    },
  ]))
}

function createTray() {
  if (tray) return
  const icon = trayIcon()
  // 空图标在部分 Linux 桌面上会让 Tray 构造抛错，兜一层免得整个应用起不来
  try {
    tray = new Tray(icon)
  } catch (e) {
    logCrash('tray-create', e && e.message ? e.message : String(e))
    return
  }
  tray.on('click', () => {
    // Windows/Linux：单击切换显示。macOS 单击习惯是弹菜单，这里保持一致交给系统
    if (process.platform === 'darwin') { tray.popUpContextMenu(); return }
    if (win && !win.isDestroyed() && win.isVisible() && !win.isMinimized()) win.hide()
    else showMainWindow()
  })
  tray.on('double-click', showMainWindow)
  refreshTrayMenu()
}

/* ---------- 任务栏进度（2.11） ---------- */

let lastTaskbarProgress = -1

ipcMain.handle('lxmn:taskbar:progress', (_e, value) => {
  if (!win || win.isDestroyed()) return false
  const v = Number(value)
  // -1 = 清掉进度条；0..1 = 正常进度；2 = 不确定态（缓冲中）
  const next = !Number.isFinite(v) ? -1 : v > 1 ? (v === 2 ? 2 : 1) : v < 0 ? -1 : v
  if (next === lastTaskbarProgress) return true
  lastTaskbarProgress = next
  try { win.setProgressBar(next) } catch { /* 平台不支持 */ }
  return true
})

/* ---------- 播放时阻止休眠（2.10） ---------- */

let sleepBlockerId = -1

ipcMain.handle('lxmn:power:keep-awake', (_e, on) => {
  const want = Boolean(on)
  if (want) {
    if (sleepBlockerId >= 0 && powerSaveBlocker.isStarted(sleepBlockerId)) return true
    // prevent-app-suspension：允许屏幕熄灭，但别让系统把进程挂起 ——
    // 音乐播放器要的就是这个，prevent-display-sleep 反而会阻止息屏。
    sleepBlockerId = powerSaveBlocker.start('prevent-app-suspension')
    return true
  }
  if (sleepBlockerId >= 0) {
    try { powerSaveBlocker.stop(sleepBlockerId) } catch { /* 已经停了 */ }
    sleepBlockerId = -1
  }
  return true
})

/* ---------- 窗口尺寸预设（7.5） ---------- */

ipcMain.handle('lxmn:win:set-size', (_e, size) => {
  if (!win || win.isDestroyed()) return null
  const area = screen.getDisplayMatching(win.getBounds()).workArea
  const reqW = Number(size && size.width)
  const reqH = Number(size && size.height)
  // width/height 传 0 表示「适配屏幕」：占工作区的 85%，留出任务栏和边距
  const wantW = reqW > 0 ? reqW : Math.round(area.width * 0.85)
  const wantH = reqH > 0 ? reqH : Math.round(area.height * 0.85)
  // 夹在「窗口最小尺寸」与「工作区」之间：全高清预设在小屏上会超出屏幕
  const width = Math.min(area.width, Math.max(1000, wantW))
  const height = Math.min(area.height, Math.max(670, wantH))
  if (win.isMaximized()) win.unmaximize()
  win.setBounds({
    x: area.x + Math.round((area.width - width) / 2),
    y: area.y + Math.round((area.height - height) / 2),
    width,
    height,
  })
  return win.getBounds()
})

/* ---------- 托盘 / 系统集成的 IPC ---------- */

ipcMain.handle('lxmn:tray:set-close-to-tray', (_e, on) => {
  closeToTray = Boolean(on)
  return closeToTray
})

ipcMain.handle('lxmn:tray:set-state', (_e, s) => {
  trayState = {
    playing: Boolean(s && s.playing),
    name: String((s && s.name) || ''),
    singer: String((s && s.singer) || ''),
    favorite: Boolean(s && s.favorite),
  }
  refreshTrayMenu()
  return true
})

ipcMain.handle('lxmn:tray:show', () => { showMainWindow(); return true })

/** 隐藏窗口（渲染层「最小化到托盘」按钮用） */
ipcMain.handle('lxmn:win:hide', () => { win?.hide(); return true })

// 自定义协议的特权必须在 app ready 之前声明，之后改无效 —— Electron 的硬性顺序。
// 本地音乐靠 lxmn-media:// 播放，见 local.cjs 里的说明。
local.registerScheme()

app.whenReady().then(() => {
  // 没抢到锁的进程已经 app.exit(0) 了，这里再兜一层，防止 exit 尚未生效时开窗
  if (!singleInstance) return

  /**
   * 渲染进程 / GPU 进程崩掉时主进程还活着，窗口会变成一片空白 ——
   * 用户同样会说「闪退」。记下来，并在渲染进程崩溃时自动重载一次，
   * 比让人对着一块白屏强。
   */
  app.on('render-process-gone', (_e, _wc, details) => {
    logCrash('render-process-gone', JSON.stringify(details))
    if (details.reason !== 'clean-exit' && win && !win.isDestroyed()) {
      setTimeout(() => { if (win && !win.isDestroyed()) win.reload() }, 500)
    }
  })
  app.on('child-process-gone', (_e, details) => {
    logCrash('child-process-gone', JSON.stringify(details))
  })

  local.installProtocol()

  createWindow()
  createTray()
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

/* ---------- 下载（真正的字节写入在这里） ---------- */

/**
 * 下载的事件不走 invoke 的返回值，而是单独推。
 *
 * 一个任务可能下几分钟，如果让 invoke 一直挂着，渲染层的 Promise
 * 会长期不 settle，而且窗口刷新就丢了回调。改成「invoke 只负责启动，
 * 进度用 send 推」—— 与 lx 的 worker 消息模型一致。
 */
ipcMain.handle('lxmn:download:start', async (e, request) => {
  const sender = e.sender
  void download.start(request, event => {
    if (sender.isDestroyed()) return
    try {
      sender.send('lxmn:download:event', { id: request?.id, ...event })
    } catch { /* 窗口正在关闭 */ }
  })
  return true
})

ipcMain.handle('lxmn:download:pause', async (_e, id) => { await download.pause(id); return true })
ipcMain.handle('lxmn:download:remove', async (_e, id) => { await download.remove(id); return true })
ipcMain.handle('lxmn:download:ensure-dir', async (_e, dir) => download.ensureDir(String(dir ?? '')))
ipcMain.handle('lxmn:download:default-dir', async () => download.defaultDir())
ipcMain.handle('lxmn:download:pick-dir', async () => download.pickDir(win))
ipcMain.handle('lxmn:download:open-dir', async (_e, dir) => { download.openDir(dir); return true })

// —— 本地音乐：探测网易云目录 / 扫目录 / 选目录 ——
ipcMain.handle('lxmn:local:detect', async () => local.detectDirs())
ipcMain.handle('lxmn:local:scan', async (_e, dir) => local.scan(String(dir ?? '')))
ipcMain.handle('lxmn:local:pick-dir', async () => local.pickDir(win))

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
