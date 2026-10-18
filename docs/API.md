# Lyco Music 后端 API 文档

> 基地址: https://lain42.top/studio/api
> 后端版本: commerce_version b93236587a54ab6e26807ed04f143de6f7920548
> 文档日期: 2026-10-18 (Asia/Singapore)
> 状态: 联调通过（健康检查 / 订阅源接口实测 200 OK）

## 1. 健康检查
- Endpoint: `GET /health`
- 完整地址: `GET https://lain42.top/studio/api/health`
- 鉴权: 无
- 实测响应 200:
```json
{"ok":true,"service":"studio-billing","time":"2026-10-18T08:57:32+00:00","commerce_version":"b93236587a54ab6e26807ed04f143de6f7920548"}
```

## 2. 音乐订阅源下发
- Endpoint: `GET /music/sub/{license_key}`
- 鉴权: license_key 即会员订阅凭证
- 说明: 返回会员套餐、到期时间与全部音源清单（4 内置源 + 11 个 lx 脚本源 URL）。
- 实测响应 200 示例（节选）:
```json
{
  "ok": true,
  "schema": 1,
  "plan": {"id":"music_annual","name":"音乐会员 · 年卡","expires_at":"2027-10-17T04:43:12+00:00","active":true},
  "sources": [
    {"id":"wy","name":"网易云音乐","type":"builtin","order":1,"enabled":true},
    {"id":"kg","name":"酷狗音乐","type":"builtin","order":2,"enabled":true},
    {"id":"kw","name":"酷我音乐","type":"builtin","order":3,"enabled":true},
    {"id":"mg","name":"咪咕音乐","type":"builtin","order":4,"enabled":true},
    {"id":"lx-stellarwave","name":"星澜聚合音源","type":"script","url":"https://lain42.top/sources/stellarwave-v3.2.0.js","order":5}
  ]
}
```

## 3. OAuth 2.0 授权
- 授权模式: Authorization Code + PKCE（桌面端）；Device Grant（移动端）
- Token 交换: `POST /oauth/token`
- 参数: grant_type=authorization_code, code, client_id, redirect_uri, code_verifier
- 响应: access_token / refresh_token / expires_in / preferred_username / picture

## 4. 用户资料
- Endpoint: `GET /user/profile`（需 `Authorization: Bearer <access_token>`）
- 返回: uid, username, avatar（绝对 Origin URL，如 https://lain42.top/studio/api/avatar/{uid}.webp）, membership 状态。

## 5. 脚本音源托管
- 基地址: https://lain42.top/sources/
- 已托管 11 个脚本源（stellarwave-v3.2.0.js、molan-v2.3.0.js、kulao-v3.0.0.js 等）。

## 运维访问
```bash
ssh lain42.top -i ~/.ssh/<你的私钥>
```
