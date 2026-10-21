# 发版手册（含 CI 卡住时的本地兜底）

> 这份文档写给「明天要发版的人」。正常路径只有一条，但 2026-10-22 实测过
> GitHub Actions 的 Release 运行会长时间 queued 不动 —— 那时唯一能把包送到
> 用户手里的办法是在本机构建 + 手工上传。步骤都记在下面，照着做即可。

## 0. 版本号只有一个真相

```bash
pnpm bump 0.2.42        # 一次改完 12 个声明点（含 Android versionCode、iOS CURRENT_PROJECT_VERSION）
pnpm test               # tests/version-consistency 会校验每一处
```

不要手改任何 package.json / build.gradle / pbxproj。

## 1. 正常路径

```bash
git add -A && git commit -m "chore(release): 0.2.42"
git push origin main
```

- `release.yml` 触发条件：push 到 main 且 `package.json` 变化，或推 `v*` tag
- 五个平台并行构建（每个都 `continue-on-error`），最后 `Publish GitHub Release`
- 发布前有守卫：**一个产物都没有就失败**，不会像 0.2.42 那样发一个空 Release
- 发布后自动 `scp` 到 lain42.top 并跑 `publish-downloads.py`

### 并发组的坑

`concurrency.group: release-${{ github.ref }}` + 只保留一个 pending：
**连续 bump 版本号会把排队中的运行顶掉**。发版期间不要再推带 package.json 的提交。

## 2. CI 卡住时的本地兜底

先确认是不是真的卡住：`gh run list` 或看 Actions 页面。如果运行一直是 queued
（超过 30 分钟没有任何 job 启动），本机兜底能救 Windows 与 Android。

### 2.1 Windows（msi / setup.exe / portable）

```powershell
cd apps/desktop
pnpm build                       # 必须！electron-builder 只打包 dist/ 里的内容
$env:CSC_IDENTITY_AUTO_DISCOVERY='false'
node ../../node_modules/electron-builder/cli.js --win --publish never
# 产物在 apps/desktop/release/：
#   Lyco.Music-<ver>-windows-x64.msi
#   Lyco.Music-<ver>-windows-setup.exe
#   Lyco.Music-<ver>-windows-x64-portable.exe
```

### 2.2 Android（apk）

需要 JDK 17+ 与 Android SDK（`ANDROID_HOME`）。

```powershell
cd apps/mobile/android
$env:LXMN_VERSION_CODE='2042'    # = major*1e6 + minor*1e3 + patch
$env:LXMN_VERSION_NAME='0.2.42'
.\gradlew.bat assembleRelease --no-daemon
# 产物：app/build/outputs/apk/release/app-release.apk
```

没有 `LXMN_KEYSTORE_PATH` 时会用仓库里的 `debug.keystore` 签名：**能装，但不是发布签名**，
升级覆盖安装可能会因为签名不一致失败。正式包请配好四个环境变量再构建。

### 2.3 macOS / iOS / AppImage

本机（Windows）做不了，必须等 CI 或另找 macOS/Linux 机器。发版说明里要如实写清
「这几个平台停在 vX.Y.Z」。

## 3. 手工上传 + 登记下载页

```bash
TAG=v0.2.42-20261022
ssh lain42.top "mkdir -p /var/www/studio/downloads/lyco_music/$TAG"
scp release/Lyco.Music-0.2.42-windows-* lain42.top:/var/www/studio/downloads/lyco_music/$TAG/
ssh lain42.top "cd /var/www/studio/downloads/lyco_music/$TAG && sha256sum * > SHA256SUMS && ls -lh"

# 登记进下载页（幂等，可重复跑）
scp scripts/publish-downloads.py lain42.top:/tmp/
ssh lain42.top "cd /tmp && python3 publish-downloads.py $TAG"
```

### 校验

```powershell
# 直链必须 200，且长度与本地文件一致
Invoke-WebRequest -Uri "https://lain42.top/downloads/lyco_music/$TAG/<file>" -Method Head -UseBasicParsing

# 下载页读的是 manifest.json，静态 HTML 里搜版本号是搜不到的
(Invoke-RestMethod "https://lain42.top/downloads/manifest.json").items |
  Where-Object { $_.release -eq "v0.2.42-20261022" } |
  Select-Object id, version, @{n='file';e={$_.mirror.file}}
```

## 4. 磁盘

服务器只有 40G。历史版本每个约 640MB（六平台），保留 3 个即可：

```bash
ssh lain42.top "ls -1t /var/www/studio/downloads/lyco_music | tail -n +4 | xargs -I{} rm -rf /var/www/studio/downloads/lyco_music/{}"
df -h /
```

低于 1GB 空闲时 release.yml 会直接失败（有守卫），所以清理要在发版前做，而不是发版时。

## 5. 已知坑

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| Release 卡片只有 6 个文件 | 某几个平台构建失败（continue-on-error） | 看 job 日志；补发一次即可 |
| 发布了零资产 Release | 全平台失败 + `if: always()` | 已加守卫；若历史上有空 Release，只能手删 |
| 排队运行互相顶掉 | 同一 concurrency 组只保留一个 pending | 发版期间别再推 package.json |
| 下载页搜不到新版本 | 页面读 manifest.json，不是静态 HTML | 检查 manifest 里是否有该 release |
| Android 升级提示签名不一致 | 用 debug.keystore 签的 | 配 `LXMN_KEYSTORE_*` 重新构建 |
