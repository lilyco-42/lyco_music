/**
 * 静默取流兜底（内核版）
 *
 * 目标只有一个：**让用户听到歌**，并且全程不打扰他。
 *
 * 桌面端还有一层「第三方脚本池」，那是宿主能力（要读写用户配置的脚本文件），
 * 不属于内核。这里只做两端都能做的事：
 *   1. 原音源按请求音质取流（内核内部已逐档降音质）；
 *   2. 不行就跨音源搜同一首歌 —— 网易 VIP / 没版权的曲目去酷狗酷我咪咕找正主；
 *   3. 都不行才把原始错误抛出去。
 *
 * 匹配规则必须严：宁可报错，也不要串到翻唱或同名歌。
 * 用户点的是周杰伦，播出来一个翻唱比放不出来更让人恼火。
 */
import { getSource, hasSource } from './sources/registry'
import type { MusicItem, MusicUrlInfo, Quality, SourceId } from './types'

/** 归一化标题：去括号补充、去标点空格、小写 */
export function normTitle(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[（(【[].*?[）)】\]]/g, '')
    .replace(/[\s\-_·,，.。!！?？'"“”‘’]/g, '')
    .replace(/feat\..*$/, '')
    .replace(/(live|remix|伴奏|翻自|cover)$/i, '')
}

/** 归一化歌手：多人合作只看第一位 */
export function normSinger(s: string): string {
  return normTitle(String(s ?? '').split(/[/、&,，]|feat\./i)[0] ?? '')
}

/** 标题相似度 0~1 */
function titleScore(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  if (a.includes(b) || b.includes(a)) return 0.7
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return (i / Math.max(a.length, b.length)) * 0.5
}

/**
 * 在候选里挑最像原曲的一条。
 *
 * 门槛故意高：标题要几乎一致、歌手要能对上。
 * avoid：这些音源刚被证明「给的地址放不出来」，本轮不要再选。
 */
export function pickBestMatch(
  item: MusicItem,
  candidates: MusicItem[],
  avoid?: ReadonlySet<SourceId>,
): MusicItem | null {
  const wantTitle = normTitle(item.name)
  const wantSinger = normSinger(item.singer)
  let best: { item: MusicItem; score: number } | null = null

  for (const c of candidates) {
    if (c.source === item.source) continue
    if (avoid?.has(c.source)) continue
    const t = titleScore(wantTitle, normTitle(c.name))
    if (t < 0.9) continue
    const s = normSinger(c.singer)
    const singerOk = Boolean(wantSinger && s && (s.includes(wantSinger) || wantSinger.includes(s)))
    // 标题几乎一致且歌手对得上 -> 才认为是同一首
    if (!(singerOk && t >= 0.7)) continue
    const score = t + 1
    if (!best || score > best.score) best = { item: c, score }
  }
  return best?.item ?? null
}

/**
 * 串源顺序：曲库全的排前面，用户更快听到歌。
 *
 * 订阅文档里可以下发自定义顺序（服务端可远程调整，不用发版），
 * 但内核不持有订阅客户端 —— 由宿主通过 `order` 传进来；
 * 不传就用内置顺序。
 */
const DEFAULT_ORDER: SourceId[] = ['kg', 'kw', 'mg', 'wy']

function candidateSources(
  exclude: SourceId | undefined,
  avoid: ReadonlySet<SourceId>,
  order?: SourceId[],
): SourceId[] {
  const usable = (id: SourceId): boolean => id !== exclude && !avoid.has(id) && hasSource(id)
  const base = order?.length ? order : DEFAULT_ORDER
  // 补上自定义顺序里没提到、但确实注册了的音源
  const all: SourceId[] = ['wy', 'kw', 'mg', 'kg']
  const merged = [...base, ...all.filter(id => !base.includes(id))]
  return merged.filter(usable)
}

export interface FallbackOutcome {
  info: MusicUrlInfo
  /** 实际播放的曲目（串源后与请求的不同） */
  item: MusicItem
  /** 是否发生了串源 —— 仅供内部埋点，不展示给用户 */
  switched: boolean
}

/** 这些错误说明「这个音源放不了」，值得换源；其他错误原样抛出 */
export function isUnplayableMessage(message: string): boolean {
  // 网络/签名问题换源也没用，别把真实故障藏起来
  if (/HTTP \d|没有 fetch|Network|Failed to fetch|timeout|ECONN|abort/i.test(message)) return false
  return /VIP 专享|试听|无可播放|暂无|版权|下架|缺少|not found|no.*url/i.test(message)
}

export interface ResolveOptions {
  /** false 时只试原音源 */
  allowCrossSource?: boolean
  /** 跳过这个音源（原源也不行时用） */
  exclude?: SourceId
  /** 这些音源本轮不要再选 */
  avoid?: SourceId[]
  /** 串源优先级，由宿主按订阅下发；不传用内置顺序 */
  order?: SourceId[]
}

/**
 * 取流：原音源 -> 跨音源搜同曲。全程静默。
 */
export async function resolveWithFallback(
  item: MusicItem,
  quality: Quality,
  opts: ResolveOptions = {},
): Promise<FallbackOutcome> {
  const skip = opts.exclude
  const avoid = new Set<SourceId>(opts.avoid ?? [])

  try {
    if (skip === item.source) throw new Error('[lxmn/fallback] 跳过这个音源')
    const info = await getSource(item.source).getMusicUrl(item, quality)
    return { info, item, switched: false }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (opts.allowCrossSource === false || !isUnplayableMessage(message)) throw e

    const keyword = (String(item.name ?? '') + ' ' + normSinger(item.singer)).trim()
    const others = candidateSources(item.source, avoid, opts.order)
    for (const id of others) {
      const source = getSource(id)
      if (!source.musicSearch) continue
      try {
        const found = await source.musicSearch(keyword, 1, 15)
        const match = pickBestMatch(item, found.list, avoid)
        if (!match) continue
        const info = await getSource(match.source).getMusicUrl(match, quality)
        return { info, item: match, switched: true }
      } catch {
        // 这个音源也不行，继续下一个
      }
    }
    // 全都失败：抛原始错误，保留最准确的原因
    throw e
  }
}
