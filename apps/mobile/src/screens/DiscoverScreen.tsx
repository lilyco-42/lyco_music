/**
 * 发现页 —— 排行榜 + 歌单搜索（移动端，对应桌面端 Discover.vue）。
 *
 * 之前移动端只有一个「网易云导入」弹窗：得先去网易云复制链接才能拿到别人的歌单。
 * 这一页补的是「在没有目标的时候找歌单」：官方榜单点开就是完整曲目，
 * 歌单搜索走网易云 `/api/cloudsearch/pc?type=1000`（不登录、不写回）。
 *
 * 拿到的曲目只是元数据，播放仍走我们自己的四源串流兜底（和桌面端同一份内核），
 * 所以「点开一个付费歌单也能听」这件事在两端表现一致。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator, FlatList, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native'
import {
  WY_BOARDS, fetchWyPlaylist, searchWyPlaylists,
  type MusicItem, type WyPlaylistBrief,
} from '@lxmn/core'
import { play, usePlayerState } from '../player'
import { library } from '../sync'
import { colors, useTopInset } from '../theme'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const DEFAULT_COVER = require('../assets/art/cover-default.jpg') as number

interface Detail {
  id: string
  name: string
  cover: string
  total: number
  tracks: MusicItem[]
}

/** 播放量：和桌面端一样按「万 / 亿」缩写，小数字直接不显示 */
function fmtPlayCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return ''
  if (n >= 1e8) return (n / 1e8).toFixed(1) + '亿'
  if (n >= 1e4) return Math.round(n / 1e4) + '万'
  return String(n)
}

function fmtDuration(v: unknown): string {
  return typeof v === 'string' && v ? v : '--:--'
}

/**
 * 封面。传 size 就是固定正方形（列表行用 42），不传就铺满父容器
 * —— 两列网格里算不出「屏宽减间距的一半」，让父容器用 aspectRatio 定形状最省事。
 */
function Cover({ size, uri }: { size?: number; uri?: string }) {
  const [failed, setFailed] = useState(false)
  const src = uri && !failed ? { uri } : DEFAULT_COVER
  return (
    <Image
      source={src}
      onError={() => setFailed(true)}
      style={
        size
          ? { width: size, height: size, borderRadius: 8, backgroundColor: colors.elevated }
          : [StyleSheet.absoluteFill, { borderRadius: 8, backgroundColor: colors.elevated }]
      }
    />
  )
}

/**
 * initialKeyword：从首页的「推荐歌单」卡跳过来时带的词。
 * 带上就直接落在「歌单搜索」并自动搜一次 —— 用户点的是歌单卡，不该落到空页。
 */
export default function DiscoverScreen({
  initialKeyword,
  onSeedConsumed,
}: {
  initialKeyword?: string
  /** 搜完一次就把种子词清掉：否则从别的标签切回来会莫名其妙再搜一遍 */
  onSeedConsumed?: () => void
}) {
  const insetTop = useTopInset()
  const [tab, setTab] = useState<'boards' | 'playlists'>(initialKeyword ? 'playlists' : 'boards')
  const [keyword, setKeyword] = useState(initialKeyword ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [playlists, setPlaylists] = useState<WyPlaylistBrief[]>([])
  const [total, setTotal] = useState(0)
  const [searched, setSearched] = useState(false)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [detailBusy, setDetailBusy] = useState(false)
  /** 存歌单后的反馈：RN 没有 toast，用顶部的条自己顶一下 */
  const [msg, setMsg] = useState('')
  const st = usePlayerState()
  const currentId = st.queue[st.index]?.songmid

  /* ---------------- 搜索歌单 ---------------- */

  const runSearch = useCallback(async (raw?: string) => {
    const q = (raw ?? keyword).trim()
    if (!q || busy) return
    setBusy(true)
    setError('')
    setMsg('')
    setSearched(true)
    try {
      const r = await searchWyPlaylists(q, 1, 24)
      setPlaylists(r.list)
      setTotal(r.total)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPlaylists([])
      setTotal(0)
    } finally {
      setBusy(false)
    }
  }, [keyword, busy])

  /** 防止同一个种子词重复触发（重渲染不该重新搜一遍） */
  const lastSeed = useRef('')

  useEffect(() => {
    const seed = (initialKeyword ?? '').trim()
    if (!seed || seed === lastSeed.current) return
    lastSeed.current = seed
    setTab('playlists')
    setKeyword(seed)
    void runSearch(seed)
    onSeedConsumed?.()
    // runSearch 依赖 keyword/busy，这里只认种子词的变化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialKeyword])

  /* ---------------- 点开一个榜 / 一个歌单 ---------------- */

  const openDetail = useCallback(async (id: string, fallbackName: string, cover = '') => {
    setDetail({ id, name: fallbackName, cover, total: 0, tracks: [] })
    setDetailBusy(true)
    setError('')
    setMsg('')
    try {
      const pl = await fetchWyPlaylist(id)
      setDetail({ id, name: pl.name || fallbackName, cover: pl.cover || cover, total: pl.total, tracks: pl.tracks })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setDetailBusy(false)
    }
  }, [])

  const closeDetail = useCallback(() => {
    setDetail(null)
    setError('')
  }, [])

  /* ---------------- 播放 / 收藏 ---------------- */

  async function playAll() {
    const tracks = detail?.tracks ?? []
    const first = tracks[0]
    if (!first) return
    await play(first, tracks)
  }

  /** 整张加进试听列表：不打断当前播放，只是「先收着」 */
  async function addAllToTrial() {
    const tracks = detail?.tracks ?? []
    if (!tracks.length) return
    const ok = await library.addToTrial(tracks)
    setMsg(ok ? '已加入试听列表 ' + tracks.length + ' 首' : '这些歌都已经在试听列表里了')
  }

  /** 存成自建歌单：榜单天天变，想留住某一期就靠这个 */
  async function saveAsPlaylist() {
    const d = detail
    if (!d?.tracks.length) return
    const pl = await library.createPlaylist(d.name.slice(0, 40))
    let added = 0
    for (const item of d.tracks) {
      if (await library.addToPlaylist(pl.id, item)) added++
    }
    setMsg('已存为歌单「' + pl.name + '」：' + added + ' 首（去「我的」里看）')
  }

  /* ---------------- 详情页 ---------------- */

  if (detail) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insetTop }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingTop: 12 }}>
          <Pressable onPress={closeDetail} hitSlop={10}>
            <Text style={{ color: colors.muted, fontSize: 14 }}>返回</Text>
          </Pressable>
          <Text numberOfLines={1} style={{ color: colors.fg, fontSize: 19, fontWeight: '700', flex: 1 }}>
            {detail.name}
          </Text>
          {detail.total ? (
            <Text style={{ color: colors.fainter, fontSize: 12 }}>{detail.total} 首</Text>
          ) : null}
        </View>

        {detail.tracks.length ? (
          <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingTop: 14 }}>
            <Pressable onPress={() => void playAll()}
              style={{ backgroundColor: colors.accent, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8 }}>
              <Text style={{ color: '#fff', fontSize: 13 }}>播放全部</Text>
            </Pressable>
            <Pressable onPress={() => void addAllToTrial()}
              style={{ borderWidth: 1, borderColor: colors.divider, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8 }}>
              <Text style={{ color: colors.muted, fontSize: 13 }}>加入试听</Text>
            </Pressable>
            <Pressable onPress={() => void saveAsPlaylist()}
              style={{ borderWidth: 1, borderColor: colors.divider, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8 }}>
              <Text style={{ color: colors.muted, fontSize: 13 }}>存为歌单</Text>
            </Pressable>
          </View>
        ) : null}

        {msg ? (
          <Text style={{ color: '#4ade80', fontSize: 12, paddingHorizontal: 20, paddingTop: 10 }}>{msg}</Text>
        ) : null}

        {detailBusy ? (
          <View style={{ paddingVertical: 30, alignItems: 'center' }}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : error ? (
          <Text style={{ color: colors.accent, fontSize: 13, paddingHorizontal: 20, paddingTop: 14 }}>{error}</Text>
        ) : (
          <FlatList
            data={detail.tracks}
            keyExtractor={(t, i) => t.source + '-' + String(t.songmid) + '-' + i}
            contentContainerStyle={{ paddingTop: 12, paddingBottom: 24 }}
            renderItem={({ item, index }) => {
              const active = item.songmid === currentId
              return (
                <Pressable
                  onPress={() => void play(item, detail.tracks)}
                  style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 9, gap: 12 }}
                >
                  <Text style={{ color: colors.fainter, fontSize: 13, width: 22 }}>{index + 1}</Text>
                  <Cover size={42} uri={typeof item.picUrl === 'string' ? item.picUrl : undefined} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ color: active ? colors.accent : colors.fg, fontSize: 15 }}>
                      {item.name}
                    </Text>
                    <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 12, marginTop: 3 }}>
                      {item.singer}
                    </Text>
                  </View>
                  <Text style={{ color: colors.fainter, fontSize: 11 }}>{fmtDuration(item.interval)}</Text>
                </Pressable>
              )
            }}
          />
        )}
      </View>
    )
  }

  /* ---------------- 列表页 ---------------- */

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insetTop }}>
      <View style={{ paddingHorizontal: 20, paddingTop: 12 }}>
        <Text style={{ color: colors.fg, fontSize: 24, fontWeight: '700' }}>发现音乐</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
          {([['boards', '排行榜'], ['playlists', '歌单搜索']] as const).map(([k, label]) => (
            <Pressable
              key={k}
              onPress={() => setTab(k)}
              style={{
                borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8,
                backgroundColor: tab === k ? colors.accent : colors.surface,
              }}
            >
              <Text style={{ color: tab === k ? '#fff' : colors.muted, fontSize: 13.5 }}>{label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {tab === 'playlists' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingTop: 14 }}>
          <TextInput
            value={keyword}
            onChangeText={setKeyword}
            placeholder="搜歌单，例如「通勤」「爵士」"
            placeholderTextColor={colors.fainter}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={() => void runSearch()}
            style={{
              flex: 1, backgroundColor: colors.surface, borderRadius: 12,
              paddingHorizontal: 14, paddingVertical: 10, color: colors.fg, fontSize: 14,
              borderWidth: 1, borderColor: colors.divider,
            }}
          />
          <Pressable
            onPress={() => void runSearch()}
            disabled={busy || !keyword.trim()}
            style={{
              backgroundColor: colors.accent, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10,
              opacity: busy || !keyword.trim() ? 0.4 : 1,
            }}
          >
            <Text style={{ color: '#fff', fontSize: 13 }}>{busy ? '搜索中…' : '搜索'}</Text>
          </Pressable>
        </View>
      ) : null}

      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        {error ? (
          <Text style={{ color: colors.accent, fontSize: 13, paddingHorizontal: 20, paddingTop: 14 }}>{error}</Text>
        ) : null}

        {tab === 'boards' ? (
          <View style={{ paddingHorizontal: 20, paddingTop: 16, gap: 10 }}>
            <Text style={{ color: colors.fainter, fontSize: 12, lineHeight: 18 }}>
              网易云官方榜，点开就是完整曲目。榜单每天更新，想留住某一期用「存为歌单」。
            </Text>
            {WY_BOARDS.map(b => (
              <Pressable
                key={b.id}
                onPress={() => void openDetail(b.id, b.name)}
                style={{
                  backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13,
                  borderWidth: 1, borderColor: colors.divider,
                }}
              >
                <Text style={{ color: colors.fg, fontSize: 15 }}>{b.name}</Text>
                <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 12, marginTop: 3 }}>{b.desc}</Text>
              </Pressable>
            ))}
          </View>
        ) : searched && !busy && !playlists.length && !error ? (
          <Text style={{ color: colors.fainter, fontSize: 13, paddingHorizontal: 20, paddingTop: 18 }}>
            没有找到相关歌单
          </Text>
        ) : !searched ? (
          <Text style={{ color: colors.fainter, fontSize: 13, paddingHorizontal: 20, paddingTop: 18, lineHeight: 19 }}>
            输入关键词搜歌单（不是单曲）。点开任意一张，整张都能播、也能存成自己的歌单。
          </Text>
        ) : (
          <View style={{ paddingHorizontal: 20, paddingTop: 14 }}>
            {total ? (
              <Text style={{ color: colors.fainter, fontSize: 12, marginBottom: 10 }}>
                共 {total} 个歌单，显示前 {playlists.length} 个
              </Text>
            ) : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
              {playlists.map(p => (
                <Pressable
                  key={p.id}
                  onPress={() => void openDetail(p.id, p.name, p.cover)}
                  style={{ width: '46%' }}
                >
                  <View style={{ width: '100%', aspectRatio: 1, borderRadius: 8, overflow: 'hidden' }}>
                    <Cover uri={p.cover} />
                  </View>
                  <Text numberOfLines={2} style={{ color: colors.fg, fontSize: 13, lineHeight: 18, marginTop: 6 }}>
                    {p.name}
                  </Text>
                  <Text numberOfLines={1} style={{ color: colors.fainter, fontSize: 11, marginTop: 2 }}>
                    {p.trackCount} 首 · {p.creator}
                    {fmtPlayCount(p.playCount) ? ' · ' + fmtPlayCount(p.playCount) : ''}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  )
}
