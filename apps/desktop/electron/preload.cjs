/**
 * 预加载脚本：把受控的原生能力暴露给渲染层。
 * 渲染层据此组装平台适配器（http 走主进程以绕过 CORS，存储走 localStorage）。
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('lxmnNative', {
  request: (options) => ipcRenderer.invoke('lxmn:request', options),
  /** 弹系统另存为对话框并写文件：歌词导出（content）/ 音频下载（url） */
  saveFile: (payload) => ipcRenderer.invoke('lxmn:save-file', payload),
  storage: {
    get: (k) => ipcRenderer.invoke('lxmn:storage:get', k),
    set: (k, v) => ipcRenderer.invoke('lxmn:storage:set', k, v),
    remove: (k) => ipcRenderer.invoke('lxmn:storage:remove', k),
    keys: () => ipcRenderer.invoke('lxmn:storage:keys'),
  },
  appInfo: () => ipcRenderer.invoke('lxmn:app:info'),
  /** 无边框窗口的自绘控制按钮 */
  win: {
    minimize: () => ipcRenderer.invoke('lxmn:win:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('lxmn:win:toggle-maximize'),
    close: () => ipcRenderer.invoke('lxmn:win:close'),
    isMaximized: () => ipcRenderer.invoke('lxmn:win:is-maximized'),
    /** 窗口尺寸预设（PARITY 7.5）：{width,height} 传 0 表示适配屏幕 */
    setSize: (size) => ipcRenderer.invoke('lxmn:win:set-size', size),
    /** 隐藏到托盘 */
    hide: () => ipcRenderer.invoke('lxmn:win:hide'),
    /** 最大化状态变化（双击标题栏等）时同步图标 */
    onMaximizeChange: (cb) => {
      const handler = (_e, value) => { try { cb(Boolean(value)) } catch { /* ignore */ } }
      ipcRenderer.on('lxmn:win:maximized', handler)
      return () => ipcRenderer.removeListener('lxmn:win:maximized', handler)
    },
  },
  /** 托盘：关闭行为 + 菜单状态 + 菜单命令回传 */
  tray: {
    setCloseToTray: (on) => ipcRenderer.invoke('lxmn:tray:set-close-to-tray', on),
    setState: (s) => ipcRenderer.invoke('lxmn:tray:set-state', s),
    show: () => ipcRenderer.invoke('lxmn:tray:show'),
    onCommand: (cb) => {
      const handler = (_e, cmd) => { try { cb(String(cmd)) } catch { /* ignore */ } }
      ipcRenderer.on('lxmn:tray:command', handler)
      return () => ipcRenderer.removeListener('lxmn:tray:command', handler)
    },
  },
  /** 任务栏进度（PARITY 2.11）：0..1，-1 清除，2 表示不确定态 */
  taskbar: {
    setProgress: (v) => ipcRenderer.invoke('lxmn:taskbar:progress', v),
  },
  /** 播放时阻止系统休眠（PARITY 2.10） */
  power: {
    keepAwake: (on) => ipcRenderer.invoke('lxmn:power:keep-awake', on),
  },
  auth: {
    save: (token) => ipcRenderer.invoke('lxmn:auth:save', token),
    load: () => ipcRenderer.invoke('lxmn:auth:load'),
    clear: () => ipcRenderer.invoke('lxmn:auth:clear'),
  },
  /** 网站 OAuth 授权登录：主进程负责 PKCE、loopback 回调与令牌加密 */
  oauth: {
    login: () => ipcRenderer.invoke('lxmn:oauth:login'),
    save: (session) => ipcRenderer.invoke('lxmn:oauth:save', session),
    load: () => ipcRenderer.invoke('lxmn:oauth:load'),
    clear: () => ipcRenderer.invoke('lxmn:oauth:clear'),
  },
  /** 桌面歌词（独立置顶窗口，仿 lx-music） */
  lyric: {
    open: (initial) => ipcRenderer.invoke('lxmn:lyric:open', initial),
    close: () => ipcRenderer.invoke('lxmn:lyric:close'),
    isOpen: () => ipcRenderer.invoke('lxmn:lyric:is-open'),
    update: (payload) => ipcRenderer.invoke('lxmn:lyric:update', payload),
    setClickThrough: (through) => ipcRenderer.invoke('lxmn:lyric:set-click-through', through),
    /** 锁定状态由主进程持有：锁定后窗口穿透，自己收不到事件，只能被问 */
    isLocked: () => ipcRenderer.invoke('lxmn:lyric:is-locked'),
    setLock: (locked) => ipcRenderer.invoke('lxmn:lyric:set-lock', locked),
    getStyle: () => ipcRenderer.invoke('lxmn:lyric:get-style'),
    setStyle: (patch) => ipcRenderer.invoke('lxmn:lyric:set-style', patch),
    /** 窗口被拖到屏幕外/换显示器后找不回来时的救援（PARITY 3.23） */
    resetWindow: () => ipcRenderer.invoke('lxmn:lyric:reset-window'),
    /** 右键面板展开时给窗口腾地方（透明窗口里画不下就往外长） */
    reserve: (extra) => ipcRenderer.invoke('lxmn:lyric:reserve', extra),
    release: () => ipcRenderer.invoke('lxmn:lyric:release'),
    /** 拖动窗口：渲染层只发「按下/松手」，坐标由主进程读系统光标 */
    dragStart: () => ipcRenderer.invoke('lxmn:lyric:drag-start'),
    dragEnd: () => ipcRenderer.invoke('lxmn:lyric:drag-end'),
    /** 歌词窗口点时间条/歌词行：请求主窗口跳转 */
    seek: (time) => ipcRenderer.invoke('lxmn:lyric:seek', time),
    /** 主窗口订阅「歌词窗口要求跳转」 */
    onSeekRequest: (cb) => {
      const handler = (_e, time) => { try { cb(Number(time) || 0) } catch { /* ignore */ } }
      ipcRenderer.on('lxmn:lyric:seek-request', handler)
      return () => ipcRenderer.removeListener('lxmn:lyric:seek-request', handler)
    },
    /** 歌词窗口订阅数据 */
    onData: (cb) => {
      const handler = (_e, payload) => { try { cb(payload) } catch { /* ignore */ } }
      ipcRenderer.on('lxmn:lyric:data', handler)
      return () => ipcRenderer.removeListener('lxmn:lyric:data', handler)
    },
  },
  /** 用系统浏览器打开外部链接（购买页等） */
  openExternal: (url) => ipcRenderer.invoke('lxmn:open-external', url),
  /**
   * 下载：内核只管调度，真正的落盘在主进程。
   *
   * start 只负责启动（立即返回），进度通过 onEvent 推 ——
   * 一个任务可能下几分钟，invoke 挂那么久会让 Promise 长期不 settle。
   */
  download: {
    start: (request) => ipcRenderer.invoke('lxmn:download:start', request),
    pause: (id) => ipcRenderer.invoke('lxmn:download:pause', id),
    remove: (id) => ipcRenderer.invoke('lxmn:download:remove', id),
    ensureDir: (dir) => ipcRenderer.invoke('lxmn:download:ensure-dir', dir),
    defaultDir: () => ipcRenderer.invoke('lxmn:download:default-dir'),
    pickDir: () => ipcRenderer.invoke('lxmn:download:pick-dir'),
    openDir: (dir) => ipcRenderer.invoke('lxmn:download:open-dir', dir),
    onEvent: (cb) => {
      const handler = (_e, payload) => { try { cb(payload) } catch { /* ignore */ } }
      ipcRenderer.on('lxmn:download:event', handler)
      return () => ipcRenderer.removeListener('lxmn:download:event', handler)
    },
  },
  // 本地音乐：探测网易云目录、扫描、选目录
  local: {
    detect: () => ipcRenderer.invoke('lxmn:local:detect'),
    scan: (dir) => ipcRenderer.invoke('lxmn:local:scan', dir),
    pickDir: () => ipcRenderer.invoke('lxmn:local:pick-dir'),
  },
})
