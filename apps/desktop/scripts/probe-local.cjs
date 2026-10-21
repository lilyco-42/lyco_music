/**
 * 本地导入端到端验证
 *
 * 验证三件只有真跑才知道的事：
 *   1. 目录探测能不能找到这台机器上的网易云下载目录（装在 C:\CloudMusic）
 *   2. 扫描能不能真的列出 mp3 / 认出 ncm
 *   3. `lxmn-media://` 协议能不能正确返回 200 / 206(Range) / 404
 *
 * 第 3 条最关键：Chromium 的媒体栈靠 206 + Content-Range 跳进度条，
 * 协议写错的话表现是「能播但拖不动」，而且不会报任何错。
 *
 * 跑法（必须清掉 ELECTRON_RUN_AS_NODE）：
 *   env -u ELECTRON_RUN_AS_NODE electron scripts/probe-local.cjs
 */
const { app, net } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const local = require('../electron/local.cjs')

const OUT = path.join(__dirname, 'probe-local-result.json')
const results = []

function rec(name, ok, detail) {
  results.push({ name, ok, detail })
  try { fs.writeFileSync(OUT, JSON.stringify(results, null, 2)) } catch { /* ignore */ }
}

local.registerScheme()

app.whenReady().then(async () => {
  local.installProtocol()

  // —— 1. 探测 ——
  let dirs = { downloads: [], clientData: [] }
  try {
    dirs = await local.detectDirs()
    rec('探测网易云下载目录', dirs.downloads.length > 0, dirs)
  } catch (e) {
    rec('探测网易云下载目录', false, { threw: String(e && e.stack ? e.stack : e) })
  }

  // —— 2. 扫描 ——
  const target = dirs.downloads[0]
  let scanned = null
  if (target) {
    try {
      scanned = await local.scan(target)
      const mp3 = scanned.entries.filter(e => e.ext === 'mp3')
      const ncm = scanned.entries.filter(e => e.ext === 'ncm')
      rec('扫描目录', mp3.length > 0, {
        root: scanned.root,
        total: scanned.entries.length,
        mp3: mp3.length,
        ncm: ncm.length,
        exts: [...new Set(scanned.entries.map(e => e.ext))].sort(),
        sample: scanned.entries.slice(0, 5).map(e => ({ name: e.name, size: e.size, ext: e.ext })),
      })
      // 子目录是否被扫到（VipSongsDownload）
      const sub = scanned.entries.filter(e => e.path.includes('VipSongsDownload'))
      rec('递归进子目录', sub.length > 0, { subdirCount: sub.length })
      // 落一份 fixture：给界面截图用，喂的是**真实文件名**，
      // 这样截图验证的是真实解析结果，而不是我编的数据
      try {
        fs.writeFileSync(path.join(__dirname, 'probe-local-scan.json'), JSON.stringify(scanned))
      } catch { /* ignore */ }
    } catch (e) {
      rec('扫描目录', false, { threw: String(e && e.stack ? e.stack : e) })
    }
  } else {
    rec('扫描目录', false, { skipped: '没探测到目录' })
  }

  // —— 3. 协议 ——
  const firstAudio = scanned && scanned.entries.find(e => e.ext === 'mp3')
  if (firstAudio) {
    const url = local.PREFIX + encodeURIComponent(firstAudio.path)
    try {
      const res = await net.fetch(url)
      const buf = await res.arrayBuffer()
      rec('协议返回 200 与完整字节', res.status === 200 && buf.byteLength === firstAudio.size, {
        status: res.status,
        bytes: buf.byteLength,
        expect: firstAudio.size,
        contentType: res.headers.get('content-type'),
        acceptRanges: res.headers.get('accept-ranges'),
      })
    } catch (e) {
      rec('协议返回 200 与完整字节', false, { threw: String(e && e.stack ? e.stack : e) })
    }

    try {
      const res = await net.fetch(url, { headers: { Range: 'bytes=100-199' } })
      const buf = await res.arrayBuffer()
      const cr = res.headers.get('content-range')
      rec('Range 请求返回 206 与正确切片', res.status === 206 && buf.byteLength === 100 && /^bytes 100-199\//.test(String(cr)), {
        status: res.status,
        bytes: buf.byteLength,
        contentRange: cr,
      })
    } catch (e) {
      rec('Range 请求返回 206 与正确切片', false, { threw: String(e && e.stack ? e.stack : e) })
    }
  } else {
    rec('协议返回 200 与完整字节', false, { skipped: '目录里没有可用的 mp3' })
    rec('Range 请求返回 206 与正确切片', false, { skipped: '目录里没有可用的 mp3' })
  }

  try {
    const res = await net.fetch(local.PREFIX + encodeURIComponent('C:\\__不存在__\\x.mp3'))
    rec('不存在的文件返回 404', res.status === 404, { status: res.status })
  } catch (e) {
    rec('不存在的文件返回 404', false, { threw: String(e && e.stack ? e.stack : e) })
  }

  const failed = results.filter(r => !r.ok).length
  try {
    fs.writeFileSync(OUT, JSON.stringify({ summary: { total: results.length, failed }, results }, null, 2))
  } catch { /* ignore */ }
  app.exit(failed ? 1 : 0)
})
