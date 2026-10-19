/**
 * 播放器页 —— 全屏黑胶 + 歌词 + 控制条
 * 实测规格：黑胶外圈直径 ~300，内圈 ~180；歌词区自下而上；
 * 播放按钮红色圆形 64px；底部功能行 4 个图标。
 *
 * 数据全部来自 src/player.ts（react-native-track-player + @lxmn/core），
 * 没有写死的示例歌词；歌词由内核 parseLrc 解析、二分跟随进度高亮。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, FlatList, Image, Modal, Pressable, ScrollView, Share, Text, View } from 'react-native'
import {
  ChevronDownIcon, MoreIcon, HeartIcon, CommentIcon, ShareIcon, ListIcon,
  LoopIcon, ShuffleIcon, SkipIcon, PlayIcon, PauseIcon,
} from '../components/Icons'
import { colors, topInset } from '../theme'
import { library } from '../sync'
import { safe } from '../lib/safe'
import {
  currentItem, cycleMode, cycleQuality, modeLabel, next, play, prev, seek, toggle,
  useLyricLines, usePlayerState, useProgressState,
} from '../player'
import { getSource, hasSource, type MusicComment } from '@lxmn/core'

// GPT 生成的默认封面占位图（Metro 只打包静态 require 的资源）
// eslint-disable-next-line @typescript-eslint/no-require-imports
const DEFAULT_COVER = require('../assets/art/cover-default.jpg') as number

function fmt(t: number): string {
  if (!Number.isFinite(t) || t < 0) t = 0
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')
}

/** 判断当前曲目是否已收藏（曲库快照里按 source+songmid 比对） */
function isFav(item: { source?: string; songmid?: unknown } | null): boolean {
  if (!item) return false
  return library.snapshot().favorites.some(
    f => f.source === item.source && String(f.songmid) === String(item.songmid),
  )
}

export default function PlayerScreen() {
  const st = usePlayerState()
  const { position, duration, playing } = useProgressState()
  const { lines, activeIndex } = useLyricLines()
  const item = currentItem()
  const listRef = useRef<FlatList>(null)

  const progress = duration > 0 ? Math.min(1, position / duration) : 0

  // 爱心：真实写入曲库，并立即反映到图标实心/空心
  const [fav, setFav] = useState(false)
  useEffect(() => { setFav(isFav(item)) }, [item?.songmid, item?.source])
  const onToggleFav = useCallback(async () => {
    if (!item) return
    await library.toggleFavorite(item)
    setFav(isFav(item))
  }, [item])

  /* ---------------- 歌词 / 评论 切换 ---------------- */

  const [pane, setPane] = useState<'lyric' | 'comment'>('lyric')
  const [comments, setComments] = useState<MusicComment[]>([])
  const [commentTotal, setCommentTotal] = useState(0)
  const [commentPage, setCommentPage] = useState(1)
  const [commentLoading, setCommentLoading] = useState(false)
  const [commentError, setCommentError] = useState('')
  const [commentMore, setCommentMore] = useState(false)
  const [queueOpen, setQueueOpen] = useState(false)

  /** 只有实现了 getComments 的音源才有评论（当前是网易云） */
  const canComment = !!item && hasSource(item.source) && Boolean(getSource(item.source).getComments)

  const loadComments = useCallback(async (reset: boolean) => {
    if (!item) return
    if (!hasSource(item.source) || !getSource(item.source).getComments) return
    const page = reset ? 1 : commentPage
    setCommentLoading(true)
    setCommentError('')
    try {
      const res = await getSource(item.source).getComments!(item, page, 20)
      setComments(prev => (reset ? res.list : [...prev, ...res.list]))
      setCommentTotal(res.total)
      setCommentMore(res.more)
      setCommentPage(page + 1)
    } catch (e) {
      setCommentError(e instanceof Error ? e.message : String(e))
    } finally {
      setCommentLoading(false)
    }
  }, [item, commentPage])

  // 切歌或切到评论面板时按需加载
  useEffect(() => {
    if (pane !== 'comment') return
    setComments([])
    setCommentPage(1)
    void loadComments(true)
  }, [pane, item?.songmid, item?.source])

  const onShare = useCallback(() => {
    if (!item) return
    void Share.share({ message: item.name + ' - ' + item.singer + '（Lyco Music）' })
  }, [item])

  // 当前行滚到中间：按固定行高估算，比 measure 更省事也更稳
  const LINE_H = 46
  useEffect(() => {
    if (activeIndex < 0) return
    listRef.current?.scrollToOffset({ offset: Math.max(0, (activeIndex - 2) * LINE_H), animated: true })
  }, [activeIndex])

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: topInset }}>
      {/* 顶栏 */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14 }}>
        <Pressable hitSlop={12}>
          <ChevronDownIcon size={24} />
        </Pressable>
        <View style={{ alignItems: 'center', flex: 1, marginHorizontal: 12 }}>
          <Text numberOfLines={1} style={{ color: colors.fg, fontSize: 16, fontWeight: '600' }}>
            {item?.name ?? '未在播放'}
          </Text>
          <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 12, marginTop: 3 }}>
            {item?.singer ?? '—'}
          </Text>
        </View>
        <Pressable hitSlop={12}>
          <MoreIcon size={22} />
        </Pressable>
      </View>

      {/* 黑胶 */}
      <View style={{ alignItems: 'center', justifyContent: 'center', marginTop: 22 }}>
        <View
          style={{
            width: 300,
            height: 300,
            borderRadius: 150,
            backgroundColor: colors.surface,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1,
            borderColor: '#2c2c2c',
          }}
        >
          {/* 纹路圈 */}
          <View style={{ position: 'absolute', width: 258, height: 258, borderRadius: 129, borderWidth: 1, borderColor: '#2a2a2a' }} />
          <View style={{ position: 'absolute', width: 216, height: 216, borderRadius: 108, borderWidth: 1, borderColor: '#282828' }} />
          {/* 专辑封面 */}
          <View
            style={{
              width: 180,
              height: 180,
              borderRadius: 90,
              backgroundColor: colors.elevated,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 3,
              borderColor: colors.accent,
              overflow: 'hidden',
            }}
          >
            {st.picUrl ? (
              <Image source={{ uri: st.picUrl }} style={{ width: 180, height: 180 }} />
            ) : (
              <Image source={DEFAULT_COVER} style={{ width: 180, height: 180 }} />
            )}
          </View>
          {/* 中心轴 */}
          <View style={{ position: 'absolute', width: 14, height: 14, borderRadius: 7, backgroundColor: colors.bg }} />
        </View>
        {/* 唱臂示意 */}
        <View
          style={{
            position: 'absolute',
            top: -8,
            right: 44,
            width: 8,
            height: 118,
            borderRadius: 4,
            backgroundColor: '#3a3a3a',
            transform: [{ rotate: '22deg' }],
          }}
        />
      </View>

      {/* 状态提示：加载中 / 错误 / 音质 */}
      {(st.loading || st.error) && (
        <View style={{ alignItems: 'center', marginTop: 10 }}>
          <Text numberOfLines={1} style={{ color: st.error ? colors.accent : colors.muted, fontSize: 13, paddingHorizontal: 24 }}>
            {st.loading ? '正在获取播放地址…' : st.error}
          </Text>
        </View>
      )}

      {/* 歌词 / 评论：点底部评论图标切换 */}
      <View style={{ flex: 1, marginTop: 14 }}>
        {pane === 'comment' ? (
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 24, paddingBottom: 6 }}>
              <Text style={{ color: colors.fg, fontSize: 14 }}>评论</Text>
              {commentTotal > 0 ? <Text style={{ color: colors.fainter, fontSize: 12 }}>{commentTotal}</Text> : null}
              {!canComment ? <Text style={{ color: colors.fainter, fontSize: 12 }}>当前音源不提供评论</Text> : null}
            </View>
            {commentLoading && !comments.length ? (
              <View style={{ paddingTop: 30, alignItems: 'center' }}><ActivityIndicator color={colors.accent} /></View>
            ) : commentError ? (
              <Text style={{ color: colors.accent, paddingHorizontal: 24, fontSize: 13 }}>{commentError}</Text>
            ) : !comments.length ? (
              <Text style={{ color: colors.fainter, paddingHorizontal: 24, fontSize: 13 }}>还没有评论</Text>
            ) : (
              <FlatList
                data={comments}
                keyExtractor={(x, i) => x.id + '-' + i}
                contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 12 }}
                renderItem={({ item: cm }) => (
                  <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
                    {cm.avatar ? (
                      <Image source={{ uri: cm.avatar }} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.elevated }} />
                    ) : (
                      <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.elevated }} />
                    )}
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 12, flexShrink: 1 }}>{cm.userName || '匿名用户'}</Text>
                        {cm.hot ? (
                          <Text style={{ color: colors.accent, fontSize: 10, borderWidth: 1, borderColor: colors.accent, borderRadius: 3, paddingHorizontal: 3 }}>热评</Text>
                        ) : null}
                      </View>
                      <Text style={{ color: colors.fg, fontSize: 14, lineHeight: 20, marginTop: 4 }}>{cm.content}</Text>
                      <Text style={{ color: colors.fainter, fontSize: 11, marginTop: 4 }}>赞 {cm.likedCount}</Text>
                    </View>
                  </View>
                )}
                ListFooterComponent={
                  commentMore ? (
                    <Pressable
                      onPress={() => void loadComments(false)}
                      disabled={commentLoading}
                      style={{ borderWidth: 1, borderColor: colors.divider, borderRadius: 8, paddingVertical: 8, alignItems: 'center', marginBottom: 12 }}
                    >
                      <Text style={{ color: colors.muted, fontSize: 13 }}>{commentLoading ? '加载中…' : '查看更多评论'}</Text>
                    </Pressable>
                  ) : null
                }
              />
            )}
          </View>
        ) : lines.length ? (
          <FlatList
            ref={listRef}
            data={lines}
            keyExtractor={(_, i) => String(i)}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 32, paddingVertical: 60 }}
            renderItem={({ item: line, index }) => {
              const active = index === activeIndex
              const distance = Math.abs(index - activeIndex)
              return (
                <Pressable onPress={safe('歌词跳转', () => seek(line.time))}>
                  <Text
                    numberOfLines={1}
                    style={{
                      color: active ? colors.accent : colors.muted,
                      fontSize: active ? 18 : 15,
                      fontWeight: active ? '600' : '400',
                      textAlign: 'center',
                      marginVertical: 7,
                      opacity: distance === 0 ? 1 : distance <= 2 ? 0.7 : 0.35,
                    }}
                  >
                    {line.text || '·'}
                  </Text>
                  {!!line.translation && (
                    <Text
                      numberOfLines={1}
                      style={{
                        color: active ? colors.muted : colors.fainter,
                        fontSize: 13,
                        textAlign: 'center',
                        marginBottom: 6,
                        opacity: distance <= 2 ? 0.9 : 0.4,
                      }}
                    >
                      {line.translation}
                    </Text>
                  )}
                </Pressable>
              )
            }}
          />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: colors.fainter, fontSize: 14 }}>
              {st.lyric ? '歌词解析中…' : '暂无歌词'}
            </Text>
          </View>
        )}
      </View>

      {/* 进度条 */}
      <View style={{ paddingHorizontal: 24 }}>
        <View style={{ height: 3, borderRadius: 2, backgroundColor: '#2c2c2c', overflow: 'hidden' }}>
          <View style={{ width: `${progress * 100}%`, height: '100%', backgroundColor: colors.accent }} />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 7 }}>
          <Text style={{ color: colors.fainter, fontSize: 11 }}>{fmt(position)}</Text>
          <Text style={{ color: colors.fainter, fontSize: 11 }}>{fmt(duration)}</Text>
        </View>
      </View>

      {/* 控制条 */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 36, marginTop: 16 }}>
        <Pressable hitSlop={10} onPress={safe('切换音质', () => cycleQuality())}>
          <Text style={{ color: colors.muted, fontSize: 12 }}>{st.quality}</Text>
        </Pressable>
        <Pressable hitSlop={10} onPress={safe('上一首', () => prev())} disabled={!st.queue.length}>
          <SkipIcon size={24} direction="prev" />
        </Pressable>
        <Pressable
          onPress={safe('播放/暂停', () => toggle())}
          disabled={st.loading || !item}
          style={{
            width: 64,
            height: 64,
            borderRadius: 32,
            backgroundColor: colors.accent,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: st.loading || !item ? 0.5 : 1,
          }}
        >
          {playing ? <PauseIcon size={24} /> : <PlayIcon size={24} />}
        </Pressable>
        <Pressable hitSlop={10} onPress={safe('下一首', () => next())} disabled={!st.queue.length}>
          <SkipIcon size={24} direction="next" />
        </Pressable>
        <Pressable
          hitSlop={10}
          onPress={safe('切换播放模式', () => cycleMode())}
          accessibilityLabel={modeLabel()}
          style={{ alignItems: 'center' }}
        >
          {st.mode === 'shuffle'
            ? <ShuffleIcon size={20} />
            : <LoopIcon size={20} single={st.mode === 'single'} color={st.mode === 'order' ? undefined : colors.accent} />}
        </Pressable>
      </View>

      {/* 底部功能行 */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingHorizontal: 32, paddingVertical: 20 }}>
        <Pressable hitSlop={10} onPress={safe('收藏', onToggleFav)} accessibilityLabel={fav ? '取消收藏' : '收藏'}>
            <HeartIcon size={22} filled={fav} color={fav ? colors.accent : undefined} />
          </Pressable>
        <Pressable
          hitSlop={10}
          onPress={safe('切换评论', () => setPane(p => (p === 'comment' ? 'lyric' : 'comment')))}
          accessibilityLabel={pane === 'comment' ? '返回歌词' : '查看评论'}
        >
          <CommentIcon size={22} color={pane === 'comment' ? colors.accent : undefined} />
        </Pressable>
        <Pressable hitSlop={10} onPress={safe('分享', onShare)} accessibilityLabel="分享">
          <ShareIcon size={22} />
        </Pressable>
        <Pressable hitSlop={10} onPress={safe('打开播放列表', () => setQueueOpen(true))} accessibilityLabel="播放列表">
          <ListIcon size={22} />
        </Pressable>
      </View>

      {/* 播放列表弹层 */}
      <Modal visible={queueOpen} animationType="slide" transparent onRequestClose={() => setQueueOpen(false)}>
        <View style={{ flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '70%', paddingBottom: 20 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14 }}>
              <Text style={{ color: colors.fg, fontSize: 15, fontWeight: '600' }}>播放列表（{st.queue.length}）</Text>
              <Pressable onPress={() => setQueueOpen(false)} hitSlop={10}>
                <Text style={{ color: colors.muted, fontSize: 14 }}>关闭</Text>
              </Pressable>
            </View>
            <ScrollView>
              {st.queue.map((q, i) => (
                <Pressable
                  key={q.source + '-' + String(q.songmid) + '-' + i}
                  onPress={safe('队列选歌', () => { setQueueOpen(false); return play(q) })}
                  style={{ paddingHorizontal: 20, paddingVertical: 10 }}
                >
                  <Text numberOfLines={1} style={{ color: i === st.index ? colors.accent : colors.fg, fontSize: 14 }}>
                    {q.name}
                  </Text>
                  <Text numberOfLines={1} style={{ color: colors.fainter, fontSize: 12, marginTop: 2 }}>{q.singer}</Text>
                </Pressable>
              ))}
              {!st.queue.length ? <Text style={{ color: colors.fainter, padding: 20, fontSize: 13 }}>队列为空</Text> : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  )
}
