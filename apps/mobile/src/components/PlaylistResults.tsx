/**
 * 歌单搜索结果（移动端共用，对应桌面端 PlaylistSearchPanel.vue）。
 *
 * 网易云 type=1000 会同时模糊匹配「歌单名」和「创建者昵称」，还塞相关推荐；
 * 搜一个作者名时混进一堆作者不叫这个名字的歌单，就是这个原因。
 * 内核给每条结果打了 match 标签，这里做三件事：
 *   1. 四档筛选（全部 / 歌单名 / 创建者 / 相关推荐）+ 卡片标签；
 *   2. 「只看同名创建者」/「只看 TA 的歌单」走用户主页接口拿全量，
 *      而不是在本次 24 条结果里过滤（实测会漏 2 张）；
 *   3. 点开详情交给父页面（onOpen），搜索页和发现页共用这一份 UI。
 *
 * 两种驱动方式：
 *   - withInput（发现页）：自带输入框与「搜索」按钮，seed 进来自动搜一次；
 *   - 默认（搜索页）：关键词由父组件的搜索框给，nonce 每 +1 触发一次新搜索。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import {
  searchWyPlaylists, searchWyPlaylistsByCreator,
  type WyPlaylistBrief, type WyPlaylistMatch,
} from '@lxmn/core'
import { colors } from '../theme'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const DEFAULT_COVER = require('../assets/art/cover-default.jpg') as number

type Filter = 'all' | WyPlaylistMatch

const MATCH_LABEL: Record<WyPlaylistMatch, string> = {
  name: '歌单名', creator: '创建者', other: '相关推荐',
}

function fmtPlayCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return ''
  if (n >= 1e8) return (n / 1e8).toFixed(1) + '亿'
  if (n >= 1e4) return Math.round(n / 1e4) + '万'
  return String(n)
}

function Cover({ uri }: { uri?: string }) {
  const [failed, setFailed] = useState(false)
  return (
    <Image
      source={uri && !failed ? { uri } : DEFAULT_COVER}
      onError={() => setFailed(true)}
      style={{ width: '100%', height: '100%', borderRadius: 8, backgroundColor: colors.elevated }}
    />
  )
}

export default function PlaylistResults({
  keyword = '', nonce = 0, withInput = false, seed = '', onOpen,
}: {
  /** 搜索页：父组件提交后的关键词 */
  keyword?: string
  /** 搜索页：每次提交 +1，触发一次新搜索 */
  nonce?: number
  /** 发现页：显示自带输入框 */
  withInput?: boolean
  /** 发现页：首页推荐歌单卡带过来的种子词 */
  seed?: string
  onOpen: (id: string, name: string, cover: string) => void
}) {
  const [input, setInput] = useState(seed)
  const [playlists, setPlaylists] = useState<WyPlaylistBrief[]>([])
  const [total, setTotal] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [searched, setSearched] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [creatorOnly, setCreatorOnly] = useState(false)
  const [creatorName, setCreatorName] = useState('')

  const runSearch = useCallback(async (raw: string) => {
    const q = (raw ?? '').trim()
    if (!q) return
    setBusy(true)
    setError('')
    setSearched(true)
    setCreatorOnly(false)
    setCreatorName('')
    setFilter('all')
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
  }, [])

  const onlyCreator = useCallback(async (name: string) => {
    const q = (name || input || keyword).trim()
    if (!q) return
    setBusy(true)
    setError('')
    setSearched(true)
    try {
      const r = await searchWyPlaylistsByCreator(q)
      setCreatorOnly(true)
      setCreatorName(r.creator || q)
      setPlaylists(r.list)
      setTotal(r.total)
      setFilter('all')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [input, keyword])

  const backToKeyword = useCallback(() => {
    setCreatorOnly(false)
    setCreatorName('')
    void runSearch(withInput ? input : keyword)
  }, [withInput, input, keyword, runSearch])

  /** 发现页：种子词进来直接搜一次；同一个词不重复搜 */
  const lastSeed = useRef('')
  useEffect(() => {
    if (!withInput) return
    const s = (seed ?? '').trim()
    if (!s) { lastSeed.current = ''; return }
    if (s === lastSeed.current) return
    lastSeed.current = s
    setInput(s)
    void runSearch(s)
  }, [withInput, seed, runSearch])

  /** 搜索页：父组件每提交一次，nonce +1 */
  const lastNonce = useRef(0)
  useEffect(() => {
    if (withInput) return
    if (!nonce || nonce === lastNonce.current) return
    lastNonce.current = nonce
    void runSearch(keyword)
  }, [withInput, nonce, keyword, runSearch])

  const counts = useMemo(() => {
    const c = { all: playlists.length, name: 0, creator: 0, other: 0 }
    for (const p of playlists) c[p.match ?? 'other']++
    return c
  }, [playlists])

  const filtered = useMemo(
    () => (filter === 'all' ? playlists : playlists.filter(p => (p.match ?? 'other') === filter)),
    [playlists, filter],
  )

  const tabs: { id: Filter; label: string; count: number }[] = [
    { id: 'all', label: '全部', count: counts.all },
    { id: 'name', label: '歌单名', count: counts.name },
    { id: 'creator', label: '创建者', count: counts.creator },
    { id: 'other', label: '相关推荐', count: counts.other },
  ]

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingBottom: 24 }}
      keyboardShouldPersistTaps="handled"
    >
      {withInput ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingTop: 14 }}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="搜歌单，例如「通勤」「爵士」"
            placeholderTextColor={colors.fainter}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={() => void runSearch(input)}
            style={{
              flex: 1, backgroundColor: colors.surface, borderRadius: 12,
              paddingHorizontal: 14, paddingVertical: 10, color: colors.fg, fontSize: 14,
              borderWidth: 1, borderColor: colors.divider,
            }}
          />
          <Pressable
            onPress={() => void runSearch(input)}
            disabled={busy || !input.trim()}
            style={{
              backgroundColor: colors.accent, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10,
              opacity: busy || !input.trim() ? 0.4 : 1,
            }}
          >
            <Text style={{ color: '#fff', fontSize: 13 }}>{busy ? '搜索中…' : '搜索'}</Text>
          </Pressable>
        </View>
      ) : null}

      {error ? (
        <Text style={{ color: colors.accent, fontSize: 13, paddingHorizontal: 20, paddingTop: 14 }}>{error}</Text>
      ) : null}

      {searched && !busy && !playlists.length && !error ? (
        <Text style={{ color: colors.fainter, fontSize: 13, paddingHorizontal: 20, paddingTop: 18 }}>
          没有找到相关歌单
        </Text>
      ) : null}

      {!searched ? (
        <Text style={{ color: colors.fainter, fontSize: 13, paddingHorizontal: 20, paddingTop: 18, lineHeight: 19 }}>
          搜的是歌单（不是单曲）。网易云会同时匹配歌单名和创建者昵称，结果会按命中位置分类。
        </Text>
      ) : null}

      {searched && playlists.length ? (
        <>
          {/* 命中类型筛选 */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 20, gap: 8, paddingTop: 14, paddingBottom: 8 }}
          >
            {tabs.map(t => {
              const active = filter === t.id
              return (
                <Pressable
                  key={t.id}
                  onPress={() => setFilter(t.id)}
                  style={{
                    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14,
                    borderWidth: 1, borderColor: active ? colors.accent : colors.divider,
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

          {/* 创建者精确搜的开关 */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingBottom: 8 }}>
            {creatorOnly ? (
              <>
                <Text style={{ color: colors.accent, fontSize: 12, flex: 1 }}>
                  只看创建者「{creatorName}」：共 {total} 张自建歌单（已排除 TA 收藏的别人的歌单）
                </Text>
                <Pressable onPress={backToKeyword} hitSlop={8}
                  style={{ borderWidth: 1, borderColor: colors.divider, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>返回关键词搜索</Text>
                </Pressable>
              </>
            ) : (
              <Pressable onPress={() => void onlyCreator(withInput ? input : keyword)} hitSlop={8}
                style={{ borderWidth: 1, borderColor: colors.divider, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}>
                <Text style={{ color: colors.muted, fontSize: 12 }}>只看同名创建者</Text>
              </Pressable>
            )}
          </View>

          {creatorOnly ? null : (
            <Text style={{ color: colors.fainter, fontSize: 12, marginBottom: 10, paddingHorizontal: 20 }}>
              共 {total} 个歌单，显示前 {playlists.length} 个
            </Text>
          )}

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14, paddingHorizontal: 20 }}>
            {filtered.map(p => (
              <View key={p.id} style={{ width: '46%' }}>
                <Pressable onPress={() => onOpen(p.id, p.name, p.cover)}>
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
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                  <Text style={{
                    color: p.match === 'creator' ? '#4ade80' : colors.fainter,
                    fontSize: 10.5,
                    backgroundColor: colors.surface,
                    borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2, overflow: 'hidden',
                  }}>
                    {MATCH_LABEL[p.match ?? 'other']}
                  </Text>
                  {p.match === 'creator' ? (
                    <Pressable onPress={() => void onlyCreator(p.creator)} hitSlop={6}>
                      <Text style={{ color: colors.accent, fontSize: 11 }}>只看 TA 的歌单</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            ))}
          </View>
        </>
      ) : null}
    </ScrollView>
  )
}
