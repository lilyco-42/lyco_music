/**
 * 播放器页 —— 全屏，左右滑动切换「封面 / 歌词」两页。
 *
 * 版式参照两处：
 * 1. 网易云：黑胶唱片占据接近满宽、底部胶囊控制条、进度条带拖拽圆点；
 * 2. lx-music-mobile：封面与歌词分两页左右滑动（`PagerView`），
 *    而不是上下堆叠。
 *
 * 之前的问题是封面和歌词上下挤在一起：歌词区被夹在唱片和进度条之间，
 * 当前行还会被进度条压住；唱片只有 300px（屏宽 1080 的 28%），显得小气。
 * 现在封面页独占一屏、歌词页独占一屏，两页都拿到足够空间。
 *
 * 手势没有引入 react-native-pager-view（那是原生依赖，装它要重编 24 分钟），
 * 用原生 ScrollView（horizontal + pagingEnabled）翻页，热替换 bundle 即可验证。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator, FlatList, Image, Modal, NativeModules, PanResponder, Pressable,
  Dimensions, ScrollView, Share, StatusBar, Text, useWindowDimensions, View,
} from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import {
  ChevronDownIcon, HeartIcon, CommentIcon, ShareIcon, ListIcon,
  LoopIcon, ShuffleIcon, SkipIcon, PlayIcon, PauseIcon,
} from '../components/Icons'
import { colors } from '../theme'
import { library } from '../sync'
import { safe } from '../lib/safe'
import Ambient, { useCoverColor } from '../components/Ambient'
import {
  currentItem, cycleMode, cycleQuality, modeLabel, next, play, prev, seek, toggle,
  useLyricLines, usePlayerState, useProgressState,
} from '../player'
import { getSource, hasSource, type MusicComment } from '@lxmn/core'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const DEFAULT_COVER = require('../assets/art/cover-default.jpg') as number

function fmt(t: number): string {
  if (!Number.isFinite(t) || t < 0) t = 0
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')
}

function isFav(item: { source?: string; songmid?: unknown } | null): boolean {
  if (!item) return false
  return library.snapshot().favorites.some(
    f => f.source === item.source && String(f.songmid) === String(item.songmid),
  )
}

/* ------------------------------------------------------------------ */
/* 可拖拽进度条                                                          */
/* ------------------------------------------------------------------ */

/**
 * 拖动时只更新本地预览值，松手才真正 seek —— 否则每帧都发一次 seek，
 * ExoPlayer 会不停重缓冲，听起来像卡带。
 */
function ProgressBar({
  position, duration, onSeek,
}: { position: number; duration: number; onSeek: (t: number) => void }) {
  const PAD = 24
  const [width, setWidth] = useState(0)
  const [drag, setDrag] = useState<number | null>(null)
  const widthRef = useRef(0)
  const durationRef = useRef(duration)
  durationRef.current = duration
  /** 按下时的比例。手势的 dx 是相对按下点的累计值，必须基于它换算，
   *  不能拿上一帧的值再累加 —— 那样每帧都会重复计入位移，越拖越偏。 */
  const grantRatioRef = useRef(0)

  const ratio = duration > 0 ? Math.min(1, Math.max(0, (drag ?? position) / duration)) : 0


  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: e => {
      const w = widthRef.current || 1
      // locationX 相对整个带内边距的容器，要减掉左右 padding 才是轨道内的位置
      const r = Math.max(0, Math.min(1, (e.nativeEvent.locationX - PAD) / w))
      grantRatioRef.current = r
      setDrag(r * durationRef.current)
    },
    onPanResponderMove: (_, g) => {
      const w = widthRef.current || 1
      const r = grantRatioRef.current + g.dx / w
      setDrag(Math.max(0, Math.min(1, r)) * durationRef.current)
    },
    onPanResponderRelease: () => {
      setDrag(d => {
        if (d != null) onSeek(d)
        return null
      })
    },
    onPanResponderTerminate: () => setDrag(null),
  }), [onSeek])

  return (
    <View
      style={{ paddingHorizontal: PAD, paddingTop: 14, paddingBottom: 2 }}
      // 上下留出触摸余量：3px 的条手指按不准
      {...pan.panHandlers}
      onLayout={e => {
        widthRef.current = e.nativeEvent.layout.width - PAD * 2
        setWidth(widthRef.current)
      }}
    >
      <View style={{ height: 22, justifyContent: 'center' }}>
        <View style={{ height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.22)' }}>
          <View style={{ width: `${ratio * 100}%`, height: '100%', borderRadius: 2, backgroundColor: colors.fg }} />
        </View>
        {/* 圆点：网易云同款，拖动时放大，给「可以拖」的暗示 */}
        <View
          style={{
            position: 'absolute',
            left: Math.max(0, ratio * (width || 0) - (drag != null ? 8 : 4)),
            width: drag != null ? 16 : 8,
            height: drag != null ? 16 : 8,
            borderRadius: drag != null ? 8 : 4,
            backgroundColor: colors.fg,
          }}
        />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 }}>
        <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11 }}>{fmt(drag ?? position)}</Text>
        <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11 }}>{fmt(duration)}</Text>
      </View>
    </View>
  )
}

/* ------------------------------------------------------------------ */
/* 播放页                                                              */
/* ------------------------------------------------------------------ */

export default function PlayerScreen({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const st = usePlayerState()
  const { position, duration, playing } = useProgressState()
  const { lines, activeIndex } = useLyricLines()
  const item = currentItem()
  const listRef = useRef<FlatList>(null)

  const { width: SCREEN_W, height: SCREEN_H } = useWindowDimensions()
  const [page, setPage] = useState(0)
  const pageRef = useRef(0)
  const pagerRef = useRef<ScrollView>(null)

  /**
   * 翻页用原生 ScrollView（horizontal + pagingEnabled），不用手搓 PanResponder。
   *
   * 手搓版本在这里有两个坑：横向手势要在「没有子节点愿意接管」时才会被父节点
   * 抢到，实测在 Modal 里经常抢不到；把动画改成原生驱动后又和拖拽时的
   * setValue 打架，出现「状态变了画面不动」。交给 ScrollView 之后，
   * 横向滑动、内部按钮点击、纵向歌词滚动三者由系统分配，不再互相干扰。
   */
  const goTo = useCallback((target: number) => {
    const nextPage = Math.max(0, Math.min(1, target))
    pageRef.current = nextPage
    setPage(nextPage)
    pagerRef.current?.scrollTo({ x: nextPage * SCREEN_W, animated: true })
  }, [SCREEN_W])

  /**
   * 把横向偏移同步成页码。
   *
   * **不能只靠 `onMomentumScrollEnd`。** 慢速拖动（手慢慢拖过半屏再松手）
   * 没有惯性，Android 上这个回调经常不触发，`page` 就永远停在 0 ——
   * 表现为歌词页看着已经翻过去了，但当前句永远不高亮也不滚动，用户
   * 看到的就是「播到 1 分多钟，还停在开头的作词作曲名单」。
   * 所以用 `onScroll` 实时算，`onMomentumScrollEnd` 保留作兜底。
   */
  const syncPage = useCallback(
    (x: number) => {
      const p = Math.max(0, Math.min(1, Math.round(x / SCREEN_W)))
      if (p !== pageRef.current) {
        pageRef.current = p
        setPage(p)
      }
    },
    [SCREEN_W],
  )

  // 关闭再打开时回到封面页，符合「重新进入播放器」的预期
  useEffect(() => {
    if (!visible) {
      pageRef.current = 0
      setPage(0)
      pagerRef.current?.scrollTo({ x: 0, animated: false })
    }
  }, [visible])

  /* ---------------- 收藏 ---------------- */
  const [fav, setFav] = useState(false)
  useEffect(() => { setFav(isFav(item)) }, [item?.songmid, item?.source])
  const onToggleFav = useCallback(async () => {
    if (!item) return
    await library.toggleFavorite(item)
    setFav(isFav(item))
  }, [item])

  /* ---------------- 歌词 / 评论 ---------------- */
  const [commentOpen, setCommentOpen] = useState(false)
  const [comments, setComments] = useState<MusicComment[]>([])
  const [commentTotal, setCommentTotal] = useState(0)
  const [commentPage, setCommentPage] = useState(1)
  const [commentLoading, setCommentLoading] = useState(false)
  const [commentError, setCommentError] = useState('')
  const [commentMore, setCommentMore] = useState(false)
  const [queueOpen, setQueueOpen] = useState(false)

  const canComment = !!item && hasSource(item.source) && Boolean(getSource(item.source).getComments)

  const loadComments = useCallback(async (reset: boolean) => {
    if (!item) return
    if (!hasSource(item.source) || !getSource(item.source).getComments) return
    const pageNo = reset ? 1 : commentPage
    setCommentLoading(true)
    setCommentError('')
    try {
      const res = await getSource(item.source).getComments!(item, pageNo, 20)
      setComments(prev => (reset ? res.list : [...prev, ...res.list]))
      setCommentTotal(res.total)
      setCommentMore(res.more)
      setCommentPage(pageNo + 1)
    } catch (e) {
      setCommentError(e instanceof Error ? e.message : String(e))
    } finally {
      setCommentLoading(false)
    }
  }, [item, commentPage])

  useEffect(() => {
    if (!commentOpen) return
    setComments([])
    setCommentPage(1)
    void loadComments(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commentOpen, item?.songmid, item?.source])

  const onShare = useCallback(() => {
    if (!item) return
    void Share.share({ message: item.name + ' - ' + item.singer + '（Lyco Music）' })
  }, [item])

  // 歌词居中滚动。
  //
  // 走过三条弯路，都记在这里，免得再踩：
  //
  // 1. 按 `activeIndex × 固定行高` 估算 —— 行高**不是常数**（选中行字号更大、
  //    带翻译的行更高、长句还会折行），播到后面越漂越远。
  // 2. 逐行 `onLayout` 拿行盒再算 offset —— **y 恒为 0**：FlatList 把每个 item
  //    包在自己的 CellRenderer 里，item 根节点的 onLayout 是相对那个包装层的，
  //    不是相对整个 content。于是 offset 永远是 0，列表一动不动。
  // 3. `scrollToIndex` + `viewPosition: 0.5` —— 行还没被 VirtualizedList 实测到时，
  //    它退化成「平均行高 × 序号」并把 viewPosition 丢掉，实测当前句会停在视口顶部。
  //
  // 最终做法：自己累加。**行高是可靠的**（只有 y 不可靠），按顺序把每行高度加起来，
  // 就得到这一行在 content 里的绝对位置，再减半个视口高就是居中偏移。
  // 没被渲染过的行（跳转/seek 之后）先用一个默认值，等它渲染出来再自动校正。
  const PAD_TOP = SCREEN_H * 0.22
  const DEFAULT_LINE_H = 56
  const activeIndexRef = useRef(activeIndex)
  const lineCountRef = useRef(0)
  const rowHRef = useRef<Record<number, number>>({})
  const listHRef = useRef(0)
  /** 用户正在手动滑歌词：这段时间不要自动抢滚动条 */
  const lyricDraggingRef = useRef(false)
  activeIndexRef.current = activeIndex
  lineCountRef.current = lines.length

  const offsetForIndex = useCallback(
    (i: number) => {
      const heights = rowHRef.current
      // 还没渲染过的行用「已测行的平均高度」兜底，比拍一个常数准得多：
      // 冷启动后直接拖到后段时，前半段的行都没测过，用 56 会累积出明显偏差。
      const measured = Object.values(heights)
      const fallback = measured.length
        ? measured.reduce((a, b) => a + b, 0) / measured.length
        : DEFAULT_LINE_H
      let y = PAD_TOP
      for (let k = 0; k < i; k++) y += heights[k] ?? fallback
      const h = heights[i] ?? fallback
      return Math.max(0, y + h / 2 - listHRef.current / 2)
    },
    [PAD_TOP],
  )

  const scrollToActive = useCallback(
    (animated: boolean) => {
      const i = activeIndexRef.current
      if (i < 0 || i >= lineCountRef.current || !listHRef.current) return
      if (lyricDraggingRef.current) return
      listRef.current?.scrollToOffset({ offset: offsetForIndex(i), animated })
    },
    [offsetForIndex],
  )

  // 注意：这里**不要**加 `if (page !== 1) return` 之类的守卫。
  // 歌词列表在封面页时也是挂载的，滚动它没有任何副作用；而一旦把
  // 「当前在第几页」当成前置条件，翻页状态一旦没同步上（见 syncPage 的注释），
  // 歌词就再也不会跟随播放。
  useEffect(() => {
    scrollToActive(true)
  }, [activeIndex, scrollToActive])

  const cover = typeof st.picUrl === 'string' && st.picUrl ? { uri: st.picUrl } : DEFAULT_COVER
  // 封面主色 → 背景渐变（取不到就是纯黑，不影响播放）
  const mood = useCoverColor(st.picUrl)
  // 唱片直径：留出边距，比原来的固定 300 大得多
  const disc = Math.min(SCREEN_W * 0.8, SCREEN_H * 0.4)
  const label = disc * 0.58

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      {/*
        播放页是 statusBarTranslucent 的全屏 Modal，会盖住状态栏，必须自己让出这段高度。
        但**不能**用外层的 useSafeAreaInsets()：主窗口本身已经被系统让出了状态栏
        （实测 inset.top = 0），Modal 是另一个窗口、才是真正 edge-to-edge 的那个，
        所以要在 Modal 内部再套一个 Provider，让它量自己这个窗口。
        Ambient 留在 SafeAreaView 外面，背景才能一直铺到状态栏后面。
      */}
      <SafeAreaProvider>
        <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
        <Ambient color={mood} />
        {/* 顶栏 */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 10 }}>
          <Pressable hitSlop={14} onPress={onClose} accessibilityLabel="收起播放页">
            <ChevronDownIcon size={26} />
          </Pressable>
          <View style={{ alignItems: 'center', flex: 1, marginHorizontal: 10 }}>
            <Text numberOfLines={1} style={{ color: colors.fg, fontSize: 16.5, fontWeight: '600' }}>
              {item?.name ?? '未在播放'}
            </Text>
            <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 12, marginTop: 3 }}>
              {item?.singer ?? '—'}
            </Text>
          </View>
          <Pressable hitSlop={14} onPress={safe('切换音质', () => cycleQuality())} accessibilityLabel={'音质 ' + st.quality}>
            <Text style={{ color: colors.muted, fontSize: 11.5 }}>{st.quality}</Text>
          </Pressable>
        </View>

        {/* 两页：封面 / 歌词，横向分页 */}
        <ScrollView
          ref={pagerRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={e => syncPage(e.nativeEvent.contentOffset.x)}
          onMomentumScrollEnd={e => syncPage(e.nativeEvent.contentOffset.x)}
          style={{ flex: 1 }}
        >
            {/* ---- 第 1 页：黑胶 ---- */}
            {/* overflow:hidden 必须有：唱臂是绝对定位、会超出页面右边界，
                翻到歌词页时会在屏幕左缘露出一截 */}
            <View style={{ width: SCREEN_W, height: '100%', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              <View style={{ width: disc, height: disc, alignItems: 'center', justifyContent: 'center' }}>
                {/* 唱臂：转轴 + 臂杆 + 唱头，整组一起旋转。
                    位置要留在页面内 —— 旋转变换会把包围盒撑大，right 取负值
                    很容易顶到屏幕边缘被裁掉。 */}
                <View
                  style={{
                    position: 'absolute',
                    top: -disc * 0.02,
                    right: disc * 0.02,
                    width: disc * 0.1,
                    height: disc * 0.46,
                    alignItems: 'center',
                    transform: [{ rotate: '22deg' }],
                    zIndex: 3,
                  }}
                >
                  {/* 转轴 */}
                  <View
                    style={{
                      width: disc * 0.085,
                      height: disc * 0.085,
                      borderRadius: disc * 0.0425,
                      backgroundColor: '#e6e6e6',
                    }}
                  />
                  {/* 臂杆 */}
                  <View
                    style={{
                      width: disc * 0.03,
                      height: disc * 0.29,
                      borderRadius: disc * 0.015,
                      backgroundColor: '#d2d2d2',
                      marginTop: -disc * 0.005,
                    }}
                  />
                  {/* 唱头 */}
                  <View
                    style={{
                      width: disc * 0.072,
                      height: disc * 0.055,
                      borderRadius: disc * 0.012,
                      backgroundColor: '#c2c2c2',
                      marginTop: -disc * 0.004,
                    }}
                  />
                </View>

                {/* 唱片外圈柔光：没有它，黑胶贴在深色背景上会糊成一块 */}
                <View
                  style={{
                    position: 'absolute',
                    width: disc * 1.08,
                    height: disc * 1.08,
                    borderRadius: disc * 0.54,
                    backgroundColor: 'rgba(255,255,255,0.045)',
                  }}
                />
                {/* 唱片本体 */}
                <View
                  style={{
                    width: disc,
                    height: disc,
                    borderRadius: disc / 2,
                    backgroundColor: '#141414',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: 1,
                    borderColor: '#262626',
                    elevation: 14,
                    shadowColor: '#000',
                    shadowOpacity: 0.55,
                    shadowRadius: 22,
                    shadowOffset: { width: 0, height: 10 },
                  }}
                >
                  {/* 纹路：三层同心圆，越外越淡 */}
                  {[0.92, 0.82, 0.72].map((r, i) => (
                    <View
                      key={i}
                      style={{
                        position: 'absolute',
                        width: disc * r,
                        height: disc * r,
                        borderRadius: (disc * r) / 2,
                        borderWidth: 1,
                        borderColor: `rgba(255,255,255,${0.045 - i * 0.01})`,
                      }}
                    />
                  ))}
                  {/* 唱片标签（专辑封面）。原版这里套了一圈红色描边，很扎眼，去掉 */}
                  <View
                    style={{
                      width: label,
                      height: label,
                      borderRadius: label / 2,
                      overflow: 'hidden',
                      backgroundColor: colors.elevated,
                    }}
                  >
                    <Image source={cover} style={{ width: label, height: label }} />
                  </View>
                  {/* 中心孔 */}
                  <View
                    style={{
                      position: 'absolute',
                      width: disc * 0.035,
                      height: disc * 0.035,
                      borderRadius: disc * 0.0175,
                      backgroundColor: colors.bg,
                    }}
                  />
                </View>
              </View>

              {/* 状态提示 */}
              {(st.loading || st.error) && (
                <Text
                  numberOfLines={2}
                  style={{
                    color: st.error ? colors.accent : colors.muted,
                    fontSize: 12.5,
                    textAlign: 'center',
                    marginTop: 22,
                    paddingHorizontal: 36,
                  }}
                >
                  {st.loading ? '正在获取播放地址…' : st.error}
                </Text>
              )}

              {/* 页码点：可直接点，不强制用户先学会滑动。
                  圆点本身只有 6dp 高，手指按不准，所以用 padding 把
                  可点区域撑到 34dp 以上。 */}
              <View style={{ flexDirection: 'row', marginTop: 18 }}>
                {[0, 1].map(i => (
                  <Pressable
                    key={i}
                    onPress={() => goTo(i)}
                    accessibilityLabel={i === 0 ? '封面' : '歌词'}
                    style={{ paddingVertical: 14, paddingHorizontal: 7 }}
                  >
                    <View
                      style={{
                        width: page === i ? 18 : 6,
                        height: 6,
                        borderRadius: 3,
                        backgroundColor: page === i ? colors.fg : 'rgba(255,255,255,0.25)',
                      }}
                    />
                  </Pressable>
                ))}
              </View>
            </View>

            {/* ---- 第 2 页：歌词 ---- */}
            <View style={{ width: SCREEN_W, height: '100%', overflow: 'hidden' }}>
              {lines.length ? (
                <FlatList
                  ref={listRef}
                  data={lines}
                  keyExtractor={(_, i) => String(i)}
                  showsVerticalScrollIndicator={false}
                  // 视口高度：居中偏移要减掉它的一半
                  onLayout={e => { listHRef.current = e.nativeEvent.layout.height }}
                  onScrollBeginDrag={() => { lyricDraggingRef.current = true }}
                  onScrollEndDrag={() => { lyricDraggingRef.current = false }}
                  contentContainerStyle={{ paddingHorizontal: 34, paddingVertical: PAD_TOP }}
                  renderItem={({ item: line, index }) => {
                    const active = index === activeIndex
                    const distance = Math.abs(index - activeIndex)
                    return (
                      <Pressable
                        onPress={safe('歌词跳转', () => seek(line.time))}
                        // 只记高度（y 不可靠，见上面注释）。选中行字号变大后高度会变，
                        // 这里补一次无动画校正 —— 滚动不改变行高，不会循环触发。
                        onLayout={e => {
                          const h = e.nativeEvent.layout.height
                          const prev = rowHRef.current[index]
                          if (prev !== undefined && Math.abs(prev - h) < 0.5) return
                          rowHRef.current[index] = h
                          if (index === activeIndexRef.current) scrollToActive(false)
                        }}
                      >
                        <Text
                          numberOfLines={2}
                          style={{
                            color: active ? colors.fg : colors.muted,
                            fontSize: active ? 21 : 16,
                            fontWeight: active ? '700' : '400',
                            textAlign: 'center',
                            marginVertical: 8,
                            opacity: distance === 0 ? 1 : distance <= 2 ? 0.62 : 0.3,
                          }}
                        >
                          {line.text || '·'}
                        </Text>
                        {!!line.translation && (
                          <Text
                            numberOfLines={2}
                            style={{
                              color: colors.muted,
                              fontSize: active ? 14 : 13,
                              textAlign: 'center',
                              marginBottom: 6,
                              marginTop: -4,
                              opacity: distance <= 2 ? 0.85 : 0.35,
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
          </ScrollView>

        {/* 进度条 */}
        <ProgressBar position={position} duration={duration} onSeek={t => void seek(t)} />

        {/* 主控制条 */}
        <View
          style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            paddingHorizontal: 34, marginTop: 6, marginBottom: 4,
          }}
        >
          <Pressable hitSlop={12} onPress={safe('切换播放模式', () => cycleMode())} accessibilityLabel={modeLabel()}>
            {st.mode === 'shuffle'
              ? <ShuffleIcon size={21} color={colors.muted} />
              : <LoopIcon size={21} single={st.mode === 'single'} color={colors.muted} />}
          </Pressable>
          <Pressable hitSlop={14} onPress={safe('上一首', () => prev())} disabled={!st.queue.length}>
            <SkipIcon size={28} direction="prev" color={colors.fg} />
          </Pressable>
          <Pressable
            onPress={safe('播放/暂停', () => toggle())}
            disabled={st.loading || !item}
            style={{
              width: 66, height: 66, borderRadius: 33,
              backgroundColor: colors.fg,
              alignItems: 'center', justifyContent: 'center',
              opacity: st.loading || !item ? 0.5 : 1,
            }}
          >
            {playing
              ? <PauseIcon size={24} color={colors.bg} />
              : <PlayIcon size={26} color={colors.bg} />}
          </Pressable>
          <Pressable hitSlop={14} onPress={safe('下一首', () => next())} disabled={!st.queue.length}>
            <SkipIcon size={28} direction="next" color={colors.fg} />
          </Pressable>
          <Pressable hitSlop={12} onPress={safe('打开播放列表', () => setQueueOpen(true))} accessibilityLabel="播放列表">
            <ListIcon size={21} color={colors.muted} />
          </Pressable>
        </View>

        {/* 次要操作：收藏 / 评论 / 分享 */}
        <View
          style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
            paddingHorizontal: 60, paddingTop: 6, paddingBottom: 14,
          }}
        >
          <Pressable hitSlop={10} onPress={safe('收藏', onToggleFav)} accessibilityLabel={fav ? '取消收藏' : '收藏'}>
            <HeartIcon size={22} filled={fav} color={fav ? colors.accent : colors.muted} />
          </Pressable>
          <Pressable hitSlop={10} onPress={safe('查看评论', () => setCommentOpen(true))} accessibilityLabel="评论">
            <CommentIcon size={22} color={colors.muted} />
          </Pressable>
          <Pressable hitSlop={10} onPress={safe('分享', onShare)} accessibilityLabel="分享">
            <ShareIcon size={22} color={colors.muted} />
          </Pressable>
        </View>

        {/* 播放列表弹层 */}
        <Modal visible={queueOpen} animationType="slide" transparent onRequestClose={() => setQueueOpen(false)}>
          <Pressable style={{ flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' }} onPress={() => setQueueOpen(false)}>
            <Pressable
              style={{ backgroundColor: colors.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, maxHeight: '70%', paddingBottom: 24 }}
              onPress={() => undefined}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16 }}>
                <Text style={{ color: colors.fg, fontSize: 15.5, fontWeight: '600' }}>播放列表（{st.queue.length}）</Text>
                <Pressable onPress={() => setQueueOpen(false)} hitSlop={10}>
                  <Text style={{ color: colors.muted, fontSize: 14 }}>关闭</Text>
                </Pressable>
              </View>
              <ScrollView>
                {st.queue.map((q, i) => (
                  <Pressable
                    key={q.source + '-' + String(q.songmid) + '-' + i}
                    onPress={safe('队列选歌', () => { setQueueOpen(false); return play(q) })}
                    style={{ paddingHorizontal: 20, paddingVertical: 11 }}
                  >
                    <Text numberOfLines={1} style={{ color: i === st.index ? colors.accent : colors.fg, fontSize: 14.5 }}>
                      {q.name}
                    </Text>
                    <Text numberOfLines={1} style={{ color: colors.fainter, fontSize: 12, marginTop: 2 }}>{q.singer}</Text>
                  </Pressable>
                ))}
                {!st.queue.length ? <Text style={{ color: colors.fainter, padding: 20, fontSize: 13 }}>队列为空</Text> : null}
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>

        {/* 评论弹层 */}
        <Modal visible={commentOpen} animationType="slide" transparent onRequestClose={() => setCommentOpen(false)}>
          <Pressable style={{ flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' }} onPress={() => setCommentOpen(false)}>
            <Pressable
              style={{ backgroundColor: colors.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, height: '76%', paddingBottom: 20 }}
              onPress={() => undefined}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16, gap: 8 }}>
                <Text style={{ color: colors.fg, fontSize: 15.5, fontWeight: '600' }}>评论</Text>
                {commentTotal > 0 ? <Text style={{ color: colors.fainter, fontSize: 12 }}>{commentTotal}</Text> : null}
                {!canComment ? <Text style={{ color: colors.fainter, fontSize: 12 }}>当前音源不提供评论</Text> : null}
                <View style={{ flex: 1 }} />
                <Pressable onPress={() => setCommentOpen(false)} hitSlop={10}>
                  <Text style={{ color: colors.muted, fontSize: 14 }}>关闭</Text>
                </Pressable>
              </View>
              {commentLoading && !comments.length ? (
                <View style={{ paddingTop: 30, alignItems: 'center' }}><ActivityIndicator color={colors.accent} /></View>
              ) : commentError ? (
                <Text style={{ color: colors.accent, paddingHorizontal: 20, fontSize: 13 }}>{commentError}</Text>
              ) : !comments.length ? (
                <Text style={{ color: colors.fainter, paddingHorizontal: 20, fontSize: 13 }}>
                  {canComment ? '还没有评论' : '换一个音源试试'}
                </Text>
              ) : (
                <FlatList
                  data={comments}
                  keyExtractor={(x, i) => x.id + '-' + i}
                  contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12 }}
                  renderItem={({ item: cm }) => (
                    <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
                      {cm.avatar ? (
                        <Image source={{ uri: cm.avatar }} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: colors.elevated }} />
                      ) : (
                        <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: colors.elevated }} />
                      )}
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 12, flexShrink: 1 }}>{cm.userName || '匿名用户'}</Text>
                          {cm.hot ? (
                            <Text style={{ color: colors.accent, fontSize: 10, borderWidth: 1, borderColor: colors.accent, borderRadius: 3, paddingHorizontal: 3 }}>热评</Text>
                          ) : null}
                        </View>
                        <Text style={{ color: colors.fg, fontSize: 14, lineHeight: 21, marginTop: 4 }}>{cm.content}</Text>
                        <Text style={{ color: colors.fainter, fontSize: 11, marginTop: 5 }}>赞 {cm.likedCount}</Text>
                      </View>
                    </View>
                  )}
                  ListFooterComponent={
                    commentMore ? (
                      <Pressable
                        onPress={() => void loadComments(false)}
                        disabled={commentLoading}
                        style={{ borderWidth: 1, borderColor: colors.divider, borderRadius: 10, paddingVertical: 9, alignItems: 'center', marginBottom: 12 }}
                      >
                        <Text style={{ color: colors.muted, fontSize: 13 }}>{commentLoading ? '加载中…' : '查看更多评论'}</Text>
                      </Pressable>
                    ) : null
                  }
                />
              )}
            </Pressable>
          </Pressable>
        </Modal>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  )
}
