/**
 * 下载传输层（Electron 主进程）
 *
 * 渲染进程没有文件系统权限，所以真正的字节写入在这里。
 * 与内核的 `DownloadTransport` 一一对应：start / pause / remove / ensureDir。
 *
 * 几个刻意的做法：
 *
 * 1. **先写 `.part` 再改名。** 直接写目标文件的话，下载到一半断电/崩溃，
 *    磁盘上会留一个后缀正常、内容残缺的文件 —— 用户点开发现放不了，
 *    而且下次下载会被「同名跳过」逻辑当成已完成。
 *
 * 2. **用 Electron 的 `net` 而不是 node:https。** `net` 走 Chromium 的
 *    网络栈，自动继承系统代理设置。很多用户的音源地址在代理后面，
 *    用 node:https 会直接连不上，而错误信息只是超时，很难排查。
 *
 * 3. **Range 请求失败要能退回全量。** 有些 CDN 忽略 Range 头直接返回 200，
 *    这时如果继续按 offset 追加，文件开头会缺一段，播放器能播但时间轴是错的。
 *    检测到 statusCode 200 而 offset > 0 时，重新从头写。
 */
const { app, net, dialog, shell } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

/** id → { request, response, file, part, emit, paused, resolve } */
const tasks = new Map()

/**
 * 空闲超时。
 *
 * `net.request` 没有默认超时：源站把 TCP 握上手就不发数据时，任务会一直
 * 停在「下载中 0%」，用户看到的是永远转圈，连取消都不知道该不该点。
 * 30 秒没有任何字节就当这次请求失败，交给内核重试/换源。
 */
const IDLE_TIMEOUT = 30000

function defaultDir() {
  try {
    return path.join(app.getPath('downloads'), 'Lyco Music')
  } catch {
    return path.join(app.getPath('userData'), 'downloads')
  }
}

/**
 * 把 fileName 收敛成目录内的一个安全文件名。
 *
 * 渲染进程传来的名字已经过内核清洗，但主进程不能信任渲染进程 ——
 * 一旦渲染层被注入，`../../.ssh/authorized_keys` 这种名字能直接写穿。
 */
function safeJoin(dir, fileName) {
  const raw = String(fileName ?? '')
  const base = path.basename(raw.replace(/[\\/]+/g, '/'))
  if (!base || base === '.' || base === '..' || base.includes('\0')) return null
  const resolved = path.resolve(dir)
  const target = path.resolve(resolved, base)
  if (!target.startsWith(resolved + path.sep)) return null
  return target
}

async function ensureDir(dir) {
  try {
    await fs.promises.mkdir(dir, { recursive: true })
    return true
  } catch {
    return false
  }
}

function formatSpeed(bytesPerSec) {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return ''
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  let v = bytesPerSec
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}

function parseTotal(headers, offset) {
  const range = headers['content-range']
  if (range) {
    const m = /bytes\s+\d+-\d+\/(\d+)/i.exec(String(range))
    if (m) return Number(m[1]) || 0
  }
  const len = Number(headers['content-length'])
  if (Number.isFinite(len) && len > 0) return offset > 0 ? offset + len : len
  return 0
}

/**
 * 开始（或继续）一个下载。
 *
 * 返回的 Promise 在**任务结束**（完成 / 失败 / 被取消）时才 resolve ——
 * 内核靠它释放并发位，提前 resolve 会让并发数失控。
 */
function start(request, emit) {
  return new Promise(resolve => {
    const id = String(request?.id ?? '')
    const target = safeJoin(request?.dir, request?.fileName)
    if (!id || !target) {
      emit({ type: 'error', message: '文件名或目录非法', fatal: true })
      return resolve()
    }
    if (!/^https?:\/\//i.test(String(request?.url ?? ''))) {
      emit({ type: 'error', message: '下载地址无效', fatal: true })
      return resolve()
    }

    const part = target + '.part'
    const offset = Number(request?.offset) || 0
    const entry = { request, response: null, part, target, emit, finished: false, resolve }
    entry.lastDataAt = Date.now()
    entry.idleTimer = setInterval(() => {
      if (entry.finished || entry.paused) return
      if (Date.now() - entry.lastDataAt <= IDLE_TIMEOUT) return
      finish(id, { type: 'error', message: '连接超时：30 秒没有收到数据' })
    }, 2000)
    // 定时器不该拖住进程退出
    entry.idleTimer.unref?.()
    tasks.set(id, entry)

    // 续传位置以**磁盘**为准，而不是内核传来的 offset。
    //
    // `.part` 只会顺序追加，所以它永远是目标文件的一个连续前缀 ——
    // 从它的实际大小接着写一定是对的。而内核记的 `downloaded` 是
    // 「从网络读到的字节数」，还压在 WriteStream 缓冲里没落盘的那一截
    // 并不在磁盘上；暂停时若按内核的 offset 去追加，文件中间会留一段空洞。
    // 两者取小的那个是安全下界，但更简单也更准确的做法是直接信磁盘。
    let startOffset = 0
    if (offset > 0) {
      try {
        startOffset = fs.statSync(part).size
      } catch {
        startOffset = 0
      }
    } else {
      try { fs.unlinkSync(part) } catch { /* 不存在就算了 */ }
    }

    const headers = {}
    if (startOffset > 0) headers.Range = `bytes=${startOffset}-`

    let req
    try {
      req = net.request({ method: 'GET', url: String(request.url), redirect: 'follow' })
    } catch (e) {
      tasks.delete(id)
      emit({ type: 'error', message: String(e?.message ?? e), fatal: true })
      return resolve()
    }
    entry.request_handle = req
    for (const [k, v] of Object.entries(headers)) req.setHeader(k, v)
    // 部分源会按 UA 拒绝请求，与 lx 一样带一个常规浏览器 UA
    req.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36')

    req.on('response', response => {
      entry.response = response
      const status = response.statusCode || 0

      if (status === 401 || status === 403 || status === 410) {
        finish(id, { type: 'error', message: `链接已失效（${status}）`, status })
        return
      }
      if (status >= 400) {
        finish(id, { type: 'error', message: `服务器返回 ${status}`, status })
        return
      }

      // Range 被忽略：服务器给了整份内容。此时必须从头写，
      // 否则文件开头会缺 startOffset 字节，时长和进度都是错的。
      let append = startOffset > 0 && status === 206
      if (startOffset > 0 && !append) startOffset = 0

      const total = parseTotal(response.headers || {}, startOffset)
      const file = fs.createWriteStream(part, append ? { flags: 'a' } : { flags: 'w' })
      entry.file = file

      let received = startOffset
      let lastAt = Date.now()
      let lastBytes = received
      let speed = ''

      emit({ type: 'start' })

      response.on('data', chunk => {
        // 暂停后流还没停干净，此时再 write 会抛 ERR_STREAM_WRITE_AFTER_END
        if (entry.paused) return
        entry.lastDataAt = Date.now()
        received += chunk.length
        file.write(chunk)
        const now = Date.now()
        if (now - lastAt >= 500) {
          speed = formatSpeed(((received - lastBytes) * 1000) / (now - lastAt))
          lastAt = now
          lastBytes = received
        }
        emit({ type: 'progress', downloaded: received, total, speed })
      })

      response.on('end', () => {
        if (entry.paused) return
        file.end(() => {
          if (entry.paused) return
          // 只下到一半就 end 的情况（源提前断流）：交给内核重试
          if (total > 0 && received < total) {
            finish(id, { type: 'error', message: '连接提前中断' })
            return
          }
          try {
            fs.renameSync(part, target)
          } catch (e) {
            finish(id, { type: 'error', message: `保存失败：${e.message}`, fatal: true })
            return
          }
          finish(id, { type: 'complete', total: received })
        })
      })

      response.on('error', err => {
        finish(id, { type: 'error', message: String(err?.message ?? err) })
      })
    })

    req.on('error', err => {
      finish(id, { type: 'error', message: String(err?.message ?? err) })
    })

    req.end()
  })

  function finish(id, event) {
    const entry = tasks.get(id)
    if (!entry || entry.finished) return
    entry.finished = true
    clearInterval(entry.idleTimer)
    tasks.delete(id)
    try { entry.file?.destroy() } catch { /* ignore */ }
    entry.emit(event)
    entry.resolve()
  }
}

/**
 * 把 WriteStream 里还压着的缓冲刷到磁盘，然后才让 start() 的 Promise 结束。
 *
 * 直接 destroy() 会把缓冲区丢掉：磁盘上的 `.part` 比界面显示的进度小一截，
 * 下次续传虽然不会损坏文件（我们从磁盘大小重新对齐），但那一段等于白下了。
 * 1 秒兜底是为了别让 pause 卡死 —— 正常情况 close 事件是毫秒级的。
 */
function flushFile(file) {
  return new Promise(done => {
    if (!file || file.destroyed || file.closed) return done()
    let settled = false
    const once = () => {
      if (settled) return
      settled = true
      done()
    }
    file.once('close', once)
    file.once('error', once)
    try { file.end() } catch { once() }
    setTimeout(once, 1000)
  })
}

async function pause(id) {
  const entry = tasks.get(String(id))
  if (!entry) return
  entry.paused = true
  entry.finished = true
  clearInterval(entry.idleTimer)
  tasks.delete(String(id))
  try { entry.request_handle?.abort() } catch { /* ignore */ }
  await flushFile(entry.file)
  // .part 保留，下次续传
  entry.resolve()
}

async function remove(id) {
  const entry = tasks.get(String(id))
  if (entry) {
    entry.paused = true
    entry.finished = true
    clearInterval(entry.idleTimer)
    tasks.delete(String(id))
    try { entry.request_handle?.abort() } catch { /* ignore */ }
    await flushFile(entry.file)
    entry.resolve()
    try { fs.unlinkSync(entry.part) } catch { /* ignore */ }
  }
  // 没有活动任务时也要清掉残留的 .part（例如上次崩溃留下的）
}

async function pickDir(win) {
  const r = await dialog.showOpenDialog(win ?? undefined, {
    title: '选择下载目录',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: defaultDir(),
  })
  if (r.canceled || !r.filePaths.length) return ''
  return r.filePaths[0]
}

function openDir(dir) {
  const target = String(dir ?? '') || defaultDir()
  try { fs.mkdirSync(target, { recursive: true }) } catch { /* ignore */ }
  void shell.openPath(target)
}

module.exports = { defaultDir, ensureDir, start, pause, remove, pickDir, openDir, safeJoin }
