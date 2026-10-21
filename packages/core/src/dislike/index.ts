/**
 * 「不喜欢的歌曲」规则
 *
 * 移植自 lx-music-desktop 的 `store/dislikeList/action.ts`（v2.12.6），
 * 但去掉了 Vue 的 `markRaw` 依赖 —— 内核要能在桌面、RN、Node 测试里跑。
 *
 * 规则文本格式（与 lx 完全兼容，用户从 lx 导出的规则可以直接粘进来）：
 *
 *   歌曲名@艺术家   只屏蔽这一首
 *   歌曲名          屏蔽所有叫这个名字的歌
 *   @艺术家         屏蔽这个艺术家的所有歌
 *
 * 歌曲名里如果本来就有 `@`，用 `#` 代替 —— 否则没法区分哪一个是分隔符。
 * 解析时统一把 `@` 还原成 `#` 再比较，所以规则里写 `A@B` 与数据里
 * 歌名 `A#B`、艺术家 `C` 能正确对上。
 *
 * 匹配是**整串**比较，不做分词：规则写 `千里之外@周杰伦`，
 * 而歌曲的 singer 是 `周杰伦/费玉清` 时不会命中 —— 这一点与 lx 一致。
 * 想屏蔽合唱曲目，规则要写成 `千里之外` 或 `@费玉清`。
 * 不做「包含」匹配是刻意的：`@周` 会把「周杰伦」「周深」「周华健」全屏蔽掉。
 */

/** 规则分隔符：歌曲名@艺术家 */
export const DISLIKE_SPLIT = '@'
/** 歌名里出现 `@` 时的转义字符 */
export const DISLIKE_ALIAS = '#'

/** 参与匹配的最小信息 —— MusicItem / 下载任务 / 搜索结果都能直接传 */
export interface DislikeTarget {
  name?: string
  singer?: string
}

export interface DislikeIndex {
  /** `歌名@艺术家` 形式的精确规则 */
  readonly names: ReadonlySet<string>
  /** 只写了歌名的规则 */
  readonly musicNames: ReadonlySet<string>
  /** 只写了艺术家的规则（`@艺术家`） */
  readonly singerNames: ReadonlySet<string>
  /** 归一化后的规则行，保持用户书写顺序、已去重 */
  readonly lines: readonly string[]
  /** 三类规则条数之和 */
  readonly count: number
}

const EMPTY_INDEX: DislikeIndex = {
  names: new Set(),
  musicNames: new Set(),
  singerNames: new Set(),
  lines: [],
  count: 0,
}

/**
 * 归一化：`@` → `#`，转小写，去首尾空白。
 *
 * 用 `toLowerCase` 而不是 `toLocaleLowerCase` —— 后者在土耳其语等
 * locale 下会把 `I` 变成 `ı`，同一份规则在两端可能得出不同结果。
 */
function norm(value: unknown): string {
  return String(value ?? '')
    .replaceAll(DISLIKE_SPLIT, DISLIKE_ALIAS)
    .toLowerCase()
    .trim()
}

/**
 * 解析规则文本。
 *
 * 非法行（例如只写了 `@`）直接丢弃，不报错 —— 规则是用户手输的，
 * 输入到一半时必然出现半截内容，弹错误提示只会打断他。
 */
export function parseDislikeRules(text: string | null | undefined): DislikeIndex {
  const raw = typeof text === 'string' ? text : ''
  if (!raw.trim()) return EMPTY_INDEX

  const names = new Set<string>()
  const musicNames = new Set<string>()
  const singerNames = new Set<string>()
  const lines: string[] = []
  const seen = new Set<string>()

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue

    const at = line.indexOf(DISLIKE_SPLIT)
    let name = ''
    let singer = ''
    if (at < 0) {
      name = norm(line)
    } else {
      name = norm(line.slice(0, at))
      singer = norm(line.slice(at + 1))
    }

    let key = ''
    if (name && singer) {
      key = `${name}${DISLIKE_SPLIT}${singer}`
      names.add(key)
    } else if (name) {
      key = name
      musicNames.add(key)
    } else if (singer) {
      key = `${DISLIKE_SPLIT}${singer}`
      singerNames.add(singer)
    } else {
      continue
    }

    if (seen.has(key)) continue
    seen.add(key)
    lines.push(key)
  }

  return {
    names,
    musicNames,
    singerNames,
    lines,
    count: names.size + musicNames.size + singerNames.size,
  }
}

/** 这首歌是否命中「不喜欢」规则 */
export function hasDislike(
  index: DislikeIndex | null | undefined,
  target: DislikeTarget | null | undefined,
): boolean {
  if (!index || !target) return false
  if (!index.count) return false

  const name = norm(target.name)
  const singer = norm(target.singer)
  if (!name && !singer) return false

  if (name && index.musicNames.has(name)) return true
  if (singer && index.singerNames.has(singer)) return true
  return index.names.has(`${name}${DISLIKE_SPLIT}${singer}`)
}

/**
 * 把一首歌转成一条规则文本（`歌名@艺术家`）。
 * 任一字段为空时退化成单边规则，与 lx 的「右键不喜欢」行为一致。
 */
export function ruleOf(target: DislikeTarget): string {
  const name = norm(target.name)
  const singer = norm(target.singer)
  if (name && singer) return `${name}${DISLIKE_SPLIT}${singer}`
  if (name) return name
  if (singer) return `${DISLIKE_SPLIT}${singer}`
  return ''
}

/**
 * 往规则文本里追加若干首歌，返回新的文本。
 *
 * 返回的是**归一化后**的整份规则（小写、去重、保序），
 * 而不是「原文本 + 新行」—— 否则用户重复点两次「不喜欢」
 * 就会在编辑器里看到两行一模一样的东西。
 */
export function addDislikeRules(
  text: string | null | undefined,
  targets: readonly DislikeTarget[],
): string {
  const lines = [...parseDislikeRules(text).lines]
  const seen = new Set(lines)
  for (const target of targets) {
    const rule = ruleOf(target)
    if (!rule || seen.has(rule)) continue
    seen.add(rule)
    lines.push(rule)
  }
  return lines.join('\n')
}

/** 从规则文本里移除一首歌对应的规则，返回新的文本 */
export function removeDislikeRule(
  text: string | null | undefined,
  target: DislikeTarget,
): string {
  const rule = ruleOf(target)
  if (!rule) return parseDislikeRules(text).lines.join('\n')
  return parseDislikeRules(text)
    .lines.filter(line => line !== rule)
    .join('\n')
}

/** 规则文本 → 数组（同步用，一行一条） */
export function ruleLines(text: string | null | undefined): string[] {
  return [...parseDislikeRules(text).lines]
}

/** 数组 → 规则文本（同步回来时用） */
export function linesToRules(lines: readonly string[] | null | undefined): string {
  return parseDislikeRules(Array.isArray(lines) ? lines.join('\n') : '').lines.join('\n')
}

/**
 * 合并两份规则文本，取并集并保持顺序（本地在前）。
 *
 * 两台设备各屏蔽了一些歌，同步后应该都保留 —— 与收藏的合并策略一致。
 * 交换律成立（merge(a,b) 与 merge(b,a) 得到同一集合，只是顺序可能不同），
 * 所以谁先同步不影响最终「屏蔽了哪些歌」。
 */
export function mergeRuleText(a: string | null | undefined, b: string | null | undefined): string {
  return addDislikeRules(a, ruleLines(b).map(line => {
    const at = line.indexOf(DISLIKE_SPLIT)
    return at < 0
      ? { name: line }
      : { name: line.slice(0, at), singer: line.slice(at + 1) }
  }))
}
