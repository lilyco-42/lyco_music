# Lyco Music 技术与设计规范

> 版本：0.2.14 · 适用范围：`apps/desktop`（Vue 3 + Electron）、`apps/mobile`（React Native）、`packages/core`
> 这份文档是**约定的来源**：写新组件、改样式、调图标之前先看这里；和文档不一致的代码视为待修。

---

## 1. 技术栈

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 桌面壳 | Electron 33（`frame: false`） | 自绘窗口控件，见 `components/layout/WindowControls.vue` |
| 桌面 UI | Vue 3 + Vite + Tailwind CSS v4 | 令牌在 `src/styles/main.css` 的 `@theme` |
| 移动 UI | React Native 0.76 | 与桌面共用 `@lxmn/core` |
| 内核 | `@lxmn/core`（纯 TS，零 DOM） | 音源、歌词解析、曲库、订阅、脚本运行时 |
| 组件原语 | reka-ui（无障碍）+ 自研轻量件 | Tabs 用 reka-ui；Menu/IconButton 自研，行为可枚举 |
| 图标 | `lucide-vue-next` | 统一描边，不用内联手绘 SVG |

### 分层与依赖方向

```
apps/*  ──►  packages/platform-*  ──►  packages/core
```

* `core` **不得**出现 DOM / `window` / `process`（移动端 `types: []` 会在 CI 直接暴露违规）。
* 平台差异（网络、存储、加密）通过 `setPlatform(adapter)` 注入，不在业务代码里判断平台。
* 组件不得直接 import `@lxmn/core` 的内部文件，只能从包入口取。

---

## 2. 设计令牌

所有数值集中在 `src/styles/main.css` 的 `@theme`，组件里**只允许引用令牌**，不允许再写死 `#d43b52`、`16px` 这类字面量（图标尺寸见 §4）。

### 2.1 颜色

浅色（主界面）与深色（播放器模式）是两套，命名前缀区分：`ncm-*` / `ncmd-*`。

| 语义 | 浅色令牌 | 深色令牌 |
| --- | --- | --- |
| 背景 | `--color-ncm-bg` | `--color-ncmd-bg` |
| 表面/卡片 | `--color-ncm-topbar` `-bottombar` | `--color-ncmd-surface` `-elevated` |
| 主文字 | `--color-ncm-fg` (#252d42) | `--color-ncmd-fg` (#eeeeee) |
| 次文字 | `--color-ncm-muted` / `-faint` / `-fainter` | `--color-ncmd-muted` / `-dim` / `-darker` |
| 强调 | `--color-ncm-accent*` | `--color-ncmd-accent` |
| 分割线 | `--color-ncm-divider` | `--color-ncmd-elevated` |

**对比度**：正文与背景 ≥ 4.5:1，次要文字 ≥ 3:1。`-fainter` 只用于「不可交互的提示」，不得承载关键信息。

### 2.2 尺寸

| 令牌 | 值 | 用途 |
| --- | --- | --- |
| `--spacing-sidebar` | 255px | 左栏宽 |
| `--spacing-topbar` | 94px | 顶栏高 |
| `--spacing-bottombar` | 102px | 底栏高 |
| `--radius-nav` | 10px | 导航行、图标按钮 |
| `--radius-search` | 11px | 搜索框 |
| `--radius-cover` | 7px | 专辑封面缩略图 |
| `--radius-tab` | 21px | 页签胶囊 |
| `--radius-pill` | 24px | 状态胶囊 |

### 2.3 字号阶梯

| 场景 | 字号 / 行高 |
| --- | --- |
| 页面标题 | 26 / 34 |
| 区块标题 | 24 / 32 |
| 歌曲名（播放页） | 35 / 44 |
| 列表主文案 | 16 / 24 |
| 正文/按钮 | 14–15 / 22 |
| 辅助说明 | 13 / 20 |
| 标签/角标 | 11 / 16 |

行高统一取字号的 1.35–1.45 倍；**不要**用 `leading-tight` 处理中文长句。

---

## 3. 间距与布局

* 4px 基准栅格：`4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48`（Tailwind 的 `1/2/3/4/5/6/8/10/12`）。
* 页面左右内边距 **49px**（`main` 的 `px-[49px]`），区块上下间距 38–47px。
* **顶栏贴边**：窗口按钮（最小化/最大化/关闭）距窗口右缘 **≤ 4px**，顶栏用 `pl-6 pr-1`；
  原来 `px-7`/`px-[52px]` 让控件离边 50px 以上，视觉上「飘在中间」。
* **播放页纵向节奏**：标题→歌手 8px、歌手→专辑信息 6px、信息→页签 28px、页签→歌词 24px；
  歌词行距 14px（当前行 18px）。原来 57/96/23px 会造成「上下都空一大截」。
* 列表行高：搜索结果 62px，歌单行 44–48px。
* 内容区必须能滚动：滚动容器要有**确定高度**（`min-h-0 flex-1 overflow-y-auto`），否则 `h-full` 会塌成 0——歌词区曾因此「渲染不全」。

---

## 4. 图标规范

尺度取 Material Design 的 4 档 + Apple HIG 的命中区思路。

| 令牌 | 尺寸 | 典型场景 |
| --- | --- | --- |
| `--icon-sm` | 16px | 行内元信息、列表小图标 |
| `--icon-md` | 18px | 列表操作、搜索框内图标 |
| `--icon-lg` | 20px | 侧栏导航、顶栏、页签 |
| `--icon-xl` | 22px | 次级传输控制 |
| `--icon-2xl` | 26px | 上一首 / 下一首 |
| `--icon-stroke` | 1.8 | 全局描边 |

命中区（可点区域，与图标大小解耦）：

| 令牌 | 值 | 场景 |
| --- | --- | --- |
| `--control-hit` | 36px | 普通图标按钮 |
| `--control-hit-lg` | 44px | 主操作、窗口控制、播放页顶栏 |

规则：

1. 纯图标按钮**必须**用 `components/ui/IconButton.vue`，它强制 `aria-label`、统一 hover / focus-visible / disabled。
2. 不要内联手绘 `<svg path>`——需要新图标就从 lucide 取，取不到再提需求。
3. 同一排图标只允许同一档尺寸；图标与文字基线居中对齐（`items-center`）。
4. **坑**：自定义组件若 `$emit('click')`，必须显式 `defineEmits(['click'])`，否则父组件的 `@click` 会同时作为原生监听器挂到根元素，一次点击触发两次（播放模式曾因此一次跳两档）。

---

## 5. 组件规范

### 5.1 通用要求

* **状态齐全**：默认 / hover / active / focus-visible / disabled / loading。
* **无障碍**：交互元素可 Tab 到；纯图标按钮有 `aria-label`；弹层有 `aria-haspopup` + `aria-expanded`；列表项用 `role="menuitemradio"` 等语义角色。
* **键盘**：Esc 关闭弹层，↑/↓ 移动，Enter 确认。
* **不重复实现**：已有 `IconButton` / `Menu` / `Tabs`，新页面直接复用。

### 5.2 组件清单

| 组件 | 路径 | 约定 |
| --- | --- | --- |
| IconButton | `components/ui/IconButton.vue` | `label` 必填；`size` md/lg/xl/2xl；`hit` md/lg；`tone` light/dark |
| Menu | `components/ui/Menu.vue` | 单选下拉；`items` 为 `MenuItem[]`；受控 `modelValue` |
| Tabs | `components/ui/tabs/*` | 基于 reka-ui；页签容器 222×42、圆角 21px |
| WindowControls | `components/layout/WindowControls.vue` | 46×32 × 3；关闭键 hover 变 `#c42b1c` |
| QualityMenu | `components/layout/QualityMenu.vue` | 音质下拉，列出音源真实支持的档位 |

### 5.3 业务组件

* `TopBar`：返回 / 搜索 / 语音（禁用）/ 账户 / 主题色 / 窗口控制；整条是 `app-region: drag`，交互元素全部 `no-drag`。
* `PlayBar`：封面（点击进播放页）→ 曲名歌手 → 传输控制（循环/上下首/播放/列表）→ 音质下拉 / 词 / 音量 / 更多。
* `Player`：左黑胶右歌词；歌词区**有界滚动**且自动居中当前行。

### 5.4 空态与加载

* 空态必须有插画（`public/art/empty-*.jpg`）+ 一句可执行的提示，不能只留空白。
* 加载用文字或骨架，不用转圈图标硬凑——**禁用**「永远转圈」状态：拿不到数据要落到空态。
  例：纯文本歌词以前解析出 0 行，界面卡在「歌词解析中…」；现在 `parseLrc` 返回 `plain: true` 静态展示。

---

## 6. 交互规范

| 动作 | 行为 |
| --- | --- |
| 单击列表行 | 选中 |
| 双击 / 行内播放键 | 播放 |
| 点击封面（底栏） | 进入播放页 |
| 点击「词」 | 开关桌面歌词浮层（不跳页） |
| 点击音质 | 展开下拉选择 |
| 点击循环图标 | 顺序 → 列表循环 → 单曲循环 → 随机（一次一档） |

### 快捷键（`src/lib/hotkeys.ts`）

| 按键 | 功能 |
| --- | --- |
| `Space` | 播放 / 暂停 |
| `←` / `→` | 快退 / 快进 5 秒 |
| `Ctrl/⌘ + ←` / `→` | 上一首 / 下一首 |
| `M` | 静音开关 |
| `L` | 桌面歌词浮层 |
| `Ctrl/⌘ + K` | 聚焦搜索框 |

约束：焦点在 `input/textarea/select/contenteditable` 内不抢键；快捷键必须对应界面上真实存在的操作。

---

## 7. 主题机制

* 颜色变量分「结构色」与「强调色」。主题只覆盖**强调色**：`--color-ncm-accent`、`-accent-nav`、`-accent-play`、`-progress`、`--color-ncmd-accent`。
* 预设见 `src/lib/theme.ts`（网易红/清青/静谧蓝/暮紫/暖橙/樱粉），选择写入 `localStorage['lxmn.theme.accent']`。
* 启动时 `initTheme()` 在挂载前应用，避免首屏闪默认色。
* **不要**用主题变量承载语义色（错误红、成功绿另设令牌）。

---

## 8. 播放与音源规范

* 取流顺序：`内置源 → 脚本源池 → 跨源相似匹配`，全程静默，不弹「已切换音源」。
* 已知平台缺陷必须在内核兜底，不允许在 UI 层判断：
  * 酷狗 VIP 卡段（`Privilege/PayType`）→ 搜免费版本；
  * 酷我 `588957081.mp3` 占位 → 判为不可播；
  * 酷狗封面 `{size}` 模板 → 强制展开成 `480`；
  * 咪咕错误负载 → 只有确定是 JSON 才判不可播，2 字节 Range 探测不预下载。
* 歌词 / 封面失败**不得**阻断播放。

---

## 9. 代码约定

### 9.1 命名

* 组件文件 PascalCase；组合式函数 `useXxx`；纯函数动词开头。
* CSS 只用 Tailwind 原子类 + 令牌；确实需要自定义时写进 `main.css`，不要 `<style scoped>` 里堆魔法数。
* 注释写「为什么」，不写「做了什么」——代码已经说明做了什么。

### 9.2 提交

```
<type>(<scope>): <一句话说明>

- 具体改动 1（为什么）
- 具体改动 2（为什么）
```

`type`：feat / fix / chore / docs / refactor / test。一个提交只做一件事。

### 9.3 质量门

合并前必须全绿：

```bash
pnpm --filter @lxmn/core exec tsc --noEmit
node ./node_modules/vue-tsc/bin/vue-tsc.js --noEmit -p apps/desktop/tsconfig.json
node ./node_modules/typescript/bin/tsc -p apps/mobile/tsconfig.json --noEmit
node ./node_modules/vitest/vitest.mjs run
```

涉及界面的改动，必须用 CDP 打开真实窗口截图确认（不能只看代码推断）。

### 9.4 版本

* 版本号只在根 `package.json` 维护；`tests/version-consistency.test.ts` 会校验子包、`CORE_VERSION`、Android `build.gradle`、iOS `pbxproj` 全部一致。
* 发版：`git tag vX.Y.Z && git push origin vX.Y.Z`，Release 工作流自动产出 msi/exe/dmg/apk/ipa/AppImage。

---

## 10. 借鉴 betterNCM 的取舍

betterNCM 是网易云客户端的插件加载器，值得借鉴的是它的**可扩展性设计**，不适合照搬的是它直接往宿主页面注入 DOM 的做法（升级即碎）。

| 能力 | 我们的做法 | 状态 |
| --- | --- | --- |
| 主题/皮肤 | 强调色令牌化 + 运行时切换（`lib/theme.ts`） | ✅ 已实现 |
| 快捷操作 | 全局快捷键注册表（`lib/hotkeys.ts`） | ✅ 已实现 |
| 桌面歌词 | 底栏浮层（`lyricOpen` 存于 store，按钮与 L 键共享） | ✅ 已实现 |
| 插件化音源 | lx 脚本运行时 + 音源池（`sources/lxscript`） | ✅ 已实现 |
| 插件 API/事件钩子 | 预留：在 `core` 暴露 `onBeforePlay/onLyric/onUIReady` 钩子后再做插件市场 | ⏳ 待做 |
| 注入式 UI 改造 | **不做**：改为自建组件 + 令牌，避免依赖宿主 DOM 结构 | ❌ 明确放弃 |

---

## 11. 待办（按优先级）

1. `Search` 行高/列宽、`MyMusic`/`Friends`/`Sync` 三页的空态与按钮规格尚未按本规范收一遍。
2. 插件钩子（`onBeforePlay` 等）与插件清单 UI。
3. 深色主题目前只覆盖播放页，主界面深色需要补一套 `ncm-*` 的暗色映射。
