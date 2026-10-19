/**
 * 预加载脚本：把受控的原生能力暴露给渲染层。
 * 渲染层据此组装平台适配器（http 走主进程以绕过 CORS，存储走 localStorage）。
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('lxmnNative', {
  request: (options) => ipcRenderer.invoke('lxmn:request', options),
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
    /** 最大化状态变化（双击标题栏等）时同步图标 */
    onMaximizeChange: (cb) => {
      const handler = (_e, value) => { try { cb(Boolean(value)) } catch { /* ignore */ } }
      ipcRenderer.on('lxmn:win:maximized', handler)
      return () => ipcRenderer.removeListener('lxmn:win:maximized', handler)
    },
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
    getStyle: () => ipcRenderer.invoke('lxmn:lyric:get-style'),
    setStyle: (patch) => ipcRenderer.invoke('lxmn:lyric:set-style', patch),
    /** 歌词窗口订阅数据 */
    onData: (cb) => {
      const handler = (_e, payload) => { try { cb(payload) } catch { /* ignore */ } }
      ipcRenderer.on('lxmn:lyric:data', handler)
      return () => ipcRenderer.removeListener('lxmn:lyric:data', handler)
    },
  },
  /** 用系统浏览器打开外部链接（购买页等） */
  openExternal: (url) => ipcRenderer.invoke('lxmn:open-external', url),
})
