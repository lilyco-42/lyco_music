/**
 * 氛围背景 —— 用封面主色铺一层从「有色」到「近黑」的竖向渐变。
 *
 * RN 没有 CSS 渐变，装 react-native-linear-gradient 又要加原生依赖、
 * 重编整包。这里用 N 条等高色带堆出来：色带足够多（40 条）时，
 * 深色区间的相邻色差小于 1 个色阶，肉眼看不到接缝。
 */
import { useEffect, useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { coverColor, moodStops, type Rgb } from '../lib/palette'

/** 订阅封面主色；换歌时先清空，避免上一首的颜色残留半秒 */
export function useCoverColor(url: string | undefined | null): Rgb | null {
  const [color, setColor] = useState<Rgb | null>(null)
  useEffect(() => {
    let alive = true
    setColor(null)
    void coverColor(url).then(c => { if (alive) setColor(c) })
    return () => { alive = false }
  }, [url])
  return color
}

export default function Ambient({ color }: { color: Rgb | null }) {
  const stops = useMemo(() => (color ? moodStops(color) : null), [color])
  if (!stops) return null
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {stops.map((c, i) => (
        <View key={i} style={{ flex: 1, backgroundColor: c }} />
      ))}
    </View>
  )
}
