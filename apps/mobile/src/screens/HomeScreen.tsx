/**
 * 首页 —— 网易云风格布局（不含任何网易商标/图形资产）
 * 结构：顶栏（Logo + 标题 + 搜索入口）→ 推荐歌单 → 猜你喜欢（真实搜索结果）
 *
 * 「猜你喜欢」之前是 8 条写死的假数据（城市夜航 / 林一 / 128 万播放），
 * 现在改成用几个热门关键词去内核里搜真实歌曲，点了就能播。
 *
 * 推荐歌单卡上的「30 首 / 50 首」也一并删掉了：本站没有歌单数据源，
 * 那些数字纯粹是编的。卡片本身留着（版式是网易云的样子），点一下带着
 * 歌单名跳到搜索页 —— 版式不动，但每张卡都通向真实结果。
 */
import { useEffect, useState } from 'react'
import { ActivityIndicator, FlatList, Image, Pressable, ScrollView, Text, View } from 'react-native'
import { getSource, hasSource, listSources, type MusicItem } from '@lxmn/core'
import { Logo } from '../components/Icons'
import { picKey } from '../lib/picKey'
import { play, usePlayerState } from '../player'
import { colors, useTopInset } from '../theme'

interface Playlist {
  id: number
  title: string
  /** 点击后跳搜索页用的词；与卡片标题解耦，标题可以更「歌单味」 */
  keyword: string
}

/**
 * 实测规格：卡片 140x170，圆角 8。
 * 卡片上的小字以前是编的播放量，现在放的是它实际会搜的词 ——
 * 用户点进去看到的就是搜这个词的结果，所见即所得。
 */
const PLAYLISTS: Playlist[] = [
  { id: 1, title: '每日推荐 · 为你而选', keyword: '热门' },
  { id: 2, title: '私人雷达 · 越听越懂你', keyword: '华语流行' },
  { id: 3, title: '华语流行精选', keyword: '华语经典' },
  { id: 4, title: '深夜轻音乐', keyword: '轻音乐' },
  { id: 5, title: '电子 · 律动', keyword: '电子' },
  { id: 6, title: '民谣与故事', keyword: '民谣' },
  { id: 7, title: '经典摇滚', keyword: '摇滚' },
]

/** 用几个覆盖面广的关键词拼出首页推荐；任何一个失败都不影响其它 */
const SEED_KEYWORDS = ['热门', '华语流行', '轻音乐']

// GPT 生成的默认封面占位图（Metro 只打包被静态 require 引用的资源）
// eslint-disable-next-line @typescript-eslint/no-require-imports
const DEFAULT_COVER = require('../assets/art/cover-default.jpg') as number

/**
 * 封面。有 uri 就真的把图显示出来 —— 之前这个分支渲染的是一个空 View，
 * 等于所有能拿到封面的曲目反而看不到封面。加载失败时回落到生成的占位图。
 */
function CoverPlaceholder({ size, radius = 8, uri }: { size: number; radius?: number; uri?: string }) {
  const [failed, setFailed] = useState(false)
  if (uri && !failed) {
    return (
      <Image
        source={{ uri }}
        onError={() => setFailed(true)}
        style={{ width: size, height: size, borderRadius: radius, backgroundColor: colors.elevated }}
      />
    )
  }
  return (
    <Image
      source={DEFAULT_COVER}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        backgroundColor: colors.elevated,
      }}
    />
  )
}

export default function HomeScreen({ onOpenSearch }: { onOpenSearch?: (keyword?: string) => void }) {
  const insetTop = useTopInset()
  const [tracks, setTracks] = useState<MusicItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  /** 歌单卡的封面：按关键词搜一首歌，用它的封面当卡片图 */
  const [covers, setCovers] = useState<Record<number, string>>({})
  const st = usePlayerState()
  const currentId = st.queue[st.index]?.songmid

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        // 和搜索页同一策略：多音源并发。只查 wy 的话首页翻来覆去就那几首，
        // 而且 wy 的 VIP 曲目点进去还播不了。
        const ids = listSources().filter(id => hasSource(id) && Boolean(getSource(id).musicSearch))
        if (!ids.length) throw new Error('当前没有可用的音源')
        const results = await Promise.all(
          SEED_KEYWORDS.flatMap(k =>
            ids.map(id => getSource(id).musicSearch!(k, 1, 8).catch(() => null)),
          ),
        )
        if (!alive) return
        const seen = new Set<string>()
        const merged: MusicItem[] = []
        for (const r of results) {
          for (const it of r?.list ?? []) {
            const key = it.source + '-' + it.songmid
            if (seen.has(key)) continue
            seen.add(key)
            merged.push(it)
          }
        }
        setTracks(merged.slice(0, 20))

        // 歌单封面：每张卡搜一首，用结果的封面当卡片图。
        // 之前七张卡用的是同一张生成的占位图，一眼就能看出是假数据。
        //
        // 这里必须**串行**并记下已经用过的封面：关键词之间有重合
        // （「热门」和「华语流行」的第一名经常是同一首），并发挑选会让
        // 几张卡撞成同一张图，串行才能保证「下一张换一个」。
        //
        // 去重按**归一化后的封面 URL**，两个坑都要盖住：
        // - 同一张图在 CDN 上有不同尺寸参数的 URL（wy/kg 的 ?param=300y300），
        //   比原始 URL 会漏掉这种重复 → 去掉 query；
        // - 同一张专辑的不同歌曲封面 URL 完全一样（kw 尤其明显：搜三个关键词，
        //   头部结果都来自同一张专辑），只按曲目去重会让三张卡撞图 → 按图去重。
        const found: Record<number, string> = {}
        const usedPics = new Set<string>()
        for (let i = 0; i < PLAYLISTS.length; i++) {
          const pl = PLAYLISTS[i]!
          for (const id of ids) {
            const r = await getSource(id).musicSearch!(pl.keyword, 1, 10).catch(() => null)
            const list = r?.list ?? []
            const hasPic = (x: (typeof list)[number]) => typeof x.picUrl === 'string' && !!x.picUrl
            // 优先挑封面没被用过的；实在没有才允许重复，避免整张卡空着
            const pick =
              list.find(x => hasPic(x) && !usedPics.has(picKey(x.picUrl!))) ??
              list.find(x => hasPic(x))
            if (pick?.picUrl) {
              found[pl.id] = pick.picUrl
              usedPics.add(picKey(pick.picUrl))
              break
            }
          }
        }
        if (alive) setCovers(found)
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insetTop }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        {/* 顶栏 */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 18 }}>
          <Logo size={34} />
          <Text style={{ color: colors.fg, fontSize: 21, fontWeight: '600', flex: 1 }}>Lyco Music</Text>
          {/* 不传关键词：这是「去搜索页」而不是「搜某个词」 */}
          <Pressable onPress={() => onOpenSearch?.()} hitSlop={10}>
            <Text style={{ color: colors.accent, fontSize: 14 }}>搜索</Text>
          </Pressable>
        </View>

        {/* 推荐歌单 */}
        <View style={{ paddingHorizontal: 20, marginBottom: 12, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <Text style={{ color: colors.fg, fontSize: 17, fontWeight: '600' }}>推荐歌单</Text>
          <Text style={{ color: colors.muted, fontSize: 13 }}>更多 ›</Text>
        </View>

        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={PLAYLISTS}
          keyExtractor={i => String(i.id)}
          contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}
          renderItem={({ item }) => (
            <Pressable style={{ width: 140 }} onPress={() => onOpenSearch?.(item.keyword)}>
              <CoverPlaceholder size={140} radius={8} uri={covers[item.id]} />
              <Text numberOfLines={2} style={{ color: colors.fg, fontSize: 13, lineHeight: 18, marginTop: 8 }}>
                {item.title}
              </Text>
              <Text numberOfLines={1} style={{ color: colors.fainter, fontSize: 11, marginTop: 3 }}>
                搜索「{item.keyword}」
              </Text>
            </Pressable>
          )}
        />

        {/* 猜你喜欢：真实搜索结果 */}
        <View style={{ paddingHorizontal: 20, marginTop: 26, marginBottom: 10 }}>
          <Text style={{ color: colors.fg, fontSize: 17, fontWeight: '600' }}>猜你喜欢</Text>
        </View>

        {loading ? (
          <View style={{ paddingVertical: 30, alignItems: 'center' }}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : error ? (
          <Text style={{ color: colors.accent, paddingHorizontal: 20, fontSize: 13 }}>{error}</Text>
        ) : !tracks.length ? (
          <Text style={{ color: colors.fainter, paddingHorizontal: 20, fontSize: 13 }}>
            暂时拿不到推荐，去搜索页试试
          </Text>
        ) : (
          <View style={{ paddingHorizontal: 20 }}>
            {tracks.map((t, idx) => {
              const active = t.songmid === currentId
              return (
                <Pressable
                  key={t.source + '-' + t.songmid + '-' + idx}
                  onPress={() => void play(t, tracks)}
                  style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 9, gap: 12 }}
                >
                  <Text style={{ color: colors.fainter, fontSize: 13, width: 18 }}>{idx + 1}</Text>
                  <CoverPlaceholder size={48} radius={6} uri={typeof t.picUrl === 'string' ? t.picUrl : undefined} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ color: active ? colors.accent : colors.fg, fontSize: 15 }}>
                      {t.name}
                    </Text>
                    <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 12, marginTop: 3 }}>
                      {t.singer}
                    </Text>
                  </View>
                  <Text style={{ color: colors.fainter, fontSize: 11 }}>{t.source.toUpperCase()}</Text>
                </Pressable>
              )
            })}
          </View>
        )}
      </ScrollView>
    </View>
  )
}
