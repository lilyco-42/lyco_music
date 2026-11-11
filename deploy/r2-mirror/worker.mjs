// lyco_music 下载镜像 —— 公开只读 R2 桶，同时承载「下载页本身」。
//
// 两类内容：
//   1. 安装包（lyco_music/<tag>/Lyco.Music-*）—— 大文件，边缘缓存 1 天
//   2. 下载页静态资源（downloads/index.html、downloads/downloads.css、
//      assets/studio.css、assets/studio.js、downloads/manifest.json）
//      —— 让下载页也能从 R2 边缘打开，不依赖韩国那台回源
//
// 目录式路径（/downloads/ 或 /downloads）会回落到 <key>index.html。
const TYPES = {
  apk: 'application/vnd.android.package-archive',
  ipa: 'application/octet-stream',
  dmg: 'application/x-apple-diskimage',
  msi: 'application/x-msi',
  exe: 'application/vnd.microsoft.portable-executable',
  AppImage: 'application/x-executable',
  blockmap: 'application/json',
  yml: 'text/yaml',
  json: 'application/json',
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  ico: 'image/x-icon',
  woff2: 'font/woff2',
  txt: 'text/plain; charset=utf-8',
};

// ---- 受令牌保护的「拉取入库」接口 -------------------------------------
// 为什么需要它：CI 里没有 R2 的 S3 Access Key（OAuth 令牌建不出 R2 API Token），
// 但 Worker 自己有 R2 绑定。于是让 Worker 反过来去 lain42.top 把文件拉进桶里：
// CI 只发一个几十字节的 JSON 请求，几百 MB 的安装包在 Cloudflare 内部传输，
// 既不需要 S3 密钥，也不会撞到 Worker 的请求体大小限制。
const MIRROR_MARKER = 'lyco-mirror-note';
const MIRROR_BANNER =
  '<div id="lyco-mirror-note" style="margin:0;padding:10px 16px;background:#1b1b1b;' +
  'border-bottom:1px solid #2a2a2a;color:#c9c9c9;font:13px/1.6 -apple-system,' +
  'PingFang SC,Microsoft YaHei,sans-serif;text-align:center">你现在打开的是 ' +
  '<b style="color:#E83A45">Cloudflare R2 边缘镜像</b>，下载更快；主站与完整导航在 ' +
  '<a href="https://lain42.top/downloads/" style="color:#E83A45">lain42.top/downloads/</a>' +
  '（本站仅镜像下载页与安装包）</div>';

// 大安装包改从 GitHub Release 资产回源：GitHub 直连约 1MB/s，
// 而 lain42.top 源站受阿里云国际出口 300~400KB/s 限制（且与分片数量相乘会超时）。
// 页面/CSS/小文件仍走 lain42.top，保持原有行为。
const ALLOWED_SRC = [
  'https://lain42.top/downloads/',
  'https://lain42.top/assets/',
  'https://github.com/lilyco-42/lyco_music/releases/download/',
];
const ALLOWED_KEY_PREFIX = ['lyco_music/', 'downloads/', 'assets/'];

// 大文件一次吞 88~119MB 会撞 lain42.top 前缘（pingap 0.13.5 + pingora h2
// 「cannot reserve capacity」：对端在慢链路上放弃时，服务端还在写）。
// 改成 8MiB Range 分片 + R2 multipart：每个子请求小而短，绕开这个窗口。
// R2 multipart 要求除最后一片外每片 >= 5MiB，8MiB 正好。
const RANGE_CHUNK = 8 * 1024 * 1024;
const RANGE_MAX_PARTS = 10000;
// 非分片路径（页面 / CSS / manifest / 小文件）允许缓冲的上限。
const SMALL_MIRROR_LIMIT = 16 * 1024 * 1024;

// 从 ReadableStream 读成定长字节；超过上限立即取消，避免大文件被整份吞进内存。
async function bufferBody(stream, limit) {
  const reader = stream.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        throw new Error('upstream larger than ' + limit + ' bytes; Range required');
      }
      chunks.push(value);
    }
  } catch (e) {
    try { await reader.cancel(); } catch { /* best effort */ }
    throw e;
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let n = 0;
  for (let i = 0; i < a.length; i++) n |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return n === 0;
}

function guessType(key) {
  const ext = key.includes('.') ? key.split('.').pop() : '';
  return TYPES[ext] ?? 'application/octet-stream';
}

async function handleMirror(request, env) {
  if (!env.UPLOAD_TOKEN) return json({ error: 'upload not configured' }, 503);
  const auth = request.headers.get('authorization') || '';
  const token = (auth.replace(/^Bearer\s+/i, '') || request.headers.get('x-upload-token') || '').trim();
  if (!sameSecret(token, env.UPLOAD_TOKEN)) return json({ error: 'forbidden' }, 403);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad json' }, 400);
  }
  const key = String(body.key || '').replace(/^\/+/, '');
  const src = String(body.src || '');
  if (!key || key.includes('..') || !ALLOWED_KEY_PREFIX.some((p) => key.startsWith(p))) {
    return json({ error: 'bad key' }, 400);
  }
  if (!ALLOWED_SRC.some((p) => src.startsWith(p))) {
    return json({ error: 'src not allowed' }, 400);
  }

  // 先 HEAD，但强制 identity：pingap 对 Range 请求换了一条处理路径，
  // 可能把打包后的静态资源再 gzip 一遍；content-length 会与后续 GET 不一致。
  const MIRROR_HEADERS = { 'user-agent': 'lyco-r2-mirror/1', 'accept-encoding': 'identity' };
  const head = await fetch(src, {
    method: 'HEAD',
    headers: MIRROR_HEADERS,
  }).catch(() => null);
  const total = head && head.ok ? Number(head.headers.get('content-length') || 0) : 0;
  const canRange = !!(head && /bytes/i.test(head.headers.get('accept-ranges') || ''));
  const contentType =
    (head && head.headers.get('content-type')) || guessType(key);

  if (total > RANGE_CHUNK && canRange && total / RANGE_CHUNK < RANGE_MAX_PARTS) {
    const upload = await env.BUCKET.createMultipartUpload(key, {
      httpMetadata: { contentType },
    });
    const parts = [];
    try {
      for (let offset = 0, n = 1; offset < total; offset += RANGE_CHUNK, n++) {
        const end = Math.min(offset + RANGE_CHUNK, total) - 1;
        const want = end - offset + 1;
        let part = null;
        let lastErr = 'unknown';
        for (let attempt = 1; attempt <= 3 && !part; attempt++) {
          const r = await fetch(src, {
            headers: {
              ...MIRROR_HEADERS,
              Range: 'bytes=' + offset + '-' + end,
            },
          });
          if (r.status === 206) {
            const buf = await r.arrayBuffer();
            if (buf.byteLength === want) {
              part = await upload.uploadPart(n, buf);
            } else {
              lastErr = 'short chunk ' + buf.byteLength + '/' + want;
            }
          } else {
            lastErr = 'range status ' + r.status;
          }
          if (!part) await new Promise((res) => setTimeout(res, 400 * attempt));
        }
        if (!part) throw new Error(lastErr + ' @ ' + offset + '-' + end);
        parts.push({ partNumber: n, etag: part.etag });
      }
      const obj = await upload.complete(parts);
      return json({
        ok: true,
        key,
        size: obj.size,
        ranged: true,
        parts: parts.length,
        etag: obj.httpEtag,
      });
    } catch (e) {
      try { await upload.abort(); } catch { /* best effort */ }
      return json({ error: 'ranged mirror failed: ' + String(e) }, 502);
    }
  }

  if (total > SMALL_MIRROR_LIMIT) {
    return json({ error: 'upstream requires Range but does not advertise Accept-Ranges' }, 502);
  }
  const upstream = await fetch(src, { headers: MIRROR_HEADERS });
  if (!upstream.ok || !upstream.body) {
    return json({ error: 'upstream ' + upstream.status }, 502);
  }

  // 镜像下载页时顺手注入「你在镜像站」的说明条：页面很小，缓冲处理即可。
  // 幂等：已经有标记就不再注入，本地脚本预先注入过也不会变两层。
  if (key === 'downloads/index.html') {
    const html = await upstream.text();
    const withBanner = html.includes(MIRROR_MARKER)
      ? html
      : html.replace(/<body[^>]*>/i, (m) => m + '\n' + MIRROR_BANNER);
    const obj = await env.BUCKET.put(key, withBanner, {
      httpMetadata: { contentType: 'text/html; charset=utf-8' },
    });
    return json({ ok: true, key, size: obj.size, banner: true });
  }

  // R2 put() 不接受「长度未知」的 ReadableStream：某些源站响应是 chunked，
  // 直接传 upstream.body 会抛 Error 1101（Provided readable stream must have a known length）。
  // 页面/CSS/小安装包全部小于 16MiB，按上限缓冲成定长 Uint8Array 再入库。
  let buf;
  try {
    buf = await bufferBody(upstream.body, SMALL_MIRROR_LIMIT);
  } catch (e) {
    return json({ error: 'buffered mirror failed: ' + String(e) }, 502);
  }
  // HEAD 与 GET 若长度不同（目录 rewrite / 压缩差异），以实际收到的定长字节为准；
  // 这里只用于小文件，避免误判把页面镜像卡死。
  const obj = await env.BUCKET.put(key, buf, {
    httpMetadata: {
      contentType: upstream.headers.get('content-type') || contentType,
    },
  });
  return json({ ok: true, key, size: obj.size, etag: obj.httpEtag });
}

function notFound() {
  return new Response('Not Found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
}

export default {
  async fetch(request, env) {
    if (!['GET', 'HEAD', 'POST'].includes(request.method)) {
      return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return Response.json({
        ok: true,
        storage: 'R2',
        bucket: env.BUCKET?.bucketName ?? 'lyco-music-dl',
        upload: Boolean(env.UPLOAD_TOKEN),
      });
    }
    if (url.pathname === '/__mirror/check') {
      return json({ upload: Boolean(env.UPLOAD_TOKEN) });
    }
    if (url.pathname === '/__mirror') {
      if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
      }
      return handleMirror(request, env);
    }

    let key = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (key.includes('..')) return notFound();
    // 目录式路径落到 index.html：/ → index.html，/downloads/ → downloads/index.html
    if (key === '' || key.endsWith('/')) key += 'index.html';

    let obj = await env.BUCKET.get(key);
    if (obj === null && !key.split('/').pop().includes('.')) {
      const alt = key.replace(/\/?$/, '/') + 'index.html';
      obj = await env.BUCKET.get(alt);
      if (obj !== null) key = alt;
    }
    if (obj === null) return notFound();

    const ext = key.includes('.') ? key.split('.').pop() : '';
    const type = TYPES[ext] ?? 'application/octet-stream';
    // 安装包不可变 → 长缓存；页面/manifest 用短缓存，发新版后能及时生效
    const volatile = key.endsWith('manifest.json') || key.endsWith('.html')
      || key.endsWith('.css') || key.endsWith('.js') || key.endsWith('SHA256SUMS.txt');

    const headers = new Headers();
    headers.set('Content-Type', type);
    headers.set('Content-Length', String(obj.size));
    headers.set('ETag', obj.httpEtag);
    headers.set('Cache-Control', volatile ? 'public, max-age=60' : 'public, max-age=86400');
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Referrer-Policy', 'no-referrer');

    if (request.method === 'HEAD') return new Response(null, { status: 200, headers });

    const range = request.headers.get('range');
    if (range && !volatile) {
      const m = range.match(/bytes=(\d+)-(\d*)/);
      if (m) {
        const start = Number(m[1]);
        const end = m[2] ? Math.min(Number(m[2]), obj.size - 1) : obj.size - 1;
        if (start >= obj.size || start > end) {
          return new Response('Range Not Satisfiable', { status: 416 });
        }
        // R2ObjectBody.body 是 ReadableStream，没有 .slice()；
        // 范围读取必须重新走 bucket.get(key, { range })，否则 Range 请求 500。
        const ranged = await env.BUCKET.get(key, {
          range: { offset: start, length: end - start + 1 },
        });
        if (ranged === null) return notFound();
        return new Response(ranged.body, {
          status: 206,
          headers: {
            'Content-Type': type,
            'Content-Range': 'bytes ' + start + '-' + end + '/' + obj.size,
            'Content-Length': String(end - start + 1),
            'Accept-Ranges': 'bytes',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': headers.get('Cache-Control'),
          },
        });
      }
    }
    return new Response(obj.body, { status: 200, headers });
  },
};
