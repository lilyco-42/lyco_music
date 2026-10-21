/**
 * 临时截图脚本：用 Electron 打开 dev server 的某个路由，截图到文件。
 *
 * 用来肉眼验证界面（例如「试听列表」tab 是否真的渲染出来）。
 * 不依赖 agent-browser / playwright —— Electron 本身就是 Chromium。
 *
 * 用法（必须清掉 ELECTRON_RUN_AS_NODE，否则会当成纯 Node 跑）：
 *   env -u ELECTRON_RUN_AS_NODE electron.exe scripts/shot.cjs
 *
 * 环境变量：
 *   SHOT_URL    要打开的地址
 *   SHOT_OUT    截图输出路径
 *   SHOT_SEED   （可选）写进 localStorage['lxmn.library'] 的 JSON，写完会 reload
 *   SHOT_WAIT   （可选）reload 后等待毫秒数，默认 1800
 */
const { app, BrowserWindow } = require('electron')
const local = require('../electron/local.cjs')
const fs = require('node:fs')
const path = require('node:path')

const URL = process.env.SHOT_URL
const OUT = process.env.SHOT_OUT || path.join(__dirname, 'shot.png')
const SEED = process.env.SHOT_SEED || ''
/**
 * 种子的 localStorage key。
 *
 * 注意是 `lxmn.lxmn.library` 而不是 `lxmn.library` —— 内核的 LIBRARY_KEY
 * 已经是 `lxmn.library`，桌面端的 createWebStorage 又加了一层 `lxmn.` 前缀。
 * 两层叠加，看着多余但读写一致，不影响功能。
 */
const SEED_KEY = process.env.SHOT_SEED_KEY || 'lxmn.lxmn.library'
const WAIT = Number(process.env.SHOT_WAIT || 1800)

app.disableHardwareAcceleration()

// SHOT_MEDIA=1 时把本地音乐协议也装上，这样截图脚本也能验证
// <audio src="lxmn-media://..."> 真的能出元数据（时长 > 0）。
if (process.env.SHOT_MEDIA) local.registerScheme()

app.whenReady().then(async () => {
  if (process.env.SHOT_MEDIA) local.installProtocol()
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    show: false,
    paintWhenInitiallyHidden: true,
    webPreferences: process.env.SHOT_PRELOAD
      // 桩 preload 要读文件，必须关掉 sandbox（默认是开的）
      ? { preload: path.resolve(process.env.SHOT_PRELOAD), sandbox: false, contextIsolation: false }
      : { contextIsolation: true },
  })
  try {
    await win.loadURL(URL)
    if (SEED) {
      await win.webContents.executeJavaScript(
        `localStorage.setItem(${JSON.stringify(SEED_KEY)}, ${JSON.stringify(SEED)}); true`,
      )
      await win.webContents.reload()
    }
    await new Promise(r => setTimeout(r, WAIT))
    // SHOT_JS：截图前跑一段 JS（用来点按钮、验证交互）
    if (process.env.SHOT_JS) {
      const r = await win.webContents.executeJavaScript(process.env.SHOT_JS)
      fs.writeFileSync(OUT + '.js.txt', JSON.stringify(r, null, 2))
      await new Promise(r => setTimeout(r, 600))
    }
    const img = await win.webContents.capturePage()
    fs.writeFileSync(OUT, img.toPNG())
    // 顺便把页面上的关键文本打出来，方便判断渲染有没有报错
    const text = await win.webContents.executeJavaScript(
      `document.body.innerText.slice(0, 1200)`,
    )
    fs.writeFileSync(OUT + '.txt', String(text))
    app.exit(0)
  } catch (e) {
    fs.writeFileSync(OUT + '.err.txt', String(e && e.stack ? e.stack : e))
    app.exit(1)
  }
})
