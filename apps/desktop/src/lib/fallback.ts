/**
 * 静默取流兜底
 *
 * 目标只有一个：**让用户听到歌**，并且全程不打扰他。
 *
 * 三层策略，从便宜到贵：
 *   1. 原音源按请求音质取流（内核内部已经会逐档降音质，不重复做）；
 *   2. 原音源仍然不行 —— 换其他音源搜同一首歌。
 *      这是用户明确要的：「就算是 VIP 总有音乐源支持」。
 *   3. 都不行才把原始错误抛出去。
 *
 * 关键约束（用户明确要求）：
 *   - **不提示用户换源了**。界面不该冒出「已切换到酷狗」这种话。
 *   - 串源只在「这首歌在当前音源放不了」时发生，而不是随机换源。
 *     网易没版权 / VIP 专享的曲目，去酷狗酷我咪咕找正主，这才是用户要的。
 *   - 匹配必须严：宁可报错，也不要串到一首翻唱或同名歌。
 */
import {
  getSource, hasSource,
  type MusicItem, type MusicUrlInfo, type Quality, type SourceId,
} from '@lxmn/core'
import { subscription } from './subscription'
import { sourcePool } from './source-pool'
import { toMusicInfo } from '@lxmn/core'

/** 归一化标题：去括号补充、去标点空格、小写 */
function normTitle(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[（(【\[].*?[）)】\]]/g, '')
    .replace(/[\s\-_·,，.。!！?？'"“”‘’]/g, '')
    .replace(/feat\..*$/, '')
    .replace(/(live|remix|伴奏|翻自|cover)$/i, '')
}

/** 归一化歌手：多人合作只看第一位 */
function normSinger(s: string): string {
  return normTitle(String(s ?? '').split(/[\/、&,，]|feat\./i)[0] ?? '')
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
 * 串错歌比放不出来更让人恼火 —— 用户点的是周杰伦，播出来一个翻唱。
 *
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
 * 串源时按什么顺序试。
 *
 * 优先用服务端下发的 order（订阅文档里带，可远程调整，不用发版）：
 * 曲库全的音源排前面，用户更快听到歌。拿不到订阅时退回内置顺序。
 * 同时尊重 enabled —— 服务端可以把某个音源临时下线。
 */
async function candidateSources(exclude: SourceId | undefined, avoid: ReadonlySet<SourceId>): Promise<SourceId[]> {
  const usable = (id: SourceId): boolean => id !== exclude && !avoid.has(id) && hasSource(id)
  const fallback: SourceId[] = ['kg', 'kw', 'mg', 'wy']
  try {
    const status = await subscription.status()
    if (status.state !== 'active') {
      return fallback.filter(usable)
    }
    const ranked = status.sources
      .filter(s => s.enabled !== false)
      .map((s, i) => ({ id: s.id as SourceId, order: s.order ?? 100 + i }))
      .filter(s => usable(s.id))
      .sort((a, b) => a.order - b.order)
      .map(s => s.id)
    return ranked.length ? ranked : fallback.filter(usable)
  } catch {
    return fallback.filter(usable)
  }
}

export interface FallbackOutcome {
  info: MusicUrlInfo
  /** 实际播放的曲目（串源后与请求的不同） */
  item: MusicItem
  /** 是否发生了串源 —— 仅供内部埋点，不展示给用户 */
  switched: boolean
}

/** 这些错误说明「这个音源放不了」，值得换源；其他错误原样抛出 */
function isUnplayable(message: string): boolean {
  // 网络/签名问题换源也没用，别把真实故障藏起来
  if (/HTTP \d|没有 fetch|Network|Failed to fetch|timeout|ECONN|abort/i.test(message)) return false
  return /VIP 专享|试听|无可播放|暂无|版权|下架|缺少|not found|no.*url/i.test(message)
}

/**
 * 取流：原音源 -> 第三方脚本池 -> 其他音源。全程静默。
 *
 * 顺序是有讲究的：
 *   1. 先用内置实现（快，且不依赖第三方服务器）；
 *   2. 内置不行就问脚本池 —— 这些脚本是社区每天维护的，
 *      平台改版后它们往往比我们的内置实现先恢复；
 *   3. 脚本也不行才跨平台搜同一首歌（网易没版权 -> 去酷狗找正主）。
 */
export async function resolveWithFallback(
  item: MusicItem,
  quality: Quality,
  /**
   * exclude：跳过这个音源。
   * 试听片段（时长只有原曲一小截）在取流阶段看不出来，只能等 <audio> 报出时长，
   * 那时才回来说「这个源只给了试听」，于是要排除它再找下一个。
   */
  opts: {
    allowCrossSource?: boolean
    exclude?: SourceId
    /**
     * avoid：这些音源本轮不要再选。
     *
     * 和 exclude 的区别是「只跳过串源候选，不跳过原源自己」：
     * 原源重取一次（换张新签名）往往就活了，但已知放不出来的其他源
     * 没必要再挑一遍 —— 否则重试三次会连着踩同一个坏地址。
     */
    avoid?: SourceId[]
  } = {},
): Promise<FallbackOutcome> {
  const skip = opts.exclude
  const avoid = new Set<SourceId>(opts.avoid ?? [])
  try {
    if (skip === item.source) throw new Error('[lxmn/fallback] 跳过仅提供试听的音源')
    const info = await getSource(item.source).getMusicUrl(item, quality)
    return { info, item, switched: false }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (opts.allowCrossSource === false || !isUnplayable(message)) throw e

    // 第二层：第三方脚本池。同一首歌、同一平台，只是换个实现去取流。
    // 被排除的音源同样跳过脚本池 —— 脚本走的是同一家平台的接口。
    try {
      if (skip === item.source) throw new Error('skip')
      const pooled = await sourcePool.getMusicUrl(item.source, toMusicInfo(item), quality)
      return {
        info: { url: pooled.url, quality, type: 'mp3' },
        item,
        switched: false,
      }
    } catch {
      // 脚本池也失败，继续走跨平台
    }

    const keyword = (String(item.name ?? '') + ' ' + normSinger(item.singer)).trim()
    const others = await candidateSources(item.source, avoid)
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
