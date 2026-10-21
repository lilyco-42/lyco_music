/**
 * 纯几何图标（无第三方图标库、无品牌资产）。
 * 全部用 View 拼出，避免引入 react-native-svg 增加原生依赖。
 */
import { Text, View } from 'react-native'

interface IconProps {
  size?: number
  color?: string
}

export function PlayIcon({ size = 22, color = '#fff' }: IconProps) {
  return (
    <View
      style={{
        width: 0,
        height: 0,
        borderStyle: 'solid',
        borderLeftWidth: size * 0.8,
        borderTopWidth: size * 0.55,
        borderBottomWidth: size * 0.55,
        borderLeftColor: color,
        borderTopColor: 'transparent',
        borderBottomColor: 'transparent',
        marginLeft: size * 0.15,
      }}
    />
  )
}

export function PauseIcon({ size = 22, color = '#fff' }: IconProps) {
  const w = size * 0.26
  return (
    <View style={{ flexDirection: 'row', gap: w * 0.8 }}>
      <View style={{ width: w, height: size, backgroundColor: color, borderRadius: 2 }} />
      <View style={{ width: w, height: size, backgroundColor: color, borderRadius: 2 }} />
    </View>
  )
}

/** 上一首 / 下一首：三角形 + 竖线 */
export function SkipIcon({ size = 20, color = '#e0e0e0', direction = 'next' }: IconProps & { direction?: 'prev' | 'next' }) {
  const tri = (
    <View
      style={{
        width: 0,
        height: 0,
        borderStyle: 'solid',
        borderTopWidth: size * 0.5,
        borderBottomWidth: size * 0.5,
        borderTopColor: 'transparent',
        borderBottomColor: 'transparent',
        ...(direction === 'next'
          ? { borderLeftWidth: size * 0.7, borderLeftColor: color }
          : { borderRightWidth: size * 0.7, borderRightColor: color }),
      }}
    />
  )
  const bar = <View style={{ width: size * 0.16, height: size, backgroundColor: color, borderRadius: 2 }} />
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {direction === 'next' ? (
        <>
          {tri}
          {bar}
        </>
      ) : (
        <>
          {bar}
          {tri}
        </>
      )}
    </View>
  )
}

/** 循环 / 随机：用圆形与交叉线示意 */
/**
 * 循环图标：single=true 时在环内叠一个实心点，表示「单曲循环」。
 * 之前只有一种形状，无法表达四种播放模式。
 */
export function LoopIcon({ size = 18, color = '#9a9a9a', single = false }: IconProps & { single?: boolean }) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 2,
          borderColor: color,
          borderTopColor: 'transparent',
          transform: [{ rotate: '-45deg' }],
        }}
      />
      {single ? (
        <View style={{ width: size * 0.26, height: size * 0.26, borderRadius: size * 0.13, backgroundColor: color }} />
      ) : null}
    </View>
  )
}

export function ShuffleIcon({ size = 18, color = '#9a9a9a' }: IconProps) {
  return (
    <View style={{ width: size, height: size, justifyContent: 'center' }}>
      <View style={{ height: 2, backgroundColor: color, transform: [{ rotate: '35deg' }] }} />
      <View style={{ height: 2, backgroundColor: color, transform: [{ rotate: '-35deg' }], marginTop: 2 }} />
    </View>
  )
}

/**
 * 爱心：用字体里的 ♥ / ♡ 字形。
 *
 * 之前是用一个圆角方块转 45° 拼的，看上去就是个菱形，完全不像心。
 * 而「两个圆 + 一个方块」的经典画法在描边（空心）状态下很难对齐。
 * U+2665/U+2661 是纯文本字形（不是 emoji），能用 color 上色、随字号缩放，
 * 在 Android 默认字体里都有。
 */
export function HeartIcon({ size = 20, color = '#9a9a9a', filled = true }: IconProps & { filled?: boolean }) {
  return (
    <Text
      style={{
        color,
        fontSize: size,
        lineHeight: size * 1.1,
        // 字形本身在行框里偏下，往上提一点才和旁边的图标对齐
        marginTop: -size * 0.08,
        includeFontPadding: false,
        textAlignVertical: 'center',
      }}
    >
      {filled ? '\u2665' : '\u2661'}
    </Text>
  )
}

/**
 * 不喜欢：一个被斜线划掉的圆。
 *
 * 不用拇指朝下的字形：Android 默认字体里没有 U+1F44D 的描边变体，
 * 落到 emoji 后是彩色且无法跟随主题色。圆 + 斜线两个 View 就能画，
 * 在任何字号下都清晰，也和这套图标的线条粗细一致。
 */
export function BlockIcon({ size = 20, color = '#9a9a9a', active = false }: IconProps & { active?: boolean }) {
  return (
    <View
      style={{
        width: size, height: size, borderRadius: size / 2,
        borderWidth: 1.8, borderColor: color,
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: active ? color : 'transparent',
      }}
    >
      <View
        style={{
          position: 'absolute',
          width: size * 0.72,
          height: 1.8,
          borderRadius: 1,
          backgroundColor: active ? '#101010' : color,
          transform: [{ rotate: '-45deg' }],
        }}
      />
    </View>
  )
}

/** 评论气泡：圆角矩形 + 左下角一个小三角尾巴 */
export function CommentIcon({ size = 20, color = '#9a9a9a' }: IconProps) {
  const w = size
  const h = size * 0.76
  return (
    <View style={{ width: w, height: size, justifyContent: 'flex-start' }}>
      <View style={{ width: w, height: h, borderRadius: size * 0.22, borderWidth: 1.8, borderColor: color }} />
      <View
        style={{
          position: 'absolute',
          top: h - 1,
          left: size * 0.2,
          width: 0,
          height: 0,
          borderStyle: 'solid',
          borderRightWidth: size * 0.26,
          borderTopWidth: size * 0.2,
          borderRightColor: 'transparent',
          borderTopColor: color,
        }}
      />
    </View>
  )
}

/** 分享：三个节点 + 两条连线（Material 的 share 图形） */
export function ShareIcon({ size = 20, color = '#9a9a9a' }: IconProps) {
  const d = size * 0.26
  const line = (
    <View style={{ position: 'absolute', width: size * 0.46, height: 1.8, backgroundColor: color, borderRadius: 1 }} />
  )
  return (
    <View style={{ width: size, height: size, justifyContent: 'center' }}>
      <View style={{ position: 'absolute', top: size * 0.06, right: 0, width: d, height: d, borderRadius: d / 2, backgroundColor: color }} />
      <View style={{ position: 'absolute', top: (size - d) / 2, left: 0, width: d, height: d, borderRadius: d / 2, backgroundColor: color }} />
      <View style={{ position: 'absolute', bottom: size * 0.06, right: 0, width: d, height: d, borderRadius: d / 2, backgroundColor: color }} />
      <View style={{ position: 'absolute', top: size * 0.3, left: size * 0.22, transform: [{ rotate: '-24deg' }] }}>{line}</View>
      <View style={{ position: 'absolute', bottom: size * 0.3, left: size * 0.22, transform: [{ rotate: '24deg' }] }}>{line}</View>
    </View>
  )
}

export function ListIcon({ size = 20, color = '#9a9a9a' }: IconProps) {
  return (
    <View style={{ width: size, height: size, justifyContent: 'space-between', paddingVertical: 2 }}>
      {[0, 1, 2].map(i => (
        <View key={i} style={{ height: 2, backgroundColor: color, borderRadius: 1 }} />
      ))}
    </View>
  )
}

export function ChevronDownIcon({ size = 22, color = '#f0f0f0' }: IconProps) {
  return (
    <View
      style={{
        width: size * 0.62,
        height: size * 0.62,
        borderLeftWidth: 2,
        borderBottomWidth: 2,
        borderColor: color,
        transform: [{ rotate: '-45deg' }],
        marginTop: -size * 0.2,
      }}
    />
  )
}

export function MoreIcon({ size = 22, color = '#f0f0f0' }: IconProps) {
  return (
    <View style={{ flexDirection: 'row', gap: 3 }}>
      {[0, 1, 2].map(i => (
        <View key={i} style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: color }} />
      ))}
    </View>
  )
}

/** 几何 Logo：红色圆 + 三条白色均衡器（非任何既有品牌标识） */
export function Logo({ size = 34 }: { size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: '#E83A45',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: size * 0.08,
      }}
    >
      {[0.42, 0.68, 0.5].map((h, i) => (
        <View
          key={i}
          style={{
            width: size * 0.1,
            height: size * h,
            borderRadius: size * 0.05,
            backgroundColor: '#fff',
          }}
        />
      ))}
    </View>
  )
}
