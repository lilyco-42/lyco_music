/**
 * 我的音乐（移动端）—— 收藏 / 最近播放
 *
 * 曲库是内核级的，与桌面端读同一份数据，所以这里看到的就是同步过去的内容。
 */
import { useCallback, useEffect, useState } from 'react'
import { FlatList, Pressable, Text, View } from 'react-native'
import type { MusicItem, SourceId } from '@lxmn/core'
import { play, usePlayerState } from '../player'
import { library } from '../sync'
import { getShared } from '../share'
import { colors, useTopInset } from '../theme'

type Tab = 'fav' | 'recent'

interface Row {
  item: MusicItem
  playedAt: number
}

interface Props {
  /** 打开账户页（登录 / 头像 / 权益）。「我的」是用户找账户的自然位置。 */
  onOpenAccount?: () => void
  /** 云同步。以前是底部一个独立标签，现在收进「我的」的入口行。 */
  onOpenSync?: () => void
  /** 好友 / 分享导入。同上。 */
  onOpenFriends?: () => void
}

export default function MyMusicScreen({ onOpenAccount, onOpenSync, onOpenFriends }: Props) {
  const insetTop = useTopInset()
  const [tab, setTab] = useState<Tab>('fav')
  const [rows, setRows] = useState<Row[]>([])
  const [playlists, setPlaylists] = useState<{ id: string; name: string }[]>([])
  const st = usePlayerState()

  const pull = useCallback(() => {
    const s = library.snapshot()
    setPlaylists(s.playlists.map(p => ({ id: p.id, name: p.name })))
    setRows(
      tab === 'fav'
        ? s.favorites.map(item => ({ item, playedAt: 0 }))
        : s.history.map(h => ({ item: h, playedAt: h.playedAt })),
    )
  }, [tab])

  useEffect(() => {
    void library.load().then(pull)
  }, [pull])

  // 分享导入：好友页「导入」按钮把码放在全局（RN 无 sessionStorage）
  const [importPrompt, setImportPrompt] = useState<{ code: string; name: string; count: number } | null>(null)
  useEffect(() => {
    const g = globalThis as { __lycoImportShare?: string }
    const code = g.__lycoImportShare
    if (!code) return
    delete g.__lycoImportShare
    void (async () => {
      const s = await getShared(code)
      if (s) setImportPrompt({ code, name: s.name, count: s.trackCount })
    })()
  }, [])

  async function confirmImport() {
    const pr = importPrompt
    if (!pr) return
    const s = await getShared(pr.code)
    if (!s) { setImportPrompt(null); return }
    const pl = await library.createPlaylist(s.name || '导入的歌单')
    for (const t of s.tracks) {
      await library.addToPlaylist(pl.id, { ...t, id: t.songmid, source: t.source as SourceId })
    }
    setImportPrompt(null)
    pull()
  }

  async function unfav(item: MusicItem) {
    await library.removeFavorite(item)
    pull()
  }

  async function addTo(playlistId: string, item: MusicItem) {
    await library.addToPlaylist(playlistId, item)
    pull()
  }

  function fmtTime(ms: number): string {
    if (!ms) return ''
    const d = new Date(ms)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  }

  const currentId = st.queue[st.index]?.songmid

  return (

    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insetTop }}>
{importPrompt ? (
        <View style={{
          marginHorizontal: 16, marginTop: 8, padding: 12, borderRadius: 12,
          backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.accent,
          flexDirection: 'row', alignItems: 'center', gap: 10,
        }}>
          <Text style={{ color: colors.fg, fontSize: 13, flex: 1 }} numberOfLines={1}>
            导入「{importPrompt.name}」（{importPrompt.count} 首）？
          </Text>
          <Pressable onPress={() => { void confirmImport() }}
            style={{ backgroundColor: colors.accent, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 }}>
            <Text style={{ color: '#fff', fontSize: 12 }}>导入</Text>
          </Pressable>
          <Pressable onPress={() => setImportPrompt(null)}
            style={{ borderWidth: 1, borderColor: colors.divider, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 }}>
            <Text style={{ color: colors.muted, fontSize: 12 }}>取消</Text>
          </Pressable>
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 12 }}>
        <Text style={{ color: colors.fg, fontSize: 24, fontWeight: '700', flex: 1 }}>我的音乐</Text>
      </View>

      {/* 功能入口行：账户 / 云同步 / 好友。
          原来是三个独立标签，挤在 7 个标签的一行里；收进这里之后
          标签栏才腾得出位置给迷你播放条和更大的字号。 */}
      <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingTop: 16 }}>
        {([
          ['账户', onOpenAccount],
          ['云同步', onOpenSync],
          ['好友', onOpenFriends],
        ] as const).map(([label, fn]) =>
          fn ? (
            <Pressable
              key={label}
              onPress={fn}
              style={{
                flex: 1, borderRadius: 12, paddingVertical: 14,
                backgroundColor: colors.surface, alignItems: 'center',
              }}
            >
              <Text style={{ color: colors.fg, fontSize: 13.5 }}>{label}</Text>
            </Pressable>
          ) : null,
        )}
      </View>

      {/* 标签 */}
      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingVertical: 14 }}>
        {([['fav', '我喜欢的'], ['recent', '最近播放']] as const).map(([k, label]) => (
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

      {!rows.length ? (
        <Text style={{ color: colors.fainter, paddingHorizontal: 20, fontSize: 14 }}>
          {tab === 'fav' ? '还没有收藏。在搜索页点右侧的心形即可收藏。' : '还没有播放记录。'}
        </Text>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={r => r.item.source + '-' + String(r.item.songmid)}
          renderItem={({ item: row, index }) => {
            const active = row.item.songmid === currentId
            return (
              <Pressable
                onPress={() => void play(row.item, rows.map(r => r.item))}
                style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10, gap: 12 }}
              >
                <Text style={{ color: colors.fainter, fontSize: 13, width: 20 }}>{index + 1}</Text>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ color: active ? colors.accent : colors.fg, fontSize: 15 }}>
                    {row.item.name}
                  </Text>
                  <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 12, marginTop: 3 }}>
                    {row.item.singer}
                    {tab === 'recent' && row.playedAt ? ' · ' + fmtTime(row.playedAt) : ''}
                  </Text>
                </View>

                {/* 加入歌单：没有歌单就不显示，避免点了没反应 */}
                {playlists.length ? (
                  <Pressable
                    onPress={() => void addTo(playlists[0]!.id, row.item)}
                    hitSlop={10}
                    style={{ paddingHorizontal: 6, paddingVertical: 6 }}
                  >
                    <Text style={{ color: colors.fainter, fontSize: 15 }}>＋</Text>
                  </Pressable>
                ) : null}

                {tab === 'fav' ? (
                  <Pressable onPress={() => void unfav(row.item)} hitSlop={12} style={{ paddingHorizontal: 4 }}>
                    <Text style={{ color: colors.accent, fontSize: 17 }}>♥</Text>
                  </Pressable>
                ) : null}
              </Pressable>
            )
          }}
        />
      )}
    </View>
  )
}
