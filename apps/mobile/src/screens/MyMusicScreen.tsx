/**
 * 我的音乐（移动端）—— 收藏 / 最近播放
 *
 * 曲库是内核级的，与桌面端读同一份数据，所以这里看到的就是同步过去的内容。
 */
import { useCallback, useEffect, useState } from 'react'
import { FlatList, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { importWyPlaylistToLibrary, type MusicItem, type SourceId } from '@lxmn/core'
import { play, usePlayerState } from '../player'
import { library } from '../sync'
import { getShared } from '../share'
import { colors, useTopInset } from '../theme'
import { t as tr, tf, useLocale } from '../lib/i18n'

type Tab = 'trial' | 'fav' | 'recent' | 'playlist'

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
  useLocale()
  const [tab, setTab] = useState<Tab>('trial')
  const [rows, setRows] = useState<Row[]>([])
  const [playlists, setPlaylists] = useState<{ id: string; name: string; count: number }[]>([])

  /**
   * 导入的歌单以前只能一张张删：移动端甚至没有「我的歌单」列表，
   * 想剔除几张得去桌面端。这里补一个多选模式，删除走内核 deletePlaylists，
   * 一次落盘、一次通知，不会让云同步被一串小改动刷爆。
   */
  const [batchMode, setBatchMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmBatch, setConfirmBatch] = useState(false)
  const [batchBusy, setBatchBusy] = useState(false)
  const [batchMsg, setBatchMsg] = useState('')
  const st = usePlayerState()

  const pull = useCallback(() => {
    const s = library.snapshot()
    setPlaylists(s.playlists.map(p => ({
      id: p.id,
      name: p.name,
      count: Array.isArray(p.items) ? p.items.length : 0,
    })))
    setRows(
      tab === 'playlist'
        ? []
        : tab === 'trial'
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

  function exitBatch() {
    setBatchMode(false)
    setSelected(new Set())
    setConfirmBatch(false)
    setBatchMsg('')
  }

  function changeTab(k: Tab) {
    setTab(k)
    if (k !== 'playlist') exitBatch()
  }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /** 点歌单卡片直接进多选，避免做一个「点进去什么都没有」的假详情 */
  function onPlaylistPress(id: string) {
    if (!batchMode) {
      setBatchMode(true)
      setSelected(new Set([id]))
    } else {
      toggleSelect(id)
    }
  }

  async function doBatchDelete() {
    const ids = [...selected]
    if (batchBusy || !ids.length) return
    setBatchBusy(true)
    setBatchMsg('')
    try {
      const n = await library.deletePlaylists(ids)
      pull()
      exitBatch()
      setBatchMsg(tf('mobile.my.deleted', { n }))
    } catch (e) {
      setBatchMsg(e instanceof Error ? e.message : String(e))
      setConfirmBatch(false)
    } finally {
      setBatchBusy(false)
    }
  }

  /** 歌单在别处（云同步/桌面端）被删掉时，别让选中集合留着幽灵 id */
  useEffect(() => {
    const alive = new Set(playlists.map(p => p.id))
    setSelected(prev => new Set([...prev].filter(id => alive.has(id))))
    if (batchMode && !playlists.length) exitBatch()
  }, [playlists, batchMode])

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
    const pl = await library.createPlaylist(s.name || tr('mobile.my.importedPlaylist'))
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
      setWyMsg(tf('mobile.my.imported', { name: r.name, added: r.added, total: r.total }))
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
            {tf('mobile.my.importPrompt', { name: importPrompt.name, count: importPrompt.count })}
          </Text>
          <Pressable onPress={() => { void confirmImport() }}
            style={{ backgroundColor: colors.accent, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 }}>
            <Text style={{ color: '#fff', fontSize: 12 }}>{tr('mobile.my.import')}</Text>
          </Pressable>
          <Pressable onPress={() => setImportPrompt(null)}
            style={{ borderWidth: 1, borderColor: colors.divider, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 }}>
            <Text style={{ color: colors.muted, fontSize: 12 }}>{tr('common.cancel')}</Text>
          </Pressable>
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 12 }}>
        <Text style={{ color: colors.fg, fontSize: 24, fontWeight: '700', flex: 1 }}>{tr('my.title')}</Text>
      </View>

      {/* 功能入口行：账户 / 云同步 / 好友 / 网易云导入。
          原来是三个独立标签，挤在 7 个标签的一行里；收进这里之后
          标签栏才腾得出位置给迷你播放条和更大的字号。
          「网易云导入」不依赖任何 props，始终在。 */}
      <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingTop: 16 }}>
        {([
          ['mobile.my.account', onOpenAccount],
          ['mobile.my.sync', onOpenSync],
          ['mobile.my.friends', onOpenFriends],
          ['mobile.my.neteaseImport', openWyImport],
        ] as const).map(([labelKey, fn]) =>
          fn ? (
            <Pressable
              key={labelKey}
              onPress={fn}
              style={{
                flex: 1, borderRadius: 12, paddingVertical: 14,
                backgroundColor: colors.surface, alignItems: 'center',
              }}
            >
              <Text numberOfLines={1} style={{ color: colors.fg, fontSize: 13.5 }}>{tr(labelKey)}</Text>
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
            <Text style={{ color: colors.fg, fontSize: 17, fontWeight: '700' }}>{tr('mobile.my.importTitle')}</Text>
            <Text style={{ color: colors.fainter, fontSize: 12, marginTop: 6, lineHeight: 18 }}>
              {tr('mobile.my.importHint')}
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
                <Text style={{ color: colors.muted, fontSize: 13 }}>{tr('common.close')}</Text>
              </Pressable>
              <Pressable
                onPress={() => void doWyImport()}
                disabled={wyBusy || !wyText.trim()}
                style={{
                  backgroundColor: colors.accent, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 9,
                  opacity: wyBusy || !wyText.trim() ? 0.4 : 1,
                }}
              >
                <Text style={{ color: '#fff', fontSize: 13 }}>{wyBusy ? tr('mobile.my.importing') : tr('mobile.my.importStart')}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* 标签 */}
      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingVertical: 14 }}>
        {([['trial', 'mobile.my.tabTrial'], ['fav', 'mobile.my.tabFav'], ['recent', 'mobile.my.tabRecent'], ['playlist', 'mobile.my.tabPlaylist']] as const).map(([k, labelKey]) => (
          <Pressable
            key={k}
            onPress={() => changeTab(k)}
            style={{
              borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8,
              backgroundColor: tab === k ? colors.accent : colors.surface,
            }}
          >
            <Text style={{ color: tab === k ? '#fff' : colors.muted, fontSize: 13.5 }}>{tr(labelKey)}</Text>
          </Pressable>
        ))}
        {tab === 'trial' && rows.length ? (
          <Pressable
            onPress={() => void library.clearTrial().then(pull)}
            hitSlop={10}
            style={{ marginLeft: 'auto', paddingHorizontal: 10, paddingVertical: 8 }}
          >
            <Text style={{ color: colors.fainter, fontSize: 12.5 }}>{tr('mobile.my.clear')}</Text>
          </Pressable>
        ) : null}
      </View>

      {tab === 'playlist' ? (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}>
          {batchMode ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, paddingBottom: 10 }}>
              <Text style={{ color: colors.muted, fontSize: 12.5, marginRight: 'auto' }}>
                {tf('mobile.my.selected', { n: selected.size })}
              </Text>
              <Pressable
                onPress={() => setSelected(new Set(playlists.map(p => p.id)))}
                style={{ borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: colors.surface }}
              >
                <Text style={{ color: colors.fg, fontSize: 12 }}>{tr('mobile.my.selectAll')}</Text>
              </Pressable>
              <Pressable
                onPress={() => setConfirmBatch(true)}
                disabled={!selected.size || batchBusy}
                style={{
                  borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7,
                  backgroundColor: colors.accent, opacity: !selected.size || batchBusy ? 0.4 : 1,
                }}
              >
                <Text style={{ color: '#fff', fontSize: 12 }}>{tr('mobile.my.deleteSelected')}</Text>
              </Pressable>
              <Pressable
                onPress={exitBatch}
                style={{ borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: colors.surface }}
              >
                <Text style={{ color: colors.muted, fontSize: 12 }}>{tr('mobile.my.exit')}</Text>
              </Pressable>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingBottom: 10 }}>
              <Text style={{ color: colors.fainter, fontSize: 12, flex: 1 }}>
                {tf('mobile.my.playlistCount', { n: playlists.length })}
              </Text>
              <Pressable
                onPress={() => setBatchMode(true)}
                style={{ borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: colors.surface }}
              >
                <Text style={{ color: colors.fg, fontSize: 12 }}>{tr('mobile.my.batch')}</Text>
              </Pressable>
            </View>
          )}

          {confirmBatch ? (
            <View style={{
              flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8,
              padding: 10, marginBottom: 10, borderRadius: 10,
              backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.accent,
            }}>
              <Text style={{ color: colors.fg, fontSize: 12.5, flex: 1, minWidth: 160 }}>
                {tf('mobile.my.confirmDelete', { n: selected.size })}
              </Text>
              <Pressable
                onPress={() => void doBatchDelete()}
                disabled={batchBusy}
                style={{ borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: colors.accent }}
              >
                <Text style={{ color: '#fff', fontSize: 12 }}>{batchBusy ? tr('mobile.my.deleting') : tr('mobile.my.confirm')}</Text>
              </Pressable>
              <Pressable
                onPress={() => setConfirmBatch(false)}
                style={{ borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: colors.divider }}
              >
                <Text style={{ color: colors.muted, fontSize: 12 }}>{tr('common.cancel')}</Text>
              </Pressable>
            </View>
          ) : null}

          {batchMsg ? (
            <Text style={{ color: colors.fainter, fontSize: 12, paddingBottom: 8 }}>{batchMsg}</Text>
          ) : null}

          {!playlists.length ? (
            <Text style={{ color: colors.fainter, fontSize: 14, paddingTop: 12 }}>
              {tr('mobile.my.emptyPlaylists')}
            </Text>
          ) : playlists.map(pl => {
            const picked = selected.has(pl.id)
            return (
              <Pressable
                key={pl.id}
                onPress={() => onPlaylistPress(pl.id)}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 12,
                  paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.divider,
                }}
              >
                <View style={{
                  width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center',
                  borderWidth: 1, borderColor: picked ? colors.accent : colors.divider,
                  backgroundColor: picked ? colors.accent : 'transparent',
                }}>
                  {picked ? <Text style={{ color: '#fff', fontSize: 13 }}>✓</Text> : null}
                </View>
                <Text numberOfLines={1} style={{ color: colors.fg, fontSize: 15, flex: 1 }}>{pl.name}</Text>
                <Text style={{ color: colors.fainter, fontSize: 12 }}>{tf('mobile.my.tracks', { n: pl.count })}</Text>
              </Pressable>
            )
          })}
        </ScrollView>
      ) : !rows.length ? (
        <Text style={{ color: colors.fainter, paddingHorizontal: 20, fontSize: 14 }}>
          {tab === 'trial'
            ? tr('my.trialEmpty')
            : tab === 'fav'
              ? tr('my.favEmpty')
              : tr('my.recentEmpty')}
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
