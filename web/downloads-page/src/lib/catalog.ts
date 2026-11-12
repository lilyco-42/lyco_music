import type { DownloadRow, Item } from '../types'

export const PLATFORM_KEYS = ['windows', 'macos', 'android', 'ios', 'linux'] as const
export type Platform = (typeof PLATFORM_KEYS)[number] | 'unknown'

export const PLATFORM_LABELS: Record<string, string> = {
  windows: 'Windows', macos: 'macOS', ios: 'iPhone / iPad', android: 'Android', linux: 'Linux',
}

// 小白引导：每个设备只讲「该下哪种文件」和「下载后怎么装」。
export const DEVICE_INFO: Record<Platform, { label: string; file: string; how: string; tip: string }> = {
  windows: {
    label: 'Windows 电脑',
    file: '认准 .exe / .msi；.zip 要先解压',
    how: '双击文件 → 按提示点「下一步」→ 完成后看教程',
    tip: '如果提示「Windows 已保护你的电脑」，点「更多信息」→「仍要运行」。',
  },
  macos: {
    label: 'Mac 电脑',
    file: '认准 .dmg / .pkg；Apple Silicon 选 arm64',
    how: '双击 DMG → 把图标拖进「应用程序」→ 看教程',
    tip: '如果提示「无法打开，因为来自身份不明的开发者」，右键文件选「打开」。',
  },
  android: {
    label: '安卓手机',
    file: '认准 .apk；不是 .exe',
    how: '点开 APK → 允许「安装未知应用」→ 按提示安装',
    tip: '.gguf 是 AI 模型文件，不是软件安装包，不能直接点开安装。',
  },
  ios: {
    label: 'iPhone / iPad',
    file: '优先 App Store，点「获取」就行',
    how: '在 App Store 安装 → 回桌面打开 → 看教程',
    tip: '.ipa 是 iOS 应用包，未签名的 IPA 需要 AltStore / SideStore 侧载，小白别选。',
  },
  linux: {
    label: 'Linux 电脑',
    file: '.AppImage 免安装；.deb 用于 Ubuntu，.rpm 用于 Fedora',
    how: '下载后给执行权限 → 双击或命令行运行 → 看教程',
    tip: '不确定发行版时优先选 .AppImage，它最省心。',
  },
  unknown: {
    label: '没识别出设备',
    file: '先告诉我们你用的是电脑还是手机',
    how: '点「帮我选安装包」，手动选一个设备，我们按设备推荐',
    tip: '选错系统的安装包会打不开，下载前我们会再提醒一次。',
  },
}

export function detectDevice(): Platform {
  if (typeof navigator === 'undefined') return 'unknown'
  const nav = navigator as Navigator & { userAgentData?: { platform?: string }; platform?: string }
  const ua = (navigator.userAgent || '').toLowerCase()
  const hint = ((nav.userAgentData?.platform || '') + ' ' + (nav.platform || '') + ' ' + ua).toLowerCase()
  if (/iphone|ipad|ipod/.test(hint)) return 'ios'
  if (/android/.test(hint)) return 'android'
  if (/win32|win64|windows/.test(hint)) return 'windows'
  if (/macintosh|mac os x|macintel|macarm|mac os/.test(hint)) {
    // iPadOS 13+ 会伪装成 Mac，触点是唯一可靠线索。
    if ((navigator.maxTouchPoints || 0) > 1) return 'ios'
    return 'macos'
  }
  if (/linux|x11|cros|ubuntu|fedora/.test(hint)) return 'linux'
  return 'unknown'
}

export function sourceBadge(item: Item) {
  if (Array.isArray(item.downloads) && item.downloads.length) return { label: '多平台直链', tone: 'brand' as const }
  if (item.mirror) {
    if (/github[.]com/.test(item.mirror.url)) return { label: 'GitHub 直链 · 断点续传', tone: 'brand' as const }
    if (/dl[.]lilyco42[.]top|[.]workers[.]dev/.test(item.mirror.url)) return { label: 'Cloudflare R2', tone: 'brand' as const }
    return { label: '本站文件', tone: 'secondary' as const }
  }
  if (item.channel === '开发者测试') return { label: '开发者测试', tone: 'outline' as const }
  if (item.download_url) return { label: 'GitHub Release', tone: 'secondary' as const }
  if (item.channel === 'App Store') return { label: 'App Store', tone: 'outline' as const }
  return { label: item.channel || '官方站点', tone: 'outline' as const }
}

export function fmtVersion(v?: string) {
  if (!v) return ''
  return /^v/i.test(v) ? v : 'v' + v
}

export function fmtUpdated(iso?: string) {
  if (!iso) return ''
  if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(iso)) return iso
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
}

export interface FileInfo {
  ext: string
  label: string
  what: string
  how: string
  risk?: string
}

const FILE_TYPES: Array<[string, Omit<FileInfo, 'ext'>]> = [
  ['.exe', { label: 'EXE · Windows 安装程序', what: 'Windows 电脑用的安装程序，不是压缩包，也不是病毒文件。', how: '下载后双击，按提示点「下一步」即可；文件名带 portable 的是免安装版，双击直接运行。' }],
  ['.msi', { label: 'MSI · Windows 安装包', what: '也是 Windows 安装包，常给公司电脑批量部署用。', how: '双击按提示安装；普通用户选 EXE 更直观。' }],
  ['.zip', { label: 'ZIP · 压缩包', what: '里面装着一个或几个程序文件，需要先解压。', how: '右键「全部提取 / 解压」→ 打开解压后的文件夹 → 运行里面的 EXE 或说明里的程序。' }],
  ['.7z', { label: '7Z · 压缩包', what: '压缩率更高的压缩包，需要先解压。', how: '先装 7-Zip，再右键解压，运行里面的程序。' }],
  ['.dmg', { label: 'DMG · Mac 安装映像', what: 'macOS 的安装光盘映像，Windows 打不开。', how: '双击打开 → 把软件图标拖进「应用程序」文件夹 → 推出 DMG。' }],
  ['.pkg', { label: 'PKG · Mac 安装包', what: 'macOS 的向导式安装包。', how: '双击后一路「继续 / 同意 / 安装」，需要输入开机密码。' }],
  ['.apk', { label: 'APK · 安卓安装包', what: '安卓手机的安装包，电脑和 iPhone 都不能直接装。', how: '手机上点开 APK → 允许「安装未知应用」→ 点安装。' }],
  ['.ipa', { label: 'IPA · iOS 应用包', what: 'iPhone / iPad 的应用包。本站的是未签名测试包，不能像普通 App 那样直接装。', how: '需要 AltStore / SideStore / TrollStore 侧载，或用你自己的开发者证书重签。', risk: '小白请改选 App Store 版本；未签名 IPA 直接双击是装不上的。' }],
  ['.appimage', { label: 'AppImage · Linux 免安装', what: 'Linux 上下载就能运行的单文件程序，不用安装。', how: '右键属性勾「允许作为程序执行」，或在终端 chmod +x 文件名后双击。' }],
  ['.deb', { label: 'DEB · Ubuntu / Debian 安装包', what: '给 Ubuntu、Debian、Deepin 等系统用的安装包。', how: '双击用软件中心打开，或 sudo dpkg -i 文件名。' }],
  ['.rpm', { label: 'RPM · Fedora / openSUSE 安装包', what: '给 Fedora、openSUSE、RHEL 系系统用的安装包。', how: '双击用软件中心打开，或 sudo rpm -i 文件名。' }],
  ['.tar.gz', { label: 'TAR.GZ · Linux 压缩包', what: '命令行工具常见的压缩包，不是双击安装的软件。', how: '解压后按软件说明运行里面的可执行文件，或看使用教程。' }],
  ['.gz', { label: 'GZ · 压缩文件', what: '压缩过的文件或数据，不是安装包。', how: '先解压，再看对应教程使用它。' }],
  ['.gguf', { label: 'GGUF · AI 模型文件', what: '这是模型权重，不是软件安装包，手机点它不会安装任何东西。', how: '把它导入支持 GGUF 的应用（如 llama.cpp / Ollama / LM Studio）后才能用。', risk: '这不是 App：没有 App 可以「安装」它，请先装好能加载模型的软件。' }],
]

export function fileInfoForFile(file: string): FileInfo {
  const f = (file || '').toLowerCase()
  for (const [suffix, info] of FILE_TYPES) {
    if (f.endsWith(suffix)) return { ext: suffix.replace('.', '').toUpperCase(), ...info }
  }
  if (!f.trim()) return { ext: '官网', label: '官网安装包', what: '这类软件由官网自动识别你的系统，给你对应的安装包。', how: '点「前往官网下载」→ 在官网点下载按钮 → 回来对照教程安装。' }
  return { ext: '文件', label: '软件文件', what: '这是该软件的安装文件或压缩包。', how: '下载后按详情页里的说明安装，或直接看使用教程。' }
}

export const FILE_GLOSSARY: FileInfo[] = [
  { ext: 'App Store', label: 'App Store · 应用商店', what: '不用下载文件，苹果应用商店会自动安装到 iPhone / iPad。', how: '点「前往 App Store」→「获取」→ Face ID 确认 → 回桌面打开。' },
  ...FILE_TYPES.map(([suffix, info]) => ({ ext: suffix.replace('.', '').toUpperCase(), ...info })),
  { ext: '官网', label: '官网安装包', what: '官网会自动识别你的系统，给你对应的安装包。', how: '点「前往官网下载」→ 在官网点下载 → 回来对照教程安装。' },
].slice(0, 16)

export function fileInfo(item: Item, file?: string): FileInfo {
  const explicit = (file || '').toLowerCase()
  const f = (explicit || item.mirror?.file || '').toLowerCase()
  if (item.channel === 'App Store' && !explicit) {
    return { ext: 'App Store', label: 'App Store · 应用商店', what: '不用下载文件，苹果应用商店会自动安装到你的 iPhone / iPad。', how: '点「前往 App Store」→ 点「获取」→ 用 Face ID 确认 → 回桌面打开。' }
  }
  if (f) return fileInfoForFile(f)
  if (Array.isArray(item.downloads) && item.downloads.length) {
    return { ext: '多版本', label: '多个系统版本', what: '同一个软件为 Windows / Mac / Linux 分别打包了不同文件。', how: '点「选版本」，按你的设备和芯片选一行，再下载。' }
  }
  return { ext: '官网', label: '官网安装包', what: '这类软件由官网自动识别你的系统，给你对应的安装包。', how: '点「前往官网下载」→ 在官网点下载按钮 → 回来对照教程安装。' }
}

const BAD_SUFFIX: Record<string, string[]> = {
  windows: ['.dmg', '.pkg', '.apk', '.ipa', '.appimage', '.deb', '.rpm'],
  macos: ['.exe', '.msi', '.apk', '.ipa', '.appimage', '.deb', '.rpm'],
  android: ['.exe', '.msi', '.dmg', '.pkg', '.ipa', '.appimage', '.deb', '.rpm'],
  ios: ['.exe', '.msi', '.dmg', '.pkg', '.apk', '.appimage', '.deb', '.rpm'],
  linux: ['.exe', '.msi', '.dmg', '.pkg', '.apk', '.ipa'],
}

const HINT_PATTERNS: Array<[Platform, RegExp]> = [
  ['windows', /windows|win64|win32|win[-_ ]?x|msvc/i],
  ['macos', /macos|mac os|mac |darwin|apple silicon|aarch64-apple/i],
  ['android', /android|arm64-v8a/i],
  ['ios', /ios|iphone|ipad/i],
  ['linux', /linux|glibc|musl|appimage|[.]deb|[.]rpm/i],
]

export function compatibility(item: Item, device: Platform, file?: string, hint?: string): { ok: boolean; reason: string } {
  if (device === 'unknown') return { ok: true, reason: '' }
  const label = DEVICE_INFO[device].label
  const f = (file || hint || item.mirror?.file || '').toLowerCase()
  const info = fileInfo(item, file)

  if (info.ext === 'GGUF') {
    return { ok: false, reason: '这不是安装包：.gguf 是 AI 模型权重文件，点开不会安装任何软件。' + DEVICE_INFO[device].tip }
  }
  if (info.risk && info.ext === 'IPA') {
    return { ok: false, reason: info.risk }
  }
  if (item.platforms?.length && !item.platforms.includes(device)) {
    return { ok: false, reason: '检测到你正在用「' + label + '」，但「' + item.name + '」没有这个平台的版本，装上也打不开。' }
  }
  for (const suffix of BAD_SUFFIX[device] || []) {
    if (f.endsWith(suffix)) {
      return { ok: false, reason: '检测到你正在用「' + label + '」，但这个文件是 ' + suffix + '（' + info.label + '），在你的设备上通常打不开。' }
    }
  }
  if (hint) {
    for (const [p, re] of HINT_PATTERNS) {
      if (p !== device && re.test(hint)) {
        return { ok: false, reason: '这一行写的是「' + hint + '」，是给 ' + PLATFORM_LABELS[p] + ' 用的；你当前识别为「' + label + '」。' }
      }
    }
  }
  return { ok: true, reason: '' }
}

// 只挑小白能一次装成功、且有教程或明确官方入口的条目。
export const RECOMMENDATIONS: Record<Platform, Array<{ id: string; why: string }>> = {
  windows: [
    { id: 'lyco-music-windows', why: 'Lyco Music 安装版：EXE 双击安装，配完整图文教程' },
    { id: 'rembg-studio-windows', why: '批量抠图：ZIP 解压后用，带专门的新手教程' },
    { id: 'clash-verge-rev', why: '代理客户端：EXE 安装，配合代理入门教程导入订阅' },
    { id: '7zip', why: '解压工具：先装它，以后遇到 ZIP / 7Z 都能打开' },
  ],
  macos: [
    { id: 'lyco-music-macos', why: 'Lyco Music：DMG 拖进「应用程序」，有图文教程' },
    { id: 'clash-verge-mac', why: '代理客户端 Mac 版：按芯片选 arm64 或 x64' },
    { id: 'raycast-mac', why: '效率启动器：官网会自动给你 Mac 版' },
    { id: 'iina-mac', why: '视频播放器：Mac 原生，官网一键下载' },
  ],
  android: [
    { id: 'lyco-music-android', why: 'Lyco Music：APK 点开就装，有图文教程' },
    { id: 'clashmi', why: '代理客户端 APK：装完按教程导入订阅' },
    { id: 'nekobox', why: '代理客户端 APK：arm64 手机通用' },
    { id: 'cute-pet', why: '桌宠 APK：下载后点开安装即可' },
  ],
  ios: [
    { id: 'signal-ios', why: 'App Store 直接「获取」，最省事' },
    { id: 'chrome-ios', why: 'App Store 浏览器，不用碰任何安装文件' },
    { id: 'localsend-ios', why: 'App Store 互传工具，和电脑传文件很方便' },
    { id: 'lyco-music-ios', why: '未签名 IPA：只给会侧载的开发者，小白别选' },
  ],
  linux: [
    { id: 'lyco-music-linux', why: 'AppImage：给执行权限后直接运行，有教程' },
    { id: 'cc-switch', why: '多版本打包：点「选版本」按发行版挑 DEB / RPM' },
    { id: 'claude-code', why: '多版本打包：按 glibc / musl 选对应行' },
    { id: 'android-platform-tools', why: 'Google 官方命令行工具，下载后解压使用' },
  ],
  unknown: [],
}

export function generalGuide(item: Item): { href: string; label: string } {
  if (item.guide) return { href: item.guide, label: item.guideLabel || '使用教程' }
  const text = [item.name, item.summary, item.category, item.id].join(' ').toLowerCase()
  if (/抠图|rembg/.test(text)) return { href: '/downloads/rembg/index.html', label: '批量抠图教程' }
  if (/代理|节点|clash|vpn|v2ray|nekobox|订阅|wireguard/.test(text)) return { href: '/proxy-guide/', label: '代理入门教程' }
  if (/lyco music|音乐/.test(text)) return { href: '/docs/lyco-music.html', label: 'Lyco Music 教程' }
  if (/api|模型|token|中转/.test(text)) return { href: '/docs/', label: 'AI 网关使用文档' }
  return { href: '/help.html', label: '新手帮助 · 常见问题' }
}

export function rowHint(row: DownloadRow) {
  return [row.platform, row.file || '', row.note || ''].join(' ')
}
