#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把下载页本身（HTML + Vite 产物 + manifest + 站点样式/脚本）镜像到 R2。

默认走 R2 Worker 的 /__mirror 令牌通道：CI 和本机都不需要 Cloudflare API
Token / wrangler OAuth，也不需要 SSH —— Worker 自己回源 lain42.top 拉取，
并给 downloads/index.html 注入镜像说明条。

    R2_UPLOAD_TOKEN=xxx python3 scripts/mirror-downloads-page.py

本机也可以把令牌写到 ~/.config/lyco/r2-upload-token（chmod 600），脚本会自动读取。
只有显式 LYCO_MIRROR_BACKEND=wrangler，或没有任何令牌时，才回退到旧的
「scp 到本机 + wrangler r2 object put」路径（需要本机 wrangler OAuth）。

环境变量：
    R2_UPLOAD_TOKEN / LYCO_R2_UPLOAD_TOKEN       Worker 上传令牌
    LYCO_R2_UPLOAD_TOKEN_FILE                    令牌文件（可选）
    R2_MIRROR_ENDPOINT / LYCO_R2_MIRROR_ENDPOINT Worker 域名
    LYCO_R2_SRC_BASE                             回源站点，默认 https://lain42.top
    LYCO_R2_PUBLIC_BASE                          只读访问域名（默认同 endpoint）
    LYCO_MIRROR_BACKEND                          auto（默认）/ worker / wrangler
    LYCO_SKIP_PAGE_ASSETS=1                      不扫描 Vite 哈希资源
    LYCO_R2_VERIFY=0                             跳过页面自检
    LYCO_SSH_KEY / LYCO_SSH_HOST / LYCO_WEB_ROOT / LYCO_R2_BUCKET / LYCO_WRANGLER
                                                 仅 wrangler 回退路径使用
"""
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

ENDPOINT = (os.environ.get("LYCO_R2_MIRROR_ENDPOINT")
            or os.environ.get("R2_MIRROR_ENDPOINT")
            or "https://lyco-music-dl.m15178682641.workers.dev").rstrip("/")
SRC_BASE = os.environ.get("LYCO_R2_SRC_BASE", "https://lain42.top").rstrip("/")
PUBLIC_BASE = os.environ.get("LYCO_R2_PUBLIC_BASE", ENDPOINT).rstrip("/")

SSH_KEY = os.path.expanduser(os.environ.get("LYCO_SSH_KEY", "~/.ssh/lain42.pem"))
SSH_HOST = os.environ.get("LYCO_SSH_HOST", "root@lain42.top")
WEB_ROOT = os.environ.get("LYCO_WEB_ROOT", "/var/www/studio")
BUCKET = os.environ.get("LYCO_R2_BUCKET", "lyco-music-dl")

# 新版下载页是 Vite 构建产物，入口 html 只引用 /downloads/page/app.<hash>.js
# 与 /downloads/page/index.<hash>.css —— 文件名带哈希，不能写死。
STATIC_FILES = [
    ("downloads/index.html", "/downloads/"),
    ("downloads/manifest.json", "/downloads/manifest.json"),
    ("assets/studio.css", "/assets/studio.css"),
    ("assets/studio.js", "/assets/studio.js"),
]
PAGE_ASSET_RE = re.compile(r"/downloads/page/[A-Za-z0-9._-]+\.(?:js|css)")
CTYPE_BY_EXT = {
    "html": "text/html; charset=utf-8",
    "json": "application/json",
    "css": "text/css; charset=utf-8",
    "js": "text/javascript; charset=utf-8",
}

BANNER = (
    '<div id="lyco-mirror-note" style="margin:0;padding:10px 16px;'
    'background:#1b1b1b;border-bottom:1px solid #2a2a2a;color:#c9c9c9;'
    'font:13px/1.6 -apple-system,PingFang SC,Microsoft YaHei,sans-serif;text-align:center">'
    '你现在打开的是 <b style="color:#E83A45">Cloudflare R2 边缘镜像</b>，'
    '下载更快；主站与完整导航在 <a href="https://lain42.top/downloads/" '
    'style="color:#E83A45">lain42.top/downloads/</a>（本站仅镜像下载页与安装包）'
    '</div>'
)


def http(method, url, data=None, headers=None, timeout=180):
    # Cloudflare WAF 对 Python-urllib/* 默认 UA 直接返回 403 / error code: 1010，
    # 而 curl UA 正常。这里统一伪装成 curl；不能省略这行。
    merged = {"User-Agent": "curl/8.23.0", "Accept": "*/*"}
    merged.update(headers or {})
    req = urllib.request.Request(url, data=data, method=method, headers=merged)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read(), dict(resp.headers.items())
    except urllib.error.HTTPError as e:
        return e.code, e.read(), dict(e.headers.items())


def resolve_token():
    for name in ("R2_UPLOAD_TOKEN", "LYCO_R2_UPLOAD_TOKEN"):
        v = os.environ.get(name, "").strip()
        if v:
            return v, "env:" + name
    paths = []
    custom = os.environ.get("LYCO_R2_UPLOAD_TOKEN_FILE")
    if custom:
        paths.append(os.path.expanduser(custom))
    paths += [
        os.path.expanduser("~/.config/lyco/r2-upload-token"),
        os.path.expanduser("~/.config/lain42/r2-upload-token"),
    ]
    for path in paths:
        try:
            v = open(path, encoding="utf-8").read().strip()
        except OSError:
            continue
        if v:
            return v, path
    return None, None


def fetch_bytes(url, timeout=30):
    status, body, _ = http("GET", url, timeout=timeout)
    if status != 200:
        raise RuntimeError("GET %s -> HTTP %s" % (url, status))
    return body


def collect_keys():
    files = list(STATIC_FILES)
    if os.environ.get("LYCO_SKIP_PAGE_ASSETS", "0") != "0":
        return files
    try:
        html = fetch_bytes(SRC_BASE + "/downloads/", timeout=30).decode("utf-8", "replace")
        seen = {key for key, _ in files}
        for path in sorted(set(PAGE_ASSET_RE.findall(html))):
            key = path.lstrip("/")
            if key not in seen:
                files.append((key, path))
                seen.add(key)
    except Exception as e:
        print("  页面资源扫描失败（继续只镜像固定项）：%s" % e, file=sys.stderr)
    return files


def ctype_of(key):
    ext = key.rsplit(".", 1)[-1].lower()
    return CTYPE_BY_EXT.get(ext, "application/octet-stream")


def worker_preflight(token):
    try:
        status, body, _ = http("GET", ENDPOINT + "/__mirror/check", timeout=30)
    except Exception as e:
        raise RuntimeError("无法连接 %s（%s）" % (ENDPOINT, e))
    if status != 200:
        raise RuntimeError("/__mirror/check 返回 HTTP %s" % status)
    try:
        upload = bool(json.loads(body.decode("utf-8", "replace")).get("upload"))
    except Exception:
        upload = False
    if not upload:
        raise RuntimeError("Worker 未配置 UPLOAD_TOKEN，请先在 Cloudflare 绑定 R2_UPLOAD_TOKEN")


def worker_mirror(key, src, token):
    payload = json.dumps({"key": key, "src": src}, separators=(",", ":")).encode("utf-8")
    headers = {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    last = ""
    for attempt in range(1, 4):
        try:
            status, body, _ = http("POST", ENDPOINT + "/__mirror",
                                   data=payload, headers=headers, timeout=180)
            text = body.decode("utf-8", "replace").strip()
            if status == 403:
                return False, "403 forbidden：R2_UPLOAD_TOKEN 与 Worker 不一致或已轮换"
            if status == 200:
                try:
                    data = json.loads(text)
                except Exception:
                    data = {}
                if data.get("ok"):
                    tag = "banner" if data.get("banner") else ("ranged" if data.get("ranged") else "")
                    return True, "size=%s %s" % (data.get("size", "?"), tag)
            last = "HTTP %s %s" % (status, text[:180])
        except Exception as e:
            last = str(e)
        if attempt < 3:
            time.sleep(2 * attempt)
    return False, last


def worker_verify(files):
    if os.environ.get("LYCO_R2_VERIFY", "1") == "0":
        print("  页面自检：已跳过（LYCO_R2_VERIFY=0）")
        return True
    page_assets = [src for key, src in files if key.startswith("downloads/page/")]
    try:
        status, body, _ = http("GET", PUBLIC_BASE + "/downloads/", timeout=30)
        html = body.decode("utf-8", "replace")
        missing = [a for a in page_assets if a not in html]
        ok = (status == 200 and "lyco-mirror-note" in html
              and "id=\"root\"" in html and not missing)
        if ok:
            print("  页面自检通过：说明条 + #root + %d 个哈希资源" % len(page_assets))
        else:
            print("  页面自检失败：status=%s marker=%s root=%s missing=%s" % (
                status, "lyco-mirror-note" in html, "id=\"root\"" in html, missing))
        return ok
    except Exception as e:
        # workers.dev 在部分网络下不可达；上传响应已确认入库，不把网络问题算成镜像失败。
        print("  页面自检跳过（%s）" % e)
        return True


def wrangler_prefix():
    env = os.environ.get("LYCO_WRANGLER")
    if env:
        return env.split()
    import shutil
    for name in ("npx", "npx.cmd", "pnpm", "pnpm.cmd"):
        found = shutil.which(name)
        if found:
            return [found, "wrangler"]
    for cand in (r"D:\APP\Code\nodejs\npx.cmd", r"C:\Program Files\nodejs\npx.cmd"):
        if os.path.exists(cand):
            return [cand, "wrangler"]
    sys.exit("找不到 npx/pnpm：请设置 R2_UPLOAD_TOKEN 走 Worker 通道，或用 LYCO_WRANGLER 指定 wrangler")


def wrangler_fallback(files):
    tmp = tempfile.mkdtemp(prefix="lyco-page-")
    ok = fail = 0
    ssh = ["ssh", "-i", SSH_KEY, "-o", "StrictHostKeyChecking=no"]
    scp = ["scp", "-i", SSH_KEY, "-o", "StrictHostKeyChecking=no"]
    for key, _src_path in files:
        remote = "%s/%s" % (WEB_ROOT, key)
        local = os.path.join(tmp, key.replace("/", "_"))
        r = subprocess.run(scp + ["%s:%s" % (SSH_HOST, remote), local],
                           capture_output=True, text=True, timeout=600)
        if r.returncode != 0:
            print("  SCP FAIL  %s  %s" % (remote, (r.stderr or "")[-120:]))
            fail += 1
            continue

        if key.endswith("index.html"):
            html = open(local, encoding="utf-8").read()
            if "lyco-mirror-note" not in html:
                m = re.search(r"<body[^>]*>", html, re.I)
                html = (html[:m.end()] + "\n" + BANNER + html[m.end():]) if m else (BANNER + html)
                open(local, "w", encoding="utf-8").write(html)
                print("  注入镜像说明条 ->", key)

        r = subprocess.run(wrangler_prefix() + [
                           "r2", "object", "put", "%s/%s" % (BUCKET, key),
                           "--file", local, "--content-type", ctype_of(key), "--remote"],
                           capture_output=True, text=True, timeout=600)
        if r.returncode == 0:
            ok += 1
            print("  OK        %s" % key)
        else:
            fail += 1
            print("  PUT FAIL  %s  %s" % (
                key, ((r.stderr or r.stdout or "")[-200:]).replace("\n", " ")))

    print()
    print("上传 %d，失败 %d" % (ok, fail))
    print("镜像下载页：%s/downloads/" % PUBLIC_BASE)
    sys.exit(1 if fail else 0)


def main():
    backend = os.environ.get("LYCO_MIRROR_BACKEND", "auto").strip().lower()
    if backend not in ("auto", "worker", "wrangler"):
        sys.exit("LYCO_MIRROR_BACKEND 只能是 auto / worker / wrangler")

    token, token_src = resolve_token()
    use_worker = backend == "worker" or (backend == "auto" and bool(token))
    files = collect_keys()
    print("待镜像 %d 项" % len(files))

    if use_worker:
        if not token:
            sys.exit("缺少 R2_UPLOAD_TOKEN：请设置环境变量，或写入 ~/.config/lyco/r2-upload-token")
        print("通道：R2 Worker /__mirror（令牌来自 %s）" % token_src)
        print("端点：%s" % ENDPOINT)
        try:
            worker_preflight(token)
        except Exception as e:
            sys.exit("预检失败：%s" % e)
        ok = fail = 0
        for key, path in files:
            src = SRC_BASE + path
            good, msg = worker_mirror(key, src, token)
            if good:
                ok += 1
                print("  OK        %-46s %s" % (key, msg))
            else:
                fail += 1
                print("  PUT FAIL  %-46s %s" % (key, msg))
                if "403" in msg:
                    break
        print()
        print("上传 %d，失败 %d" % (ok, fail))
        if fail:
            sys.exit(1)
        if not worker_verify(files):
            sys.exit("页面自检未通过，请检查 R2 中的 downloads/index.html")
        print("镜像下载页：%s/downloads/" % PUBLIC_BASE)
        return

    print("通道：wrangler（无可用令牌，或显式指定 LYCO_MIRROR_BACKEND=wrangler）")
    if token:
        print("  提示：检测到令牌；去掉 LYCO_MIRROR_BACKEND=wrangler 即可免 OAuth 走 Worker")
    wrangler_fallback(files)


if __name__ == "__main__":
    main()
