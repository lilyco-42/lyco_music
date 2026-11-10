/**
 * 我的音乐（移动端）—— 收藏 / 最近播放
 *
 * 曲库是内核级的，与桌面端读同一份数据，所以这里看到的就是同步过去的内容。
 */
import { useCallback, useEffect, useState } from 'react'
import { FlatList, Modal, Pressable, Text, TextInput, View } from 'react-native'
import { importWyPlaylistToLibrary, type MusicItem, type SourceId } from '@lxmn/core'
import { play, usePlayerState } from '../player'
import { library } from '../sync'
import { getShared } from '../share'
import { colors, useTopInset } from '../theme'

type Tab = 'trial' | 'fav' | 'recent'

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
  const [tab, setTab] = useState<Tab>('trial')
  const [rows, setRows] = useState<Row[]>([])
  const [playlists, setPlaylists] = useState<{ id: string; name: string }[]>([])
  const st = usePlayerState()

  const pull = useCallback(() => {
    const s = library.snapshot()
    setPlaylists(s.playlists.map(p => ({ id: p.id, name: p.name })))
    setRows(
      tab === 'trial'
        ? s.trial.map(item => ({ item, playedAt: 0 }))
        : tab === 'fav'
          ? s.favorites.map(item => ({ item, playedAt: 0 }))
          : s.history.map(h => ({ item: h, playedAt: h.playedAt })),
    )
  }, [tab])

  /** 从试听列表移出一首（移动端没有悬停，用行尾的 ✕） */
  const dropTrial = useCallback(
    (item: MusicItem) => library.removeFromTrial(item).then(pull),
    [pull],
  )

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

  // 网易云歌单导入：粘链接/短链，读歌单后建成自建歌单（桌面端同一份内核逻辑）
  const [wyOpen, setWyOpen] = useState(false)
  const [wyText, setWyText] = useState('')
  const [wyBusy, setWyBusy] = useState(false)
  const [wyMsg, setWyMsg] = useState('')
  const [wyErr, setWyErr] = useState('')

  function openWyImport() {
    setWyOpen(true)
    setWyText('')
    setWyMsg('')
    setWyErr('')
  }

  async function doWyImport() {
    if (wyBusy || !wyText.trim()) return
    setWyBusy(true)
    setWyErr('')
    setWyMsg('')
    try {
      const r = await importWyPlaylistToLibrary(wyText, library)
      setWyMsg('已导入「' + r.name + '」共 ' + r.added + ' 首（歌单 ' + r.total + ' 首）')
      setWyText('')
      pull()
    } catch (e) {
      setWyErr(e instanceof Error ? e.message : String(e))
    } finally {
      setWyBusy(false)
    }
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

      {/* 功能入口行：账户 / 云同步 / 好友 / 网易云导入。
          原来是三个独立标签，挤在 7 个标签的一行里；收进这里之后
          标签栏才腾得出位置给迷你播放条和更大的字号。
          「网易云导入」不依赖任何 props，始终在。 */}
      <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingTop: 16 }}>
        {([
          ['账户', onOpenAccount],
          ['云同步', onOpenSync],
          ['好友', onOpenFriends],
          ['网易云导入', openWyImport],
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
              <Text numberOfLines={1} style={{ color: colors.fg, fontSize: 13.5 }}>{label}</Text>
            </Pressable>
          ) : null,
        )}
      </View>

      {/* 网易云歌单导入：粘链接/短链即可，不要求登录 */}
      <Modal visible={wyOpen} animationType="fade" transparent onRequestClose={() => setWyOpen(false)}>
        <Pressable
          onPress={() => setWyOpen(false)}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', paddingHorizontal: 20 }}
        >
          {/* 内层拦住点击，避免点输入框时把弹窗关掉 */}
          <Pressable onPress={() => {}} style={{ backgroundColor: colors.surface, borderRadius: 16, padding: 18 }}>
            <Text style={{ color: colors.fg, fontSize: 17, fontWeight: '700' }}>导入网易云歌单</Text>
            <Text style={{ color: colors.fainter, fontSize: 12, marginTop: 6, lineHeight: 18 }}>
              粘歌单链接、直接粘那串数字，或整个分享文案一起粘进来（163cn.tv 短链也能认）。
              只读取歌名/歌手/专辑/封面，播放仍走我们自己的音源（付费或下架的歌会自动换源）。
            </Text>
            <TextInput
              value={wyText}
              onChangeText={setWyText}
              placeholder="https://music.163.com/playlist?id=123456789"
              placeholderTextColor={colors.fainter}
              autoCapitalize="none"
              autoCorrect={false}
              multiline
              style={{
                marginTop: 12, minHeight: 74, textAlignVertical: 'top',
                backgroundColor: colors.bg, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13,
                color: colors.fg, fontSize: 14, borderWidth: 1, borderColor: colors.divider,
              }}
            />
            {wyMsg ? (
              <Text style={{ color: '#4ade80', fontSize: 12, marginTop: 10 }}>{wyMsg}</Text>
            ) : null}
            {wyErr ? (
              <Text style={{ color: colors.accent, fontSize: 12, marginTop: 10 }}>{wyErr}</Text>
            ) : null}
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
              <Pressable onPress={() => setWyOpen(false)}
                style={{ borderWidth: 1, borderColor: colors.divider, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9 }}>
                <Text style={{ color: colors.muted, fontSize: 13 }}>关闭</Text>
              </Pressable>
              <Pressable
                onPress={() => void doWyImport()}
                disabled={wyBusy || !wyText.trim()}
                style={{
                  backgroundColor: colors.accent, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 9,
                  opacity: wyBusy || !wyText.trim() ? 0.4 : 1,
                }}
              >
                <Text style={{ color: '#fff', fontSize: 13 }}>{wyBusy ? '导入中…' : '开始导入'}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* 标签 */}
      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingVertical: 14 }}>
        {([['trial', '试听列表'], ['fav', '我喜欢的'], ['recent', '最近播放']] as const).map(([k, label]) => (
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
        {tab === 'trial' && rows.length ? (
          <Pressable
            onPress={() => void library.clearTrial().then(pull)}
            hitSlop={10}
            style={{ marginLeft: 'auto', paddingHorizontal: 10, paddingVertical: 8 }}
          >
            <Text style={{ color: colors.fainter, fontSize: 12.5 }}>清空</Text>
          </Pressable>
        ) : null}
      </View>

      {!rows.length ? (
        <Text style={{ color: colors.fainter, paddingHorizontal: 20, fontSize: 14 }}>
          {tab === 'trial'
            ? '试听列表是空的。在搜索页点一首歌，它就会进来。'
            : tab === 'fav'
              ? '还没有收藏。在搜索页点右侧的心形即可收藏。'
              : '还没有播放记录。'}
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

                {tab === 'trial' ? (
                  <Pressable onPress={() => void dropTrial(row.item)} hitSlop={12} style={{ paddingHorizontal: 4 }}>
                    <Text style={{ color: colors.fainter, fontSize: 16 }}>✕</Text>
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
