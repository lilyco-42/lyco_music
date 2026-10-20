/**
 * 迷你播放条 —— 常驻在底部标签栏上方。
 *
 * 参照网易云：圆角胶囊 + 圆形封面 + 一行「歌名 - 歌手」+ 播放/暂停 + 播放列表。
 * 点胶囊主体展开全屏播放页，点右侧按钮则原地操作、不跳页。
 *
 * 之前没有这个条：用户在任何页面都看不到「现在在放什么」，
 * 必须切到「播放器」标签才知道。加上它之后播放器才可以不占标签位。
 */
import { useCallback, useRef } from 'react'
import { Animated, Easing, Image, Pressable, Text, View } from 'react-native'

import { PauseIcon, PlayIcon, ListIcon } from './Icons'
import { colors } from '../theme'
import { currentItem, toggle, usePlayerState } from '../player'
import { safe } from '../lib/safe'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const DEFAULT_COVER = require('../assets/art/cover-default.jpg') as number

interface Props {
  onOpen: () => void
  onOpenQueue: () => void
}

/**
 * 封面旋转。
 *
 * 网易云的迷你条封面是不转的，转的是播放页的黑胶。这里也只在播放页转，
 * 迷你条保持静止 —— 底部常驻元素一直在动会干扰阅读。
 */
export default function MiniPlayer({ onOpen, onOpenQueue }: Props) {
  const st = usePlayerState()
  const item = currentItem()

  // 播放页展开/收起用透明度做一点点过场，避免生硬闪切
  const press = useRef(new Animated.Value(1)).current
  const bounce = useCallback(() => {
    Animated.sequence([
      Animated.timing(press, { toValue: 0.94, duration: 90, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(press, { toValue: 1, duration: 120, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start()
  }, [press])

  // 没有在播的歌就不占位，首页顶部直接贴着标签栏
  if (!item) return null

  const cover = typeof st.picUrl === 'string' && st.picUrl ? { uri: st.picUrl } : DEFAULT_COVER

  return (
    <Animated.View style={{ transform: [{ scale: press }], paddingHorizontal: 10, paddingBottom: 6 }}>
      <Pressable
        onPress={() => { bounce(); onOpen() }}
        onPressIn={bounce}
        style={{
          height: 54,
          borderRadius: 27,
          backgroundColor: colors.elevated,
          flexDirection: 'row',
          alignItems: 'center',
          paddingLeft: 7,
          paddingRight: 6,
          // 一点点投影把胶囊从背景里托起来（Android 用 elevation，iOS 用 shadow）
          elevation: 6,
          shadowColor: '#000',
          shadowOpacity: 0.35,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 4 },
        }}
      >
        <Image
          source={cover}
          style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface }}
        />

        <View style={{ flex: 1, minWidth: 0, marginLeft: 10 }}>
          <Text numberOfLines={1} style={{ color: colors.fg, fontSize: 13.5, fontWeight: '500' }}>
            {item.name}
          </Text>
          <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>
            {item.singer}
          </Text>
        </View>

        {/* 加载中就在暂停/播放之间显示一个小圈，避免用户以为按钮坏了 */}
        <Pressable
          hitSlop={8}
          onPress={safe('迷你条播放暂停', () => toggle())}
          style={{ width: 38, height: 38, alignItems: 'center', justifyContent: 'center' }}
        >
          {st.loading ? (
            <View
              style={{
                width: 16, height: 16, borderRadius: 8,
                borderWidth: 2, borderColor: colors.muted, borderTopColor: 'transparent',
              }}
            />
          ) : st.playing ? (
            <PauseIcon size={15} color={colors.fg} />
          ) : (
            <PlayIcon size={17} color={colors.fg} />
          )}
        </Pressable>

        <Pressable
          hitSlop={8}
          onPress={safe('迷你条播放列表', () => onOpenQueue())}
          style={{ width: 38, height: 38, alignItems: 'center', justifyContent: 'center' }}
        >
          <ListIcon size={18} color={colors.fg} />
        </Pressable>
      </Pressable>
    </Animated.View>
  )
}
