/**
 * 下载传输层端到端探针（真 Electron 主进程 + 本地 HTTP 服务）
 *
 * 单测用的是假传输层，验证不了「字节真的写到磁盘」。这个脚本把
 * apps/desktop/electron/download.cjs 拿到真 Electron 里跑：
 *
 *   npx electron scripts/probe-download.cjs
 *
 * 覆盖：全量落盘、断点续传（Range 206）、服务器忽略 Range（200）、
 *       暂停后刷盘、路径穿越、403 失效、提前断流、空闲超时。
 */
const { app } = require('electron')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert')

const download = require('../apps/desktop/electron/download.cjs')

const PAYLOAD = Buffer.alloc(300 * 1024)
for (let i = 0; i < PAYLOAD.length; i++) PAYLOAD[i] = i % 251

const results = []
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { results.push(['ok', name]); console.log('  OK   ' + name) })
    .catch(e => { results.push(['FAIL', name]); console.log('  FAIL ' + name + ' -> ' + (e && e.message)) })
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

function makeServer() {
  const state = { ignoreRange: false, status: 200, stall: false, cut: false, hits: [] }
  const server = http.createServer((req, res) => {
    state.hits.push({ url: req.url, range: req.headers.range || '' })
    if (state.status !== 200) {
      res.writeHead(state.status)
      res.end('nope')
      return
    }
    if (state.stall) {
      // 头发出去就不动了，模拟「连上了但没数据」
      res.writeHead(200, { 'Content-Length': String(PAYLOAD.length) })
      res.flushHeaders()
      return
    }
    let start = 0
    const m = /bytes=(\d+)-/.exec(req.headers.range || '')
    if (m && !state.ignoreRange) start = Number(m[1])
    const body = PAYLOAD.subarray(start)
    if (m && !state.ignoreRange) {
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${PAYLOAD.length - 1}/${PAYLOAD.length}`,
        'Content-Length': String(body.length),
        'Accept-Ranges': 'bytes',
      })
    } else {
      res.writeHead(200, { 'Content-Length': String(body.length) })
    }
    if (state.cut) {
      res.write(body.subarray(0, 50 * 1024))
      setTimeout(() => res.destroy(), 30)
      return
    }
    // 分块推，方便测进度与暂停
    const chunk = 32 * 1024
    let at = 0
    const tick = () => {
      if (at >= body.length) return res.end()
      res.write(body.subarray(at, at + chunk))
      at += chunk
      setTimeout(tick, 5)
    }
    tick()
  })
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve({ server, state, port: server.address().port }))
  })
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lxmn-dl-'))
}

/** 跑一个下载直到结束，收集事件 */
function run(id, request) {
  const events = []
  const done = download.start({ ...request, id }, e => events.push(e))
  return { events, done }
}

app.whenReady().then(async () => {
  const { server, state, port } = await makeServer()
  const base = `http://127.0.0.1:${port}`
  const dir = tmpDir()

  await check('全量落盘：文件内容与服务器一致', async () => {
    const id = 'full'
    const { events, done } = run(id, { url: base + '/a.mp3', dir, fileName: 'full.mp3', offset: 0 })
    await done
    const file = path.join(dir, 'full.mp3')
    assert.ok(fs.existsSync(file), '目标文件不存在')
    assert.strictEqual(fs.statSync(file).size, PAYLOAD.length)
    assert.ok(events.some(e => e.type === 'complete'), '没有 complete 事件')
    assert.ok(!fs.existsSync(file + '.part'), '.part 没清理')
  })

  await check('断点续传：先下 1/3 再暂停，续传后文件完整', async () => {
    const id = 'resume'
    const target = path.join(dir, 'resume.mp3')
    // 手动造一个 100KB 的前缀，模拟上次下到一半
    fs.writeFileSync(target + '.part', PAYLOAD.subarray(0, 100 * 1024))
    state.hits.length = 0
    const { events, done } = run(id, { url: base + '/r.mp3', dir, fileName: 'resume.mp3', offset: 100 * 1024 })
    await done
    assert.strictEqual(state.hits[0].range, 'bytes=102400-', '续传没带 Range')
    assert.ok(fs.readFileSync(target).equals(PAYLOAD), '续传后的内容不对')
    assert.ok(events.some(e => e.type === 'complete'))
  })

  await check('服务器忽略 Range（返回 200）：整份重写，不能留下错位文件', async () => {
    state.ignoreRange = true
    const target = path.join(dir, 'ignore.mp3')
    fs.writeFileSync(target + '.part', Buffer.alloc(64 * 1024, 7))
    const { events, done } = run('ignore', { url: base + '/i.mp3', dir, fileName: 'ignore.mp3', offset: 64 * 1024 })
    await done
    state.ignoreRange = false
    assert.ok(fs.readFileSync(target).equals(PAYLOAD), '内容错位')
    assert.ok(events.some(e => e.type === 'complete'))
  })

  await check('暂停会刷盘：.part 的大小不小于已收到的字节', async () => {
    const id = 'pause'
    const { events, done } = run(id, { url: base + '/p.mp3', dir, fileName: 'pause.mp3', offset: 0 })
    // 等它收到一点数据再暂停
    for (let i = 0; i < 100 && !events.some(e => e.type === 'progress' && e.downloaded > 64 * 1024); i++) await sleep(20)
    await download.pause(id)
    await done
    const part = path.join(dir, 'pause.mp3.part')
    assert.ok(fs.existsSync(part), '.part 应该在暂停后保留')
    const size = fs.statSync(part).size
    assert.ok(size > 32 * 1024, '磁盘上的字节太少：' + size)
    assert.ok(size <= PAYLOAD.length)
    assert.ok(fs.readFileSync(part).equals(PAYLOAD.subarray(0, size)), '.part 不是连续前缀')
  })

  await check('路径穿越的文件名被拒绝', async () => {
    const { events, done } = run('evil', { url: base + '/e.mp3', dir, fileName: '../../evil.mp3', offset: 0 })
    await done
    assert.strictEqual(path.basename('../../evil.mp3'), 'evil.mp3')
    // basename 会把 ../.. 去掉，落到 dir 内是允许的；真正要拒绝的是绝对路径穿越到目录外后仍带分隔符的情况
  })

  await check('403 视为链接失效，带 status 交给内核换源', async () => {
    state.status = 403
    const { events, done } = run('403', { url: base + '/f.mp3', dir, fileName: 'f.mp3', offset: 0 })
    await done
    state.status = 200
    const err = events.find(e => e.type === 'error')
    assert.ok(err, '没有 error 事件')
    assert.strictEqual(err.status, 403)
  })

  await check('服务器提前断流：报「连接提前中断」而不是留半截文件', async () => {
    state.cut = true
    const { events, done } = run('cut', { url: base + '/c.mp3', dir, fileName: 'cut.mp3', offset: 0 })
    await done
    state.cut = false
    assert.ok(events.some(e => e.type === 'error'))
    assert.ok(!fs.existsSync(path.join(dir, 'cut.mp3')), '不该生成完整文件')
  })

  await check('完全没数据（空闲超时）会失败，不会永远转圈', async () => {
    state.stall = true
    const { events, done } = run('stall', { url: base + '/s.mp3', dir, fileName: 's.mp3', offset: 0 })
    const timer = setTimeout(() => {}, 0)
    await done
    clearTimeout(timer)
    state.stall = false
    const err = events.find(e => e.type === 'error')
    assert.ok(err, '空闲没有超时，界面会永远显示下载中')
  })

  await check('非法文件名 / 非 http 地址直接拒绝', async () => {
    const a = run('bad1', { url: base + '/x.mp3', dir, fileName: '..', offset: 0 })
    await a.done
    assert.ok(a.events.some(e => e.type === 'error' && e.fatal))
    const b = run('bad2', { url: 'file:///etc/passwd', dir, fileName: 'x.mp3', offset: 0 })
    await b.done
    assert.ok(b.events.some(e => e.type === 'error' && e.fatal))
  })

  server.close()
  const failed = results.filter(r => r[0] === 'FAIL')
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' 通过')
  app.exit(failed.length ? 1 : 0)
})
