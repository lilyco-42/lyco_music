/**
 * 截图用的 preload 桩：把 `window.lxmnNative.local` 换成读本地 fixture 的假实现。
 *
 * 为什么需要它：截图跑在普通 dev server 里，没有主进程的 IPC。
 * 但扫描结果用的是 **probe-local.cjs 从真实 C:\CloudMusic 抓下来的数据**，
 * 所以界面渲染、文件名解析、分组、加密统计走的都是真实输入 ——
 * 只有 IPC 那一跳是假的。
 */
const fs = require('node:fs')
const path = require('node:path')

const fixturePath = path.join(__dirname, 'probe-local-scan.json')
let scanPayload = { root: '', entries: [], lrc: {} }
try {
  scanPayload = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))
} catch {
  // 没有 fixture 就返回空，页面上会显示「没找到」而不是崩掉
}

window.lxmnNative = {
  local: {
    detect: async () => ({ downloads: [scanPayload.root].filter(Boolean), clientData: [] }),
    scan: async dir => ({ ...scanPayload, root: dir || scanPayload.root }),
    pickDir: async () => '',
  },
}
