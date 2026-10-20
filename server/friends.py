# -*- coding: utf-8 -*-
"""好友模块 —— lyco_music 的社交层。

设计决策（和 sync_docs.py 同一套哲学）：

1. 身份即订阅。音乐会员的 license_key 就是好友身份，不另设账号体系；
   鉴权直接复用 Sync._entitlement 的同款校验（Bearer + music_* 权益）。

2. 好友码（friend code）是对外唯一标识。license_key 是敏感凭证，
   绝不能出现在好友请求里；服务端为每个 license 生成 8 位短码，
   用户交换短码加好友，泄露风险与会员密钥解耦。

3. 好友关系是服务端语义。同步文档是「整包 JSON、服务器无业务语义」，
   但好友不行：请求-接受-删除必须由服务器裁决，客户端伪造请求
   不能凭空建立关系。

4. 在线状态是派生数据，不落库。用 sync_documents.updated_at 当
   「最后活跃时间」：60 分钟内同步过就算在线，不新增心跳表。
"""
import json
import secrets
import time
from datetime import datetime, timedelta, timezone

from fastapi import Header, HTTPException, Request

TZ8 = timezone(timedelta(hours=8))
FRIEND_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"  # 去掉易混的 0/O/1/I/L
CODE_LEN = 8
ONLINE_WINDOW_SEC = 3600
NICK_MAX = 20


def _now() -> int:
    return int(time.time())


def _gen_code(conn) -> str:
    """生成不冲突的好友码。8 位、32 字符表，冲突概率低，循环重试足够。"""
    while True:
        code = "".join(secrets.choice(FRIEND_CODE_ALPHABET) for _ in range(CODE_LEN))
        if conn.execute(
            "SELECT 1 FROM friend_profiles WHERE friend_code = ?", (code,)
        ).fetchone() is None:
            return code


def migrate(conn) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS friend_profiles (
            license_key TEXT PRIMARY KEY,
            friend_code TEXT NOT NULL UNIQUE,
            nickname TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS friend_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            from_key TEXT NOT NULL,
            to_key TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at INTEGER NOT NULL,
            UNIQUE(from_key, to_key)
        );
        CREATE INDEX IF NOT EXISTS friend_requests_to_idx
            ON friend_requests(to_key, status);
        CREATE INDEX IF NOT EXISTS friend_requests_from_idx
            ON friend_requests(from_key, status);

        -- 好友关系存双向边（查列表不用 JOIN，删好友两条 DELETE 就干净）
        CREATE TABLE IF NOT EXISTS friend_edges (
            user_key TEXT NOT NULL,
            friend_key TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (user_key, friend_key)
        );
        """
    )


class Friends:
    """和 Sync 一样持有 db 工厂；auth 直接内联（同一个 entitlements 表）。"""

    def __init__(self, db, now=None):
        self.db = db
        self._now = now or (lambda: datetime.now(TZ8).isoformat())

    # ------------------------------------------------------------ 鉴权
    # 说明：这里刻意复制 Sync._entitlement 的逻辑而不是 import 它 ——
    # 两个模块保持独立可拆卸，复制三十行比制造模块耦合划算。

    def _entitlement(self, authorization):
        token = ""
        if authorization:
            parts = str(authorization).split()
            if len(parts) == 2 and parts[0].lower() == "bearer":
                token = parts[1].strip()
            elif len(parts) == 1:
                token = parts[0].strip()
        if not token or not (6 <= len(token) <= 64):
            raise HTTPException(401, "missing or malformed token")

        conn = self.db()
        try:
            row = conn.execute(
                "SELECT license_key, product, status, expires_at"
                " FROM entitlements WHERE license_key = ?",
                (token,),
            ).fetchone()
        finally:
            conn.close()

        if not row:
            raise HTTPException(401, "token not found")
        if row["status"] != "active":
            raise HTTPException(403, "entitlement inactive")
        if not str(row["product"] or "").startswith("music_"):
            raise HTTPException(403, "not a music membership")

        expires_at = row["expires_at"]
        if expires_at:
            try:
                exp = datetime.fromisoformat(str(expires_at))
                if exp.tzinfo is None:
                    exp = exp.replace(tzinfo=TZ8)
                if exp <= datetime.now(TZ8):
                    raise HTTPException(403, "membership expired")
            except ValueError:
                pass
        return token

    # ------------------------------------------------------------ helpers

    def _profile(self, conn, key):
        return conn.execute(
            "SELECT license_key, friend_code, nickname, created_at"
            " FROM friend_profiles WHERE license_key = ?",
            (key,),
        ).fetchone()

    def _ensure_profile(self, conn, key):
        """拿到（必要时创建）好友档案。**必须容忍并发**。

        踩过的坑：客户端打开好友页时把 /api/friends/me 和 /api/friends
        并行发出（Promise.all），两个请求会同时发现「还没有档案」，
        然后同时 INSERT —— 后到的那个撞 UNIQUE(license_key)，
        整个列表接口 500。线上日志里就是这个：
            sqlite3.IntegrityError: UNIQUE constraint failed: friend_profiles.license_key
        表现是用户第一次进好友页就白屏/报错，还以为会员掉了。

        改成 INSERT OR IGNORE 后，后到的请求静默落空，回读一次就拿到
        先到者创建的那条。循环是为了兜住另一种极小概率：两次生成的
        friend_code 恰好相同 —— 那时 OR IGNORE 会连行都不插，
        回读仍是 None，换个码重试即可。
        """
        row = self._profile(conn, key)
        if row is not None:
            return row
        for _ in range(5):
            code = _gen_code(conn)
            conn.execute(
                "INSERT OR IGNORE INTO friend_profiles(license_key, friend_code, nickname, created_at)"
                " VALUES (?, ?, ?, ?)",
                (key, code, "乐友" + code[:4], _now()),
            )
            conn.commit()
            row = self._profile(conn, key)
            if row is not None:
                return row
        raise HTTPException(503, "好友档案创建失败，请重试")

    def _friend_keys(self, conn, key):
        return [
            r[0]
            for r in conn.execute(
                "SELECT friend_key FROM friend_edges WHERE user_key = ?", (key,)
            ).fetchall()
        ]

    def _activity(self, conn):
        """license_key -> 最后同步时间（在线状态派生自它）。"""
        return dict(
            conn.execute("SELECT license_key, updated_at FROM sync_documents").fetchall()
        )

    def _last_active_epoch(self, iso: str) -> int:
        if not iso:
            return 0
        try:
            dt = datetime.fromisoformat(iso)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=TZ8)
            return int(dt.timestamp())
        except ValueError:
            return 0

    def _friend_view(self, conn, key, activity, mine):
        p = self._profile(conn, key)
        if p is None:
            return None
        last = self._last_active_epoch(activity.get(key, ""))
        edge = conn.execute(
            "SELECT created_at FROM friend_edges WHERE user_key = ? AND friend_key = ?",
            (mine, key),
        ).fetchone()
        return {
            "friendCode": p[1],
            "nickname": p[2],
            "online": (_now() - last) < ONLINE_WINDOW_SEC,
            "lastActiveAt": last,
            "friendsSince": edge[0] if edge else 0,
        }

    # ------------------------------------------------------------ http

    def install(self, app) -> None:
        @app.get("/api/friends/me")
        def friends_me(authorization: str | None = Header(None)):
            """我的好友身份：首次调用自动分配好友码。"""
            key = self._entitlement(authorization)
            conn = self.db()
            try:
                p = self._ensure_profile(conn, key)
                act = self._activity(conn)
                last = self._last_active_epoch(act.get(key, ""))
                return {
                    "friendCode": p[1],
                    "nickname": p[2],
                    "online": (_now() - last) < ONLINE_WINDOW_SEC,
                    "lastActiveAt": last,
                }
            finally:
                conn.close()

        @app.post("/api/friends/nickname")
        async def friends_nickname(request: Request, authorization: str | None = Header(None)):
            """改昵称。空名回退到默认「乐友xxxx」。"""
            key = self._entitlement(authorization)
            body = await request.json()
            nick = (str(body.get("nickname") or "")).strip()[:NICK_MAX]
            if not nick:
                raise HTTPException(400, "nickname required")
            conn = self.db()
            try:
                self._ensure_profile(conn, key)
                conn.execute(
                    "UPDATE friend_profiles SET nickname = ? WHERE license_key = ?",
                    (nick, key),
                )
                conn.commit()
            finally:
                conn.close()
            return {"ok": True, "nickname": nick}

        @app.get("/api/friends")
        def friends_list(authorization: str | None = Header(None)):
            key = self._entitlement(authorization)
            conn = self.db()
            try:
                self._ensure_profile(conn, key)
                act = self._activity(conn)
                friends = []
                for k in self._friend_keys(conn, key):
                    v = self._friend_view(conn, k, act, key)
                    if v is not None:
                        friends.append(v)
                # 在线的排前面，同状态按最近活跃
                friends.sort(key=lambda f: (not f["online"], -f["lastActiveAt"]))
                pending_in = conn.execute(
                    "SELECT r.id, r.from_key, r.created_at, p.friend_code, p.nickname"
                    " FROM friend_requests r JOIN friend_profiles p"
                    "   ON p.license_key = r.from_key"
                    " WHERE r.to_key = ? AND r.status = 'pending'"
                    " ORDER BY r.created_at DESC",
                    (key,),
                ).fetchall()
                pending_out = conn.execute(
                    "SELECT r.created_at, p.friend_code, p.nickname"
                    " FROM friend_requests r JOIN friend_profiles p"
                    "   ON p.license_key = r.to_key"
                    " WHERE r.from_key = ? AND r.status = 'pending'"
                    " ORDER BY r.created_at DESC",
                    (key,),
                ).fetchall()
                return {
                    "friends": friends,
                    "pendingIn": [
                        {"id": r[0], "friendCode": r[3], "nickname": r[4], "createdAt": r[2]}
                        for r in pending_in
                    ],
                    "pendingOut": [
                        {"friendCode": r[1], "nickname": r[2], "createdAt": r[0]}
                        for r in pending_out
                    ],
                }
            finally:
                conn.close()

        @app.post("/api/friends/requests")
        async def friends_request(request: Request, authorization: str | None = Header(None)):
            """凭好友码发起请求。不能加自己/已有好友/重复请求。"""
            key = self._entitlement(authorization)
            body = await request.json()
            code = (str(body.get("friendCode") or "")).strip().upper()
            if not code:
                raise HTTPException(400, "friendCode required")
            conn = self.db()
            try:
                self._ensure_profile(conn, key)
                target = conn.execute(
                    "SELECT license_key FROM friend_profiles WHERE friend_code = ?",
                    (code,),
                ).fetchone()
                if target is None:
                    raise HTTPException(404, "好友码不存在")
                to_key = target[0]
                if to_key == key:
                    raise HTTPException(400, "不能添加自己")
                if to_key in self._friend_keys(conn, key):
                    raise HTTPException(409, "已经是好友了")
                dup = conn.execute(
                    "SELECT 1 FROM friend_requests"
                    " WHERE from_key = ? AND to_key = ? AND status = 'pending'",
                    (key, to_key),
                ).fetchone()
                if dup is not None:
                    raise HTTPException(409, "已发送过请求，等待对方处理")
                conn.execute(
                    "INSERT INTO friend_requests(from_key, to_key, status, created_at)"
                    " VALUES (?, ?, 'pending', ?)"
                    " ON CONFLICT(from_key, to_key) DO UPDATE SET"
                    "   status = 'pending', created_at = excluded.created_at",
                    (key, to_key, _now()),
                )
                conn.commit()
            finally:
                conn.close()
            return {"ok": True}

        @app.post("/api/friends/requests/{req_id}/accept")
        def friends_accept(req_id: int, authorization: str | None = Header(None)):
            """接受请求 -> 建双向边。只有收件人能接受。"""
            key = self._entitlement(authorization)
            conn = self.db()
            try:
                row = conn.execute(
                    "SELECT from_key, to_key FROM friend_requests"
                    " WHERE id = ? AND status = 'pending'",
                    (req_id,),
                ).fetchone()
                if row is None or row[1] != key:
                    raise HTTPException(404, "请求不存在或已处理")
                now = _now()
                conn.execute(
                    "INSERT OR IGNORE INTO friend_edges(user_key, friend_key, created_at)"
                    " VALUES (?, ?, ?)",
                    (row[1], row[0], now),
                )
                conn.execute(
                    "INSERT OR IGNORE INTO friend_edges(user_key, friend_key, created_at)"
                    " VALUES (?, ?, ?)",
                    (row[0], row[1], now),
                )
                conn.execute(
                    "UPDATE friend_requests SET status = 'accepted' WHERE id = ?", (req_id,)
                )
                conn.commit()
            finally:
                conn.close()
            return {"ok": True}

        @app.post("/api/friends/requests/{req_id}/decline")
        def friends_decline(req_id: int, authorization: str | None = Header(None)):
            key = self._entitlement(authorization)
            conn = self.db()
            try:
                row = conn.execute(
                    "SELECT to_key FROM friend_requests WHERE id = ?", (req_id,)
                ).fetchone()
                if row is None or row[0] != key:
                    raise HTTPException(404, "请求不存在")
                conn.execute(
                    "UPDATE friend_requests SET status = 'declined' WHERE id = ?", (req_id,)
                )
                conn.commit()
            finally:
                conn.close()
            return {"ok": True}

        @app.delete("/api/friends/{code}")
        def friends_remove(code: str, authorization: str | None = Header(None)):
            """删好友：双向删边，已处理的请求记录保留（审计用）。"""
            key = self._entitlement(authorization)
            conn = self.db()
            try:
                target = conn.execute(
                    "SELECT license_key FROM friend_profiles WHERE friend_code = ?",
                    (code.strip().upper(),),
                ).fetchone()
                if target is None:
                    raise HTTPException(404, "好友码不存在")
                to_key = target[0]
                conn.execute(
                    "DELETE FROM friend_edges WHERE user_key = ? AND friend_key = ?",
                    (key, to_key),
                )
                conn.execute(
                    "DELETE FROM friend_edges WHERE user_key = ? AND friend_key = ?",
                    (to_key, key),
                )
                conn.commit()
            finally:
                conn.close()
            return {"ok": True}

        @app.get("/api/friends/lookup/{code}")
        def friends_lookup(code: str, authorization: str | None = Header(None)):
            """加好友前查一下码对应谁（显示昵称，避免加错人）。"""
            key = self._entitlement(authorization)
            conn = self.db()
            try:
                row = conn.execute(
                    "SELECT friend_code, nickname FROM friend_profiles"
                    " WHERE friend_code = ?",
                    (code.strip().upper(),),
                ).fetchone()
                if row is None:
                    raise HTTPException(404, "好友码不存在")
                return {"friendCode": row[0], "nickname": row[1]}
            finally:
                conn.close()
