/**
 * 下载传输层端到端验证（一次性探针）
 *
 * 为什么这个文件不在 tests/ 里：`electron/download.cjs` 依赖 Electron 的
 * `net` 与 `app`，vitest（纯 Node）里根本加载不起来。内核调度逻辑在
 * `packages/core` 里已经被 tests/download.test.ts 用假传输层覆盖，
 * 这里只验证「真的把字节写到磁盘」这一段 —— 文件系统、Range、改名，
 * 这三件事只有真跑一次才算数。
 *
 * 自带一个支持 Range 的本地 HTTP 服务，不依赖外网/代理，
 * 且能精确控制 206 / 200-忽略-Range / 慢速流 / 403 四种分支。
 *
 * 跑法：
 *   pnpm --filter @lxmn/app-desktop probe:download
 *
 * ⚠ 如果报 `Cannot find module 'electron'`，或报错里出现
 * `Node.js v2x.x.x`，说明环境里有 `ELECTRON_RUN_AS_NODE=1` ——
 * 那会让 electron.exe 以纯 Node 启动，拿不到 app / net。
 * 去掉这个变量即可（bash: `env -u ELECTRON_RUN_AS_NODE ...`）。
 *
 * 结果写 JSON 文件而不是 console.log —— Windows 上 Electron 是 GUI 子系统，
 * stdout 不会回到调用方终端。
 */
const { app } = require('electron')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const DOWNLOAD = require('../electron/download.cjs')

const OUT = path.join(__dirname, 'probe-download-result.json')
const results = []

function rec(name, ok, detail) {
  results.push({ name, ok, detail })
  try { fs.writeFileSync(OUT, JSON.stringify(results, null, 2)) } catch { /* ignore */ }
}

const sha = buf => crypto.createHash('sha256').update(buf).digest('hex')
const sleep = ms => new Promise(r => setTimeout(r, ms))

// 200 KB 确定性数据：太小测不出并发/进度，太大跑得慢
const BODY = Buffer.alloc(200000)
for (let i = 0; i < BODY.length; i++) BODY[i] = (i * 37 + 11) & 0xff
const BODY_SHA = sha(BODY)

function serve(mode) {
  const hits = []
  const server = http.createServer((req, res) => {
    hits.push({ range: req.headers.range || null, ua: req.headers['user-agent'] || null })
    if (mode === '403') {
      res.writeHead(403, { 'Content-Length': '2' })
      res.end('no')
      return
    }
    if (mode === 'slow') {
      res.writeHead(200, { 'Content-Length': String(BODY.length) })
      let i = 0
      const step = 4000
      const timer = setInterval(() => {
        if (i >= BODY.length) { clearInterval(timer); res.end(); return }
        res.write(BODY.subarray(i, i + step))
        i += step
      }, 20)
      res.on('close', () => clearInterval(timer))
      return
    }
    const range = req.headers.range
    if (mode === 'range' && range) {
      const m = /bytes=(\d+)-/.exec(range)
      const start = m ? Number(m[1]) : 0
      const slice = BODY.subarray(start)
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${BODY.length - 1}/${BODY.length}`,
        'Content-Length': String(slice.length),
        'Content-Type': 'audio/mpeg',
      })
      res.end(slice)
      return
    }
    // mode 'norange'：故意忽略 Range，永远返回 200 整份
    res.writeHead(200, { 'Content-Length': String(BODY.length), 'Content-Type': 'audio/mpeg' })
    res.end(BODY)
  })
  return new Promise(r => {
    server.listen(0, '127.0.0.1', () => {
      r({
        port: server.address().port,
        hits,
        close: () => new Promise(done => server.close(done)),
      })
    })
  })
}

function freshDir(name) {
  const dir = path.join(__dirname, name)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

async function testFull() {
  const dir = freshDir('out-full')
  const s = await serve('range')
  const events = []
  const t0 = Date.now()
  await DOWNLOAD.start(
    { id: 'full', url: `http://127.0.0.1:${s.port}/a.mp3`, dir, fileName: '七里香 - 周杰伦.mp3', offset: 0 },
    e => events.push(e),
  )
  const target = path.join(dir, '七里香 - 周杰伦.mp3')
  const exists = fs.existsSync(target)
  const buf = exists ? fs.readFileSync(target) : Buffer.alloc(0)
  const partGone = !fs.existsSync(target + '.part')
  rec('全量下载落盘', exists && partGone && buf.length === BODY.length && sha(buf) === BODY_SHA, {
    exists, partGone, size: buf.length, expect: BODY.length,
    shaOk: sha(buf) === BODY_SHA, ms: Date.now() - t0,
    completeEvent: events.find(e => e.type === 'complete') || null,
    hasUA: Boolean(s.hits[0] && s.hits[0].ua),
  })
  await s.close()
}

async function testResume() {
  const dir = freshDir('out-resume')
  const target = path.join(dir, 'r.mp3')
  fs.writeFileSync(target + '.part', BODY.subarray(0, 50000))
  const s = await serve('range')
  await DOWNLOAD.start(
    { id: 'resume', url: `http://127.0.0.1:${s.port}/b.mp3`, dir, fileName: 'r.mp3', offset: 50000 },
    () => {},
  )
  const buf = fs.existsSync(target) ? fs.readFileSync(target) : Buffer.alloc(0)
  const sentRange = s.hits[0] ? s.hits[0].range : null
  rec('断点续传（发 Range 且拼接正确）', buf.length === BODY.length && sha(buf) === BODY_SHA && sentRange === 'bytes=50000-', {
    size: buf.length, shaOk: sha(buf) === BODY_SHA, sentRange,
  })
  await s.close()
}

async function testRangeIgnored() {
  const dir = freshDir('out-norange')
  const target = path.join(dir, 'n.mp3')
  // 磁盘上已有 50000 字节，但服务器会无视 Range 返回整份 200
  fs.writeFileSync(target + '.part', BODY.subarray(0, 50000))
  const s = await serve('norange')
  await DOWNLOAD.start(
    { id: 'norange', url: `http://127.0.0.1:${s.port}/c.mp3`, dir, fileName: 'n.mp3', offset: 50000 },
    () => {},
  )
  const buf = fs.existsSync(target) ? fs.readFileSync(target) : Buffer.alloc(0)
  // 若没识别出「Range 被忽略」，会变成 50000 + 200000 = 250000 且开头错位
  rec('Range 被忽略时退回全量重写', buf.length === BODY.length && sha(buf) === BODY_SHA, {
    size: buf.length, expect: BODY.length, shaOk: sha(buf) === BODY_SHA,
  })
  await s.close()
}

async function testPauseResume() {
  const dir = freshDir('out-pause')
  const target = path.join(dir, 'p.mp3')
  const s = await serve('slow')
  const events = []
  const p = DOWNLOAD.start(
    { id: 'pause', url: `http://127.0.0.1:${s.port}/d.mp3`, dir, fileName: 'p.mp3', offset: 0 },
    e => events.push(e),
  )
  await sleep(150)
  const t0 = Date.now()
  await DOWNLOAD.pause('pause')
  await p
  const pauseMs = Date.now() - t0
  const partSize = fs.existsSync(target + '.part') ? fs.statSync(target + '.part').size : -1
  const targetGone = !fs.existsSync(target)
  rec('暂停：保留 .part、不产生成品文件、Promise 及时结束', partSize > 0 && partSize < BODY.length && targetGone && pauseMs < 2000, {
    partSize, targetGone, pauseMs,
    progressEvents: events.filter(e => e.type === 'progress').length,
  })

  const s2 = await serve('range')
  await DOWNLOAD.start(
    { id: 'pause2', url: `http://127.0.0.1:${s2.port}/d.mp3`, dir, fileName: 'p.mp3', offset: partSize },
    () => {},
  )
  const buf = fs.existsSync(target) ? fs.readFileSync(target) : Buffer.alloc(0)
  rec('暂停后继续：从磁盘字节数续上', buf.length === BODY.length && sha(buf) === BODY_SHA, {
    size: buf.length, shaOk: sha(buf) === BODY_SHA,
    sentRange: s2.hits[0] ? s2.hits[0].range : null,
  })
  await s.close()
  await s2.close()
}

async function testSafeJoin() {
  const dir = freshDir('out-safe')
  const s = await serve('range')

  const ev1 = []
  await DOWNLOAD.start(
    { id: 'evil', url: `http://127.0.0.1:${s.port}/e.mp3`, dir, fileName: '../../evil.mp3', offset: 0 },
    e => ev1.push(e),
  )
  const inside = fs.existsSync(path.join(dir, 'evil.mp3'))
  const escaped = fs.existsSync(path.join(__dirname, 'evil.mp3')) ||
    fs.existsSync(path.join(__dirname, '..', 'evil.mp3'))
  rec('路径穿越被收敛到目录内', !escaped && (inside || ev1.some(e => e.type === 'error')), {
    inside, escaped, events: ev1.map(e => e.type),
  })

  const ev2 = []
  await DOWNLOAD.start(
    { id: 'dotdot', url: `http://127.0.0.1:${s.port}/e.mp3`, dir, fileName: '..', offset: 0 },
    e => ev2.push(e),
  )
  rec('非法文件名被拒（fatal）', ev2.some(e => e.type === 'error' && e.fatal === true), {
    events: ev2,
  })

  const ev3 = []
  await DOWNLOAD.start(
    { id: 'badurl', url: 'file:///etc/passwd', dir, fileName: 'x.mp3', offset: 0 },
    e => ev3.push(e),
  )
  rec('非 http(s) 地址被拒', ev3.some(e => e.type === 'error' && e.fatal === true), { events: ev3 })

  await s.close()
}

async function test403() {
  const dir = freshDir('out-403')
  const s = await serve('403')
  const events = []
  await DOWNLOAD.start(
    { id: 'gone', url: `http://127.0.0.1:${s.port}/x.mp3`, dir, fileName: 'g.mp3', offset: 0 },
    e => events.push(e),
  )
  const err = events.find(e => e.type === 'error')
  rec('403 识别为链接失效', Boolean(err) && err.status === 403 && /失效/.test(err.message), { err })
  const leftover = fs.existsSync(path.join(dir, 'g.mp3.part'))
  rec('403 不留 .part 残骸', !leftover, { leftover })
  await s.close()
}

app.whenReady().then(async () => {
  const all = [testFull, testResume, testRangeIgnored, testPauseResume, testSafeJoin, test403]
  for (const fn of all) {
    try {
      await fn()
    } catch (e) {
      rec(fn.name, false, { threw: String(e && e.stack ? e.stack : e) })
    }
  }
  const failed = results.filter(r => !r.ok).length
  try {
    fs.writeFileSync(OUT, JSON.stringify({ summary: { total: results.length, failed }, results }, null, 2))
  } catch { /* ignore */ }
  app.exit(failed ? 1 : 0)
})
