# 网易云音乐对标 TODO（官方能力视角）

> 目的：把 Lyco Music 与**网易云音乐官方 App** 逐项对照，找出真实差距，并按可落地优先级排成 TODO。
> 与 [`PARITY.md`](./PARITY.md) 的区别：PARITY 的基准是 **lx-music**（超集目标，99 项已 91 完成）；本文件的基准是 **网易云官方**，因此 PARITY 里标「已」的项目在这里仍可能是缺口（例如「相似推荐」目前是重搜、「百科」是占位）。
> 调研日期：2026-11-13；对照基线：Lyco Music `0.2.59`（HEAD `2345e12`）。
> 结论先行：**不 fork 任何开源项目，继续在现有 Apache-2.0 架构上增量补**，理由见下文「决策」。

---

## 1. 决策（build, not fork）

| 方案 | 候选 | 为什么不选 |
| --- | --- | --- |
| fork | `qier222/YesPlayMusic` 33.6k★ MIT | 桌面 Electron/Web/PWA 单栈，无原生移动端；已宣布「2.0 Alpha 后进入维护模式」；无内置多音源、无会员/云同步/好友（README 另有「仅供个人学习研究、禁止商业」声明） |
| fork | `algerkong/AlgerMusicPlayer` 17.6k★ MIT | 覆盖 Desktop/Web/Mobile Web、Android 测试中、iOS 后续（README:54），仍无本项目已发的原生 Android/iOS 端；依赖整套 netease-cloud-music-api；README:99「禁止商业用途」与 88 元/年会员冲突 |
| fork | `lyswhut/lx-music-desktop` 55.3k★ Apache-2.0 | 已把开发重心迁到 Any Listen，并因官方压力移除内置音源；正是本项目要反着走的路线 |
| fork | `maotoumao/MusicFree` 28.5k★ AGPL-3.0 / `SPlayer` 7.4k★ AGPL-3.0 / `stark81/VutronMusic` 1.7k★ MIT+禁商用 / `youshen2/MeloX` 414★ GPL-3.0 | AGPL 或「禁商用」与本项目 Apache-2.0 + 会员模式直接冲突，**只能抄功能矩阵，不能抄代码** |
| build | 在 `lyco_music` 上增量 | 现有资产（桌面+移动双端、wy/kw/mg/kg 内置源 + 11 个 lx 脚本源、会员、云同步、好友、下载、桌面歌词）没有任何单项目同时覆盖；重构成本远高于补缺口 |

**License 红线**：`nooblong/NeteaseCloudMusicApiBackup` 是干净 MIT（README:477），可核对端点清单；`stark81/VutronMusic` MIT + 禁商用、YesPlayMusic(MIT)/AlgerMusicPlayer(MIT) README 也写「仅供学习、禁止商业」，与本项目 88 元/年会员冲突，**只参考交互不复制代码**；SPlayer/MusicFree AGPL-3.0 会传染派生作品，MeloX/HyPlayer/netease-cloud-music-gtk GPL-3.0、ponymusic 无 license，均只读功能矩阵。`lyswhut/lx-music-desktop` Apache-2.0 但 README:117 起有附加协议（:159「非商业性质」），同样只参考。

## 2. 参照项目（真实 `gh api repos` 元数据）

| 项目 | ★ | License | 最近推送 | 归档 | 可借鉴 |
| --- | --- | --- | --- | --- | --- |
| [YesPlayMusic](https://github.com/qier222/YesPlayMusic) | 33.6k | MIT | 2026-10-10 | 否 | 桌面端功能面最全的网易云仿制：每日推荐/私人FM/云盘/MV/Last.fm/TouchBar/Mpris |
| [NeteaseCloudMusicApiBackup](https://github.com/nooblong/NeteaseCloudMusicApiBackup) | 393 | MIT | 2025-01-14 | 否 | 351 个 `module/*.js` = 官方端点清单（原 Binaryify 仓库已归档清空） |
| [AlgerMusicPlayer](https://github.com/algerkong/AlgerMusicPlayer) | 17.6k | MIT | 2026-11-09 | 否 | 桌面 UI/沉浸式歌词/下载音质选择；README 禁商用 |
| [lx-music-desktop](https://github.com/lyswhut/lx-music-desktop) | 55.3k | Apache-2.0 | 2026-11-12 | 否 | 本项目原参照；[issue #1912](https://github.com/lyswhut/lx-music-desktop/issues/1912) 记录了内置音源的合规压力 |
| [MeloX](https://github.com/youshen2/MeloX) | 414 | GPL-3.0 | 2026-10-30 | 否 | 官方功能镜像最完整（一起听/听歌识曲/逐字歌词/音质 7 档），只读 README 当需求清单 |
| [ponymusic](https://github.com/wangchenyan/ponymusic) | 2.9k | 无 | 2026-09-16 | 否 | Android 端播放/歌单/下载交互 |
| [netease-cloud-music-gtk](https://github.com/gmg137/netease-cloud-music-gtk) | 2.4k | GPL-3.0 | 2026-11-01 | 否 | Linux 原生端的 Mpris2/托盘/桌面歌词做法 |

> 可回查 URL：<https://github.com/qier222/YesPlayMusic> · <https://github.com/nooblong/NeteaseCloudMusicApiBackup> · <https://github.com/algerkong/AlgerMusicPlayer> · <https://github.com/lyswhut/lx-music-desktop> · <https://github.com/youshen2/MeloX> · <https://github.com/wangchenyan/ponymusic> · <https://github.com/gmg137/netease-cloud-music-gtk> · <https://github.com/maotoumao/MusicFree> · <https://github.com/SPlayer-Dev/SPlayer> · <https://github.com/stark81/VutronMusic>

## 3. 真实踩坑（决定优先级的风控知识）

- **第三方登录会被风控**：[YesPlayMusic#2311](https://github.com/qier222/YesPlayMusic/issues/2311) 用户反馈「登录后强制下线重置密码、多次后账号冻结三天」，并直言「最近不要登录任何第三方客户端」。→ 登录功能必须可关、要写清楚风险、失败要能优雅降级为匿名模式。
- **扫码登录会返回 -462/8821**：[YesPlayMusic#2493](https://github.com/qier222/YesPlayMusic/issues/2493)（2026-10，Ubuntu 26.04 + 内置 API 4.8.9）；验证码通道也会挂：[netease-cloud-music-gtk#393](https://github.com/gmg137/netease-cloud-music-gtk/issues/393)。→ 登录要有多通道兜底 + 明确错误文案，不能只有二维码。
- **歌单/我的歌单 1000 首截断**：[NeteaseCloudMusicApi#452](https://github.com/Binaryify/NeteaseCloudMusicApi/issues/452)、[ponymusic#81](https://github.com/wangchenyan/ponymusic/issues/81)。→ 本项目 `fetchWyPlaylist` 已用 `trackIds` 差集 + `/api/v3/song/detail` 分批补齐，新增的分页能力必须沿用这一套。
- **海外 IP 播放受限**：[YesPlayMusic#2048](https://github.com/qier222/YesPlayMusic/issues/2048)/[#317](https://github.com/qier222/YesPlayMusic/issues/317)。→ 不引入 UnblockNeteaseMusic 式代理（法律风险），改为在播放失败时走已有的 `fallback.ts` 跨源换源。
- **许可自相矛盾**：[MusicFree#262](https://github.com/maotoumao/MusicFree/issues/262) 讨论 AGPL 与「禁商用」冲突。→ 佐证本文件「只抄功能矩阵不抄代码」的边界。


## 4. 能力对照表（官方 vs 现状）

图例：✅ 已实现且真实可用 · 🟡 有壳但为占位/降级实现 · ❌ 完全没有。
「登录」列：是否需要网易云账号态（本项目当前**没有任何网易云账号登录能力**，见 `docs/API.md` —— 现有 OAuth 是 lain42.top 自家账号）。

### 4.1 发现与推荐

| 官方能力 | 现状 | 证据 | 登录 | 优先级 |
| --- | --- | --- | --- | --- |
| 每日推荐 | 🟡 首页「每日推荐」卡只是跳 `搜索「热门」` | `apps/desktop/src/views/Home.vue:22`、`:61-63` | 需 | P0 |
| 私人漫游 / 私人 FM | 🟡 同上，跳 `搜索「华语流行」`/`搜索「轻音乐」` | `Home.vue:23-24` | 需 | P0 |
| 推荐歌单 / 精品歌单 | 🟡 9 个写死标题，点进去是搜索 | `Home.vue:69-72`、`:80-82` | 否 | P1 |
| 歌单分类/歌单广场 | ❌ 全仓无 `top_playlist`、`top_playlist_highquality`、`playlist_catlist` | 端点扫描 0 命中 | 否 | P1 |
| 排行榜 | ✅ `WY_BOARDS` 18 个静态榜 | `packages/core/src/sources/wy/playlist.ts` | 否 | — |
| 新歌速递 / 新碟上架 | ❌ 无 `top_song`、`top_album` | 0 命中 | 否 | P2 |
| 歌手榜/热门歌手 | ❌ 无 `toplist_artist`、`artist_list`、`top_artists` | 0 命中 | 否 | P2 |
| 搜索联想 | ❌ 无 `search_suggest` | 0 命中 | 否 | P1 |
| 听歌识曲 | ❌ 无彩虹屁/指纹识别链路 | 0 命中 | 需 | P3 |

### 4.2 内容详情页

| 官方能力 | 现状 | 证据 | 登录 | 优先级 |
| --- | --- | --- | --- | --- |
| 歌曲详情/百科 | 🟡 播放器「百科」tab 只有专辑/歌手/来源三行 | `apps/desktop/src/views/Player.vue:1371-1375` | 否 | P1 |
| 相似歌曲 | 🟡 拿「歌名+歌手」重搜一遍，不是真相似 | `Player.vue:667-689` | 否 | P1 |
| 歌手页（热门歌/专辑/简介） | ❌ 菜单「歌手」只跳搜索 | `Player.vue:910-915`，无 `artist/detail` | 否 | P1 |
| 专辑页 | ❌ 菜单「专辑」只跳搜索，无 `album?id=` | 同上 | 否 | P1 |
| 歌单详情 | ✅ 发现页可打开并播放/另存 | `apps/desktop/src/views/Discover.vue` | 否 | — |
| MV / 视频 | ❌ 无 `mv_url`/`mv_detail`/`top_mv`，无播放器 | 0 命中 | 否 | P2 |
| 播客 / 电台 | ❌ 侧栏「播客」只是跳搜索 `播客` | `Sidebar.vue` navMain、无 `dj_*`（共 24 个模块） | 需 | P2 |

### 4.3 播放体验

| 官方能力 | 现状 | 证据 | 登录 | 优先级 |
| --- | --- | --- | --- | --- |
| 播放队列增删排序 | ❌ 队列只能点播，无删除/拖拽 | `Player.vue:1677-1703`、`lib/player.ts` 无 `moveQueue/removeFromQueue` | 否 | **P0** |
| 淡入淡出 / 交叉淡化 | ❌ 全仓 0 命中 `crossfade` | — | 否 | P2 |
| 音量均衡 / 智能混音 | ❌ | — | 否 | P3 |
| 逐字歌词（桌面） | ✅ `parseYrc` + `mergeWords` + 逐字染色 | `packages/core/src/lyric.ts:252`、`Player.vue:1270-1275` | 否 | — |
| 逐字歌词（移动） | ❌ 移动端 0 命中 `yrc/逐字` | `PlayerScreen.tsx` | 否 | P1 |
| 桌面歌词窗口 | ✅ 独立窗口，但**无逐字高亮** | `views/DesktopLyric.vue` 无 `words` | 否 | P2 |
| 均衡器/音效 | ✅ 桌面 10 段 EQ+混响+升降调+3D；❌ 移动无 | `docs/PARITY.md:95` | 否 | P2（移动） |
| 定时关闭 | ✅ 桌面 15/30/45/60；❌ 移动无 | `apps/desktop/src/lib/sleep-timer.ts:14` | 否 | P1（移动） |
| 播放速度 | ✅ 桌面 7 档 + 移动 `setRate` | `PARITY.md:94` | 否 | — |
| 音质档位 | ✅ 7 档全部支持（含 Hi-Res/Atmos/母带） | `wy/index.ts:39-46`、`:348` | 否 | — |


### 4.4 账号与社交

| 官方能力 | 现状 | 证据 | 优先级 |
| --- | --- | --- | --- |
| 网易云登录（扫码/手机/邮箱） | ❌ 完全没有；现有 OAuth 是 lain42.top 自家账号 | `apps/desktop/src/views/Account.vue:50`、`docs/API.md` | **P0（但需风控开关）** |
| 我的歌单云端同步 | 🟡 只同步本项目自建歌单到 lain42.top | `packages/core/src/sync/` | P1 |
| 收藏歌单/歌手/专辑 | ❌ 只有本机「试听列表」与「我喜欢的」 | `library/index.ts` | P1 |
| 评论查看 | ✅ 热门/最新、热评、翻页 | `PARITY.md` 9.1 | — |
| 评论发表/回复/点赞 | ❌ 只能看不能写 | `Player.vue` `输入框` 0、「发送」0；`PlayerScreen.tsx` 同 | P1 |
| 关注/粉丝/动态 | ❌ 现有「好友」是 lyco 自有体系 | `views/Friends.vue` | P2 |
| 私信 | ❌ 0 命中 `msg/` | — | P3 |
| 一起听 | ❌ 0 命中 `listentogether` | — | P3 |
| 听歌记录上报/年度报告 | ❌ 本地历史不上报 | `library/index.ts:302-322` | P3 |

### 4.5 内容与工具

| 官方能力 | 现状 | 证据 | 优先级 |
| --- | --- | --- | --- |
| 音乐云盘 | ❌ 0 命中 `user_cloud` | — | P2 |
| 下载音质选择 | 🟡 下载页无档位选择，跟随当前播放音质透传 | `views/Downloads.vue`（311 行，无 `quality`）、`lib/downloads.ts` | **P1** |
| 下载任务管理 | ✅ 任务/进度/重试/并发 1–4 | `PARITY.md:156-165` | — |
| 按播放次数自动缓存 | ❌ 0 命中 | `packages/core/src/download/index.ts` | P2 |
| 本地音乐/加密格式 | ✅ 扫描 mp3/m4a/oga，`.ncm/.kgm/.qmc*` 如实跳过 | `PARITY.md:144` | — |
| 歌词导出 LRC | ✅（lx 也没有，本项目独有） | `PARITY.md:3.10` | — |
| 桌面歌词 | ✅ 独立窗口 + 字号/字体/颜色/描边/分色 | `views/DesktopLyric.vue` | — |
| 分享到第三方 | 🟡 只有 lyco 自有分享码 | `views/Friends.vue:212` | P3 |

### 4.6 系统集成

| 官方能力 | 现状 | 证据 | 优先级 |
| --- | --- | --- | --- |
| MPRIS / Linux 媒体键 | ❌ `main.cjs` 0 命中 `mpris/dbus/MediaSession` | `apps/desktop/electron/main.cjs`（1243 行） | **P1** |
| Windows 缩略图工具栏 | ❌ 无 `setThumbarButtons` | 同上 | P2 |
| macOS TouchBar | ❌ 无 `touchBar` | 同上 | P2 |
| 全局媒体键 | 🟡 自研 `lib/hotkeys.ts` 8 个快捷键，非系统级媒体键 | `PARITY.md:171` | P1 |
| 托盘菜单 | ✅ | `main.cjs` Tray 12 处 | — |
| 系统代理 | ✅ session 级 | `PARITY.md:174` | — |
| PWA / 网页版 | ❌ `vite.config.ts` 无 `pwa/manifest/sw` | `apps/desktop/vite.config.ts`（24 行） | P3 |

## 5. TODO 清单（按优先级，含验收标准）

> 每项都写了「怎么做」和「怎么验收」——验收一律要求：双端 `tsc --noEmit` 绿、`./node_modules/.bin/vitest run` 全绿、移动端 `jest` 全绿、桌面 `vite build` 绿，真机 CDP 点一遍。

### P0 — 影响日常使用，先做

**P0-1 播放队列可编辑**
- 现状（0.2.60 部分完成）：`apps/mobile/src/player.ts` 已有 `removeFromQueue(index)` / `clearQueue()`，移动端队列面板有「移除 / 清空」按钮；桌面 `apps/desktop/src/lib/player.ts` 仍只有 `shuffleQueue()` / `play(item, queue?)`，队列面板只能点播。
- 做：桌面 `player.ts` 增加 `removeFromQueue(index)`、`moveQueue(from, to)`、`clearQueue()`，改后要同步 `resumePosition` 与 `currentIndex`；桌面 `Player.vue:1677-1703` 队列行加删除按钮 + `draggable` 拖拽；移动端如需手势滑动删除再评估 `react-native-gesture-handler`（当前未装该依赖），按钮删除已可用。
- 验收：拖拽后顺序与 localStorage 恢复一致；删掉正在播的歌自动播下一首；桌面 `tests/player-queue.test.ts` 覆盖 3 个新方法的边界（删到空、删当前、越界索引）。移动端已有 `apps/mobile/__tests__/queue-edit.test.ts` 覆盖删前 / 删后 / 删当前 / 越界与清空。

**P0-2 网易云账号登录（带开关与降级）**
- 现状：全仓无网易云登录，`Account.vue` 是 lain42.top OAuth。
- 做：`packages/core/src/sources/wy/auth.ts` 新增匿名 cookie 容器 + `login_qr_key`（`/api/login/qrcode/unikey`）、`login_qr_create`（生成 `music.163.com/login?codekey=`）、`login_qr_check`（`/api/login/qrcode/client/login`）、`login_cellphone`（`/api/w/login/cellphone`）、`login_status`（`/api/w/nuser/account/get`）；cookie 存 `storage`（不落明文日志）；设置页加「启用网易云账号（有风控风险）」开关，默认关；失败必须回落到当前匿名链路。
- 风控依据：[YesPlayMusic#2311](https://github.com/qier222/YesPlayMusic/issues/2311) 账号冻结、[#2493](https://github.com/qier222/YesPlayMusic/issues/2493) -462/8821。
- 验收：未开启开关时所有请求与现在逐字节一致（用 CDP 抓 `lxmn.library` diff 验证）；开关关闭能立即清除 cookie；`tests/wy-auth.test.ts` 覆盖「无 cookie 走匿名、有 cookie 带上、登出清空」。

**P0-3 首页推荐接真实接口（拿掉假入口）**
- 现状：`Home.vue:21-29` 7 张频道卡是写死 keyword，点击跳搜索。
- 做：先用**免登录**接口替换能替换的：`personalized`（`/api/personalized/playlist`）、`toplist`、`top_playlist`（`/api/playlist/list?cat=…&order=hot`）；「每日推荐」「私人漫游」依赖登录态，登录未开启时**如实标注「需登录网易云账号」并引导到 P0-2**，不要假装随机。
- 验收：断网/接口 4xx 时首页降级到现有的静态卡片且不报错；CDP 检查卡片封面来自接口而非 `assets/art` 占位。

### P1 — 明显缺功能，第二梯队

**P1-1 歌手页 / 专辑页 / 歌曲百科（三个页面）**
- 内核：`packages/core/src/sources/wy/index.ts` 加 `fetchWyArtist(id)`（`artist_detail` → `/api/artist/head/info/get`，`artist_songs`（`/api/v1/artist/songs`）、`artist_album`（`/api/artist/albums/{id}`））、`fetchWyAlbum(id)`（`album` → `/api/v1/album/{id}`）、`fetchWySongDetail(id)`（`song_detail` + `song_wiki_summary` → `/api/song/play/about/block/page`）。
- 路由：`apps/desktop/src/router.ts` 加 `/artist/:id`、`/album/:id`；`Player.vue:910-915` 菜单项改为跳页面而不是搜索；`Player.vue` 百科 tab 换真实内容。
- 移动端：`App.tsx` tab 增加对应 screen。
- 验收：从播放器点「歌手」进入真实歌手页并列出热门 50 首；`tests/wy-artist.test.ts` 用固定 JSON 覆盖空结果/接口报错。

**P1-2 搜索联想**
- 内核加 `searchWySuggest(keyword)` → `search_suggest`（`/api/search/suggest/web`，免登录）；桌面 `Search.vue` 输入框加下拉；移动 `SearchScreen.tsx` 同上（注意 `HOT_KEYWORDS` 目前是本地常量，别混用）。
- 验收：输入 2 字触发、防抖 300ms、断网不报错、`tests/wy-suggest.test.ts` 覆盖去重与上限 10 条。

**P1-3 评论可写（发表/回复/点赞）**
- 依赖 P0-2 登录态；`packages/core/src/sources/wy/index.ts` 的 `getComments` 旁边加 `postWyComment`（`comment` → `POST /api/resource/comments/{t}`，`t=1` 发 / `t=2` 回复 / `t=0` 删除）、`replyWyComment`、`likeWyComment`（`comment_like` → `/api/v1/comment/{t}`）。
- 未登录时按钮置灰并显示「需登录网易云账号」，不要弹假成功 toast。
- 验收：登录后能发一条纯文本评论并在『最新』看到；网络失败显示后端 message；`tests/wy-comment-post.test.ts` 覆盖 4xx 提示。

**P1-4 下载音质可选**
- 现状：`enqueueDownload(items, quality, …)` 的 quality 来自当前播放音质，`Downloads.vue` 无选择器。
- 做：`prefs.ts` 加 `downloadQuality: Quality`（默认 `320k`）；`Downloads.vue` 加 `QualityMenu` 同款下拉；`lib/downloads.ts` 读 prefs 而不是播放态。
- 验收：设置 `flac` 后新任务文件名/元数据与 `parseQuality` 一致；已有任务不被篡改；`tests/download-quality.test.ts`。

**P1-5 移动端补齐已有能力（0.2.60 已补定时关闭，剩两项）**
- 逐字歌词：复用 `packages/core/src/lyric.ts` 的 `parseYrc`/`mergeWords`（桌面已用，`Player.vue:1270-1275`），`PlayerScreen.tsx` 加逐字染色。
- 定时关闭（0.2.60 已完成）：`apps/mobile/src/lib/sleep-timer.ts` 用绝对时间戳 + 1s ticker 实现 `[15,30,45,60]`，`PlayerScreen.tsx` 到期调用 `toggle()` 暂停；与桌面行为一致，不再列为本项待做。
- 音效：`docs/PARITY.md:95` 已注明移动端 TrackPlayer 无音效接口，需原生模块（`react-native-track-player` 不支持 EQ）。先做**如实置灰 + 说明**，不要做假开关。
- 验收：移动 `jest` 补 3 个用例；真机点一遍。

**P1-6 MPRIS / 系统媒体控制**
- `apps/desktop/electron/main.cjs` 加 `mpris-service` 或直接用 `dbus-next`，把播放态（标题/歌手/封面/进度）导出，接收 PlayPause/Next/Prev。
- 验收：Linux `playerctl play-pause` 能控制；`main.cjs` 增加 `before-quit` 清理；不引入新原生编译依赖，纯 JS 实现。

### P2 — 内容形态扩充

- **P2-1 歌单广场**：`top_playlist`（`/api/playlist/list?cat=…&order=hot`）+ `playlist_catlist`（`/api/playlist/catalogue`），在 `Discover.vue` 增「分类」tab（移动 `DiscoverScreen.tsx` 同步）。
- **P2-2 MV / 视频**：`mv_url`（`/api/song/enhance/play/mv/url`）+ `mv_detail`，播放器加视频模式；注意与现有 `Player.vue` 音频态解耦。
- **P2-3 播客 / 电台**：`dj_personalize_recommend`（`/api/djradio/personalize/rcmd`）、`dj_program_detail`，`Sidebar.vue` 的「播客」从跳搜索改成真实页面。
- **P2-4 音乐云盘**：`user_cloud`（`/api/v1/cloud/get`）+ `cloud`（上传）；需登录态。
- **P2-5 淡入淡出/交叉淡化**：桌面走 `WebAudio` `GainNode`（现有 EQ 链路可复用），移动 TrackPlayer 无接口需原生。
- **P2-6 按播放次数自动缓存**：`library` 已有 `playCount`，缓存层读它。
- **P2-7 桌面歌词逐字高亮**：`DesktopLyric.vue` 目前无 `words` 渲染。

### P3 — 长尾/慎重

- **P3-1 听歌识曲**：需录音权限 + 指纹接口，移动端成本高，且接口稳定性未知。
- **P3-2 一起听 / 私信 / 动态**：社交面，与现有 lyco 自有好友体系冲突，需先定产品口径。
- **P3-3 听歌记录上报 / 年度报告**：涉及账号态与隐私，需用户明确授权。
- **P3-4 PWA**：Electron 端无意义，若要网页版需单独立项。

## 6. 与 PARITY 的关系

- 本文件**不替代** `docs/PARITY.md`。PARITY 回答「lx-music 有的我们有没有」，本文件回答「网易云官方有的我们有没有」。
- 两者的交集项（歌单搜索、批量删除、歌词、下载）已在 0.2.59 交付，本文件不重复列。
- 建议：后续每次发版在两个文件里同步勾选。

## 7. 附录：本文引用的网易云端点（已核验模块名）

以下模块名来自 `nooblong/NeteaseCloudMusicApiBackup` 的 351 个 `module/*.js`（MIT，2025-01-14 最后推送，原 Binaryify 仓库已归档清空）。**本项目不依赖该仓库运行**，只用它核对端点命名，实际请求仍走 `packages/core/src/sources/wy/utils.ts` 的 `eapiRequest`。

| 用途 | 模块 | 备注 |
| --- | --- | --- |
| 登录 | `login_qr_key` / `login_qr_create` / `login_qr_check` / `login_cellphone` / `login_status` / `login_refresh` | 均需风控开关 |
| 推荐（免登录） | `personalized` / `personalized_newsong` / `personalized_privatecontent` | 首页可先接这批 |
| 推荐（需登录） | `recommend_songs` / `recommend_resource` / `history_recommend_songs` / `personal_fm` / `personal_fm_mode` / `fm_trash` | 每日推荐、私人漫游 |
| 榜单/广场 | `toplist` / `toplist_detail` / `top_playlist` / `top_playlist_highquality` / `playlist_catlist` / `playlist_hot` | 歌单广场 |
| 新内容 | `top_song` / `top_album` / `album_newest` / `album_new` | 新歌/新碟 |
| 歌手 | `artist_detail` / `artist_songs` / `artist_album` / `artist_top_song` / `toplist_artist` / `top_artists` / `artist_list` | 歌手页 |
| 专辑 | `album` / `album_detail` / `album_songs` / `album_sublist` | 专辑页 |
| 歌曲 | `song_detail` / `song_url_v1` / `song_wiki_summary` / `song_like_check` | 百科/点赞态 |
| 搜索 | `search_suggest` / `cloudsearch` / `search_multimatch` | 联想 |
| 评论 | `comment`（`t=1` 发、`t=2` 回复） / `comment_like` / `comment_hot` / `comment_music` / `comment_floor` | 评论区写操作 |
| MV | `mv_url` / `mv_detail` / `top_mv` / `mv_all` | 视频 |
| 播客 | `dj_personalize_recommend` / `dj_program_detail` / `dj_program` / `dj_toplist` / `dj_catelist` | 电台 |
| 云盘 | `user_cloud` / `user_cloud_detail` / `user_cloud_del` / `cloud`（上传）/ `cloud_import`（导入）/ `cloud_match` | 需登录 |
| 歌单写操作 | `playlist_create` / `playlist_delete` / `playlist_track_add` / `playlist_track_delete` / `playlist_subscribe` / `playlist_mylike` | 同步官方歌单 |
| 听歌记录 | `scrobble` / `listen_data_report` / `listen_data_total` / `user_record` | 上报/年报 |
| 一起听 | `listentogether_*`（9 个） | 社交 |

> 说明：本项目当前**只做读取与自建歌单**，不写回网易云（见 `packages/core/src/sources/wy/playlist.ts` 顶部注释）。任何写操作模块在接入前必须确认登录态与风控开关同时开启。
