/**
 * 纯几何图标（无第三方图标库、无品牌资产）。
 * 全部用 View 拼出，避免引入 react-native-svg 增加原生依赖。
 */
import { View } from 'react-native'

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
export function LoopIcon({ size = 18, color = '#9a9a9a' }: IconProps) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 2,
        borderColor: color,
        borderTopColor: 'transparent',
        transform: [{ rotate: '-45deg' }],
      }}
    />
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
 * 爱心：filled=false 画空心（描边），true 画实心。
 * 之前只有一个实心方块，无法表达「已收藏 / 未收藏」两种状态。
 */
export function HeartIcon({ size = 20, color = '#9a9a9a', filled = true }: IconProps & { filled?: boolean }) {
  const shape = size * 0.62
  const inner = shape - 4
  return (
    <View style={{ width: size, height: size, justifyContent: 'center', alignItems: 'center' }}>
      <View
        style={{
          width: shape,
          height: shape,
          borderRadius: size * 0.16,
          borderWidth: filled ? 0 : 2,
          borderColor: color,
          backgroundColor: filled ? color : 'transparent',
          transform: [{ rotate: '45deg' }],
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        {!filled && inner > 0 ? <View style={{ width: inner, height: inner, backgroundColor: 'transparent' }} /> : null}
      </View>
    </View>
  )
}

export function CommentIcon({ size = 20, color = '#9a9a9a' }: IconProps) {
  return (
    <View style={{ width: size, height: size * 0.8, borderRadius: size * 0.2, borderWidth: 2, borderColor: color }} />
  )
}

export function ShareIcon({ size = 20, color = '#9a9a9a' }: IconProps) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: size * 0.7, height: size * 0.5, borderWidth: 2, borderColor: color, borderRadius: 3, marginTop: size * 0.35 }} />
      <View style={{ position: 'absolute', top: 0, width: 2, height: size * 0.5, backgroundColor: color }} />
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
