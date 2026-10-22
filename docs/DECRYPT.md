# 本地加密音频格式支持

导入本地音乐时，主进程会先把加密封装就地解成普通音频，再交给扫描流程。
**只处理本机文件**：不上传、不联网、不改源文件，解出来的副本写在
`userData/ncm-cache/`，按「原文件名 + mtime + size」命名，重复导入直接命中缓存。

## 已支持

| 格式 | 来源平台 | 实现 | 说明 |
| --- | --- | --- | --- |
| `.ncm` | 网易云音乐 | `electron/ncm.cjs` | AES-128-ECB 解密钥与元信息 + 非标准 PRGA 流密码；能读出歌名/歌手/专辑/封面 |
| `.kgm` `.kgma` | 酷狗音乐 | `electron/kgm.cjs` | 16 字节 magic + header 长度 + 逐文件 16 字节密钥；查表掩码 + 逐字节变换 |
| `.vpr` | 酷狗（旧） | `electron/kgm.cjs` | 同 KGM，末尾多异或一个 VPR 掩码 |
| `.qmc0` `.qmc3` | QQ 音乐 | `electron/qmc.cjs` | 静态密码：SEED_MAP 蛇形遍历生成 128 字节密钥流，逐字节异或 |
| `.qmcflac` `.qmcogg` | QQ 音乐 | `electron/qmc.cjs` | 同上，输出 flac / ogg |
| `.bkc` `.bkcmp3` `.bkcflac` `.bkcogg` | QQ 音乐（备份） | `electron/qmc.cjs` | 同 QMC 静态密码 |
| `.mflac` `.mflac0/2/4` `.mgg` `.mgg0/1/2/4` `.mggl` `.qmc2` `.qmcflac2` | QQ 音乐 | `electron/qmc2.cjs` | QMCv2：从 STag/QTag/裸尾容器里挖 ekey，TEA 派生密钥，再走 RC4 变体（长密钥）或 32768 掩码（短密钥） |

## 暂不支持

| 格式 | 原因 |
| --- | --- |
| musicex 容器（2023 年后的 QQ 音乐新版） | 文件里**没有**内嵌 ekey，必须带用户 Cookie 回官方接口换。导入页会明确提示这一条，不会静默跳过 |
| 带 STag 但无内嵌密钥的容器 | 同上，需要旧版客户端重新下载 |
| 其他（`.xm`、`.tm*` 等） | 格式已停用或样本太少，没有可靠参考实现 |

遇到不支持的格式，导入页会明确列出来（"仍有 M 个加密文件解不开"），不会静默跳过。

## 算法要点（给下一个人）

### NCM
1. magic `CTENFDAM` + 2 字节，随后 `keyLen`(u32le) + 密钥块：XOR `0x64` → AES-128-ECB（key `hzHRAmso5kInbaxW`）→ 去掉 `neteasecloudmusic` 前缀。
2. `metaLen`(u32le) + 元信息块：XOR `0x63` → 去掉 `163 key(Don't modify):` → base64 → AES-128-ECB（key `#14ljk_!\]&0U<'(`）→ 去掉 `music:` → JSON。
3. 跳 5 字节（crc4 + 1），然后是封面帧：`frameLen`(u32le) + `imageLen`(u32le) + 图片 + 补白（`frameLen - imageLen`）。
4. 音频用 RC4 变体：KSA 是标准的，PRGA 被改过 —— `j = (i+1) & 0xff`，`a = s[j]`，`b = s[(a+j) & 0xff]`，输出 `s[(a+b) & 0xff]`。最后按 PKCS#7 去掉填充。

### KGM / VPR
- 头：`0x00..0x10` magic，`0x10..0x14` header 长度，`0x1C..0x2C` 16 字节密钥（第 17 字节隐式 0）。
- 逐字节：`med8 = key[pos % 17] ^ data` → `med8 ^= (med8 & 0x0F) << 4` → `msk8 = getMask(pos)` → `msk8 ^= (msk8 & 0x0F) << 4` → `data = med8 ^ msk8`。
- VPR 再异或 `VPR_MASK_DIFF[pos % 17]`。
- `getMask` 用三张 272 字节表（`MASK_V2_PRE_DEF` / `TABLE1` / `TABLE2`），表在 `electron/decoder-tables.cjs`。

### QMCv2
- 容器嗅探（`detectKey`）：STag 头（`ekeyLen`@0x14，ekey@0x18）、QTag 尾（`ekey,songid,ver` + u32be 长度 + `QTag`）、裸 ekey 尾（ekey + u32le 长度）。musicex / 无密钥 STag 直接给出可读原因。
- 密钥派生：ekey(base64) → 若以 `QQMusic EncV2,Key:` 开头，先用 MIX_KEY_1/MIX_KEY_2 各解一轮腾讯 TEA；再用 `simpleMakeKey(106, 8)` 拼出 16 字节 TEA 密钥，解主体，拼成 `8 + N` 字节。
- 解音频：派生密钥 >300 字节 → `QmcRC4Cipher`（KSA 标准，分段 5120，段内用 `S[(skip + pos + i) % N]`）；≤300 字节 → `keyCompress` 压成 128 字节后铺 32768 掩码。

### QMC 静态（v1）
- 密钥流：在 7×8 的 `SEED_MAP` 上蛇形遍历，每轮 128 字节；`index` 到 `0x8000` 的倍数时递归跳过一格。
- 变换：`data[i] ^= key[(i > 0x7FFF ? i % 0x7FFF : i) % 128]`。**0x7FFF 取模不能省**，否则长文件后半段会花屏。

## 参考实现（"寻找 js" 的答案）

| 项目 | 用途 |
| --- | --- |
| [Johnserf-Seed/ncm2mp3](https://github.com/Johnserf-Seed/ncm2mp3) | NCM 格式的权威参考，逐字段对过 |
| [ix64/unlock-music](https://github.com/ix64/unlock-music) | 覆盖面最广的网页解密器（NCM/QMC/KGM 全有） |
| [nowa277/OpenConverter](https://github.com/nowa277/OpenConverter) | 纯 JS 的 KGM/QMC 实现，无 wasm、无大表，本仓库的 KGM 查表与算法对照它写的 |
| huangbao/MyKgmWasm (MIT) | KGM 查表数据来源 |

查表数据固化在 `electron/decoder-tables.cjs`（从参考实现导出，非手写），
算法在 `kgm.cjs` / `qmc.cjs` / `ncm.cjs`，测试在 `tests/ncm.test.ts` 与
`tests/media-decoders.test.ts`（用合成文件做往返校验，不依赖真实样本）。
