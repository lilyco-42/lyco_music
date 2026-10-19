/**
 * 搜索页 —— 真正能听歌的入口。
 *
 * 调 @lxmn/core 的 musicSearch（与桌面端同一份内核），点条目即播放。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, FlatList, Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { getSource, hasSource, listSources, type MusicItem } from '@lxmn/core'
import { play, usePlayerState } from '../player'
import { library } from '../sync'
import { safe } from '../lib/safe'
import { colors, topInset } from '../theme'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const DEFAULT_COVER = require('../assets/art/cover-default.jpg') as number

/** 音源显示名（与桌面端一致） */
const SOURCE_LABELS: Record<string, string> = { wy: '网易云', kw: '酷我', kg: '酷狗', mg: '咪咕' }

export default function SearchScreen({ initialKeyword }: { initialKeyword?: string }) {
  const [keyword, setKeyword] = useState(initialKeyword ?? '')
  const [list, setList] = useState<MusicItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  /** 收藏集合：存 key 而不是整条曲目，避免每首歌都做一次深比较 */
  const [favKeys, setFavKeys] = useState<Set<string>>(new Set())
  /** 当前筛选的音源，'all' 表示不筛选 */
  const [sourceFilter, setSourceFilter] = useState<string>('all')

  /** 结果里真实出现过的音源（带数量），点「全部」恢复 */
  const sourceTabs = useMemo(() => {
    const counts = new Map<string, number>()
    for (const it of list) counts.set(it.source, (counts.get(it.source) ?? 0) + 1)
    return [
      { id: 'all', label: '全部', count: list.length },
      ...[...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([id, count]) => ({ id, label: SOURCE_LABELS[id] ?? id, count })),
    ]
  }, [list])

  const filtered = useMemo(
    () => (sourceFilter === 'all' ? list : list.filter(i => i.source === sourceFilter)),
    [list, sourceFilter],
  )
  const st = usePlayerState()

  const keyOf = (i: MusicItem) => i.source + '::' + String(i.songmid)

  /** 从曲库同步收藏状态到界面 */
  const pullFavs = useCallback(() => {
    setFavKeys(new Set(library.snapshot().favorites.map(keyOf)))
  }, [])

  useEffect(() => {
    void library.load().then(pullFavs)
  }, [pullFavs])

  async function toggleFav(item: MusicItem) {
    await library.toggleFavorite(item)
    pullFavs()
  }

  /** 真正执行搜索。显式收 keyword，这样「首页带词跳进来」也能复用 */
  const runWith = useCallback(async (raw: string) => {
    const q = raw.trim()
    if (!q) return
    setLoading(true)
    setError('')
    setList([])
    setTotal(0)
    setSourceFilter('all')
    try {
      // 和桌面端同一策略：并发查所有能搜索的音源，去重合并。
      // 只查 wy 会把 kw/mg/kg 的免费曲库白白丢掉，而 wy 上大量 VIP 曲目
      // 本来就拿不到播放地址。
      const ids = listSources().filter(id => hasSource(id) && Boolean(getSource(id).musicSearch))
      if (!ids.length) throw new Error('当前没有可用的音源')

      const results = await Promise.all(
        ids.map(id => getSource(id).musicSearch!(q, 1, 30).catch(() => null)),
      )
      const seen = new Set<string>()
      const merged: MusicItem[] = []
      let sum = 0
      for (const r of results) {
        if (!r) continue
        sum += r.total
        for (const it of r.list) {
          const key = it.source + '-' + String(it.songmid)
          if (seen.has(key)) continue
          seen.add(key)
          merged.push(it)
        }
      }
      if (!merged.length && results.every(r => r === null)) {
        throw new Error('所有音源都没有响应，请检查网络')
      }
      setList(merged)
      setTotal(sum)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  const run = useCallback(() => void runWith(keyword), [keyword, runWith])

  const currentId = st.queue[st.index]?.songmid

  /**
   * 从首页带词跳进来时自动搜一次。
   * 用 ref 记住上一次搜过的词，避免父组件重渲染时把用户手输的内容覆盖掉。
   */
  const lastSeed = useRef('')
  useEffect(() => {
    const q = (initialKeyword ?? '').trim()
    if (!q || q === lastSeed.current) return
    lastSeed.current = q
    setKeyword(q)
    void runWith(q)
  }, [initialKeyword])

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: topInset }}>
      {/* 搜索框 */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingVertical: 12 }}>
        <TextInput
          value={keyword}
          onChangeText={setKeyword}
          onSubmitEditing={run}
          returnKeyType="search"
          placeholder="搜索歌曲、歌手"
          placeholderTextColor={colors.fainter}
          style={{
            flex: 1,
            height: 40,
            borderRadius: 20,
            paddingHorizontal: 16,
            backgroundColor: colors.surface,
            color: colors.fg,
            fontSize: 15,
          }}
        />
        <Pressable onPress={safe('搜索', run)} hitSlop={10}>
          <Text style={{ color: colors.accent, fontSize: 15 }}>搜索</Text>
        </Pressable>
      </View>

      {/* 音源筛选：一条结果里混着四个源 */}
      {sourceTabs.length > 1 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, gap: 8, paddingBottom: 8 }}
        >
          {sourceTabs.map(t => {
            const active = sourceFilter === t.id
            return (
              <Pressable
                key={t.id}
                onPress={() => setSourceFilter(t.id)}
                accessibilityState={{ selected: active }}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: active ? colors.accent : colors.divider,
                  backgroundColor: active ? colors.accent + '22' : 'transparent',
                }}
              >
                <Text style={{ color: active ? colors.accent : colors.muted, fontSize: 12 }}>
                  {t.label} {t.count}
                </Text>
              </Pressable>
            )
          })}
        </ScrollView>
      )}

      {loading ? (
        <View style={{ paddingTop: 40, alignItems: 'center' }}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <Text style={{ color: colors.accent, paddingHorizontal: 20, fontSize: 14 }}>{error}</Text>
      ) : !list.length ? (
        <Text style={{ color: colors.fainter, paddingHorizontal: 20, fontSize: 14 }}>
          {keyword.trim() ? '没有找到相关歌曲' : '输入关键词后回车搜索'}
        </Text>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={i => i.source + '-' + i.songmid}
          ListHeaderComponent={
            <Text style={{ color: colors.fainter, fontSize: 12, paddingHorizontal: 20, paddingBottom: 8 }}>
              共 {total} 首{sourceFilter !== 'all' ? ' · 已筛选 ' + filtered.length + ' 首' : ''}
            </Text>
          }
          renderItem={({ item, index }) => {
            const active = item.songmid === currentId
            return (
              <Pressable
                onPress={safe('播放', () => play(item, list))}
                style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10, gap: 12 }}
              >
                <Text style={{ color: colors.fainter, fontSize: 13, width: 20 }}>{index + 1}</Text>
                <Image
                  source={item.picUrl ? { uri: String(item.picUrl) } : DEFAULT_COVER}
                  style={{ width: 40, height: 40, borderRadius: 6, backgroundColor: colors.elevated }}
                />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ color: active ? colors.accent : colors.fg, fontSize: 15 }}>
                    {item.name}
                  </Text>
                  <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 12, marginTop: 3 }}>
                    {item.singer}{item.albumName ? ' · ' + item.albumName : ''}
                  </Text>
                </View>
                <Pressable
                  onPress={safe('收藏', () => toggleFav(item))}
                  hitSlop={12}
                  style={{ paddingHorizontal: 4, paddingVertical: 6 }}
                >
                  <Text style={{
                    fontSize: 17,
                    color: favKeys.has(keyOf(item)) ? colors.accent : colors.fainter,
                  }}>
                    {favKeys.has(keyOf(item)) ? '♥' : '♡'}
                  </Text>
                </Pressable>
                <Text style={{ color: colors.fainter, fontSize: 11 }}>{item.source.toUpperCase()}</Text>
              </Pressable>
            )
          }}
        />
      )}
    </View>
  )
}
