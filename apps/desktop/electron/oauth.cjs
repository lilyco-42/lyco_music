/**
 * 网站 OAuth 授权登录（授权码 + PKCE，RFC 8252 原生应用形态）。
 *
 * 从 main.cjs 拆出来有两个原因：
 * 1. 这是安全关键路径，独立成模块才能用真实浏览器做端到端测试；
 * 2. 回调服务、PKCE、令牌交换都不依赖 Electron，可以脱离 GUI 验证。
 *
 * 为什么不注册 lycomusic:// 自定义协议：
 * 协议处理器谁先注册谁生效，被别的程序抢注后就能截获授权码。
 * loopback 走 127.0.0.1 的临时端口，只有本进程在监听。
 */
'use strict'

const http = require('node:http')
const crypto = require('node:crypto')

const b64url = (buf) => buf.toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function callbackPage(title, detail) {
  return '<!doctype html><meta charset="utf-8"><title>' + title + '</title>' +
    '<body style="margin:0;min-height:100vh;display:grid;place-items:center;' +
    'background:#0f1013;color:#f2f4f8;font:15px/1.7 system-ui,sans-serif">' +
    '<div style="text-align:center"><h2 style="font-weight:600">' + title + '</h2>' +
    '<p style="color:#9aa3b2;margin:6px 0 0">' + detail + '</p></div></body>'
}

/**
 * 在 127.0.0.1 的指定端口上等一次回调。
 * 只接受路径 /callback，且必须带回我们发出的 state —— 否则可能是
 * 别的本地进程伪造的回调。
 */
function waitForCallback(port, expectedState, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settle = null
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1')
      if (url.pathname !== '/callback') {
        res.writeHead(404, { Connection: 'close' }).end()
        return
      }
      const reply = (title, detail) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' })
        res.end(callbackPage(title, detail))
      }
      const err = url.searchParams.get('error')
      const code = url.searchParams.get('code') || ''
      const state = url.searchParams.get('state') || ''
      if (err) {
        reply('已取消授权', '可以关闭这个页面，回到 Lyco Music。')
        settle({ error: err })
        return
      }
      if (!code || state !== expectedState) {
        reply('授权失败', '回调参数不匹配，请回到 Lyco Music 重试。')
        settle({ error: 'state_mismatch' })
        return
      }
      reply('授权成功', '可以关闭这个页面，回到 Lyco Music。')
      settle({ code })
    })
    const timer = setTimeout(() => settle({ error: 'timeout' }), timeoutMs)
    settle = (result) => {
      clearTimeout(timer)
      server.close()
      resolve(result)
    }
    server.on('error', (e) => { clearTimeout(timer); reject(e) })
    server.listen(port, '127.0.0.1')
  })
}

/** 取一个当前空闲的本地端口（监听后立刻释放，紧接着被 waitForCallback 重新占用） */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = http.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

/**
 * 完整走一遍授权：开浏览器 -> 等回调 -> 用 code + verifier 换令牌。
 * openExternal / fetchImpl 由调用方注入，便于测试。
 */
async function startLoginFlow(options) {
  const {
    baseUrl,
    clientId,
    scope,
    openExternal,
    fetchImpl,
    timeoutMs = 5 * 60 * 1000,
  } = options

  const verifier = b64url(crypto.randomBytes(48))
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest())
  const state = b64url(crypto.randomBytes(24))

  // 端口必须先定下来：授权页里的 redirect_uri 要和回调监听的端口一致
  const port = await freePort()
  const redirectUri = 'http://127.0.0.1:' + port + '/callback'

  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    state,
    scope,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })
  const authorizeUrl = baseUrl + '/oauth/authorize?' + query.toString()

  const pending = waitForCallback(port, state, timeoutMs)
  await openExternal(authorizeUrl)
  const result = await pending

  if (result.error) {
    const message = result.error === 'access_denied' ? '已取消授权'
      : result.error === 'timeout' ? '授权超时，请重试'
      : result.error === 'state_mismatch' ? '授权回调校验失败，请重试'
      : '授权未完成'
    throw new Error(message)
  }

  const res = await fetchImpl(baseUrl + '/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: result.code,
      client_id: clientId,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }).toString(),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body.access_token) {
    throw new Error(body.error === 'invalid_grant' ? '授权码已失效，请重试' : '换取令牌失败')
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token || '',
    expiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000,
  }
}

module.exports = { startLoginFlow, waitForCallback, freePort, b64url }
