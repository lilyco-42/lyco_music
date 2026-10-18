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
  /** 用系统浏览器打开外部链接（购买页等） */
  openExternal: (url) => ipcRenderer.invoke('lxmn:open-external', url),
})
