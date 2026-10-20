/**
 * 封面取色。
 *
 * 目的：播放页背景不再是一块死黑，而是像网易云那样「从封面里渗出来的颜色」。
 *
 * 做法：只解 JPEG 的 DC 系数。JPEG 的每个 8×8 块做完 DCT 后，左上角那个
 * 系数（DC）正好等于该块的平均色 —— 所以只解 DC、不做 IDCT，就能拿到一张
 * 缩略图的全部信息，代码量小、在 Hermes 上也够快（500×500 约 10ms 量级）。
 *
 * 渐进式 JPEG（SOF2）的第一遍扫描本身就只含 DC，比基线还省事，一并支持。
 * 算术编码（SOF10 等）极罕见，直接放弃 —— 调用方回退到中性背景。
 *
 * 这里没有任何原生依赖：图片用 fetch 取成 ArrayBuffer 就地解析。
 */

export interface Rgb { r: number; g: number; b: number }

/* ---------------- JPEG DC 解码 ---------------- */

function buildHuff(bits: number[], vals: number[]): Map<string, number> {
  const table = new Map<string, number>()
  let code = 0
  let k = 0
  for (let len = 1; len <= 16; len++) {
    for (let i = 0; i < bits[len - 1]!; i++) {
      table.set(len + ':' + code, vals[k++]!)
      code++
    }
    code <<= 1
  }
  return table
}

function decodeHuff(reader: BitReader, table: Map<string, number>): number {
  let code = 0
  for (let len = 1; len <= 16; len++) {
    code = (code << 1) | reader.bit()
    const sym = table.get(len + ':' + code)
    if (sym !== undefined) return sym
  }
  throw new Error('bad huffman code')
}

/** JPEG 的「符号位 + 幅值」编码：n 位的值要按最高位判断正负 */
function extend(v: number, n: number): number {
  return v < 1 << (n - 1) ? v - (1 << n) + 1 : v
}

function clamp(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)))
}

interface BitReader {
  bit(): number
  bits(n: number): number
  align(): void
}

interface Component {
  id: number
  hs: number
  vs: number
  tq: number
  pred: number
  sum: number
  count: number
}

/** 从 from 起找下一个 marker 的位置（跳过 FF00 填充与 RSTn） */
function findNextMarker(u8: Uint8Array, from: number): number {
  for (let i = from; i < u8.length - 1; i++) {
    if (u8[i] === 0xff) {
      const b = u8[i + 1]!
      if (b === 0x00) { i++; continue }
      if (b >= 0xd0 && b <= 0xd7) { i++; continue }
      return i
    }
  }
  return u8.length
}

export function decodeJpegDc(buf: ArrayBuffer | Uint8Array): Rgb {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  if (u8[0] !== 0xff || u8[1] !== 0xd8) throw new Error('not jpeg')

  let p = 2
  const qt: (Uint16Array | undefined)[] = []
  const huffDC: (Map<string, number> | undefined)[] = []
  const huffAC: (Map<string, number> | undefined)[] = []
  let frame: { w: number; h: number; comps: Component[]; progressive: boolean } | null = null
  let restartInterval = 0
  let adobeTransform = -1

  const u16 = (i: number) => (u8[i]! << 8) | u8[i + 1]!

  while (p < u8.length - 1) {
    if (u8[p] !== 0xff) { p++; continue }
    const marker = u8[p + 1]!
    p += 2
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (marker === 0xd9) break
    const segEnd = p + u16(p)

    if (marker === 0xdb) {
      let q = p + 2
      while (q < segEnd) {
        const pq = u8[q]! >> 4
        const tq = u8[q]! & 15
        q++
        const tbl = new Uint16Array(64)
        for (let i = 0; i < 64; i++) {
          if (pq) { tbl[i] = u16(q); q += 2 } else { tbl[i] = u8[q]!; q++ }
        }
        qt[tq] = tbl
      }
    } else if (marker === 0xc4) {
      let q = p + 2
      while (q < segEnd) {
        const tc = u8[q]! >> 4
        const th = u8[q]! & 15
        q++
        const bits: number[] = []
        let total = 0
        for (let i = 0; i < 16; i++) { bits.push(u8[q + i]!); total += u8[q + i]! }
        q += 16
        const vals: number[] = []
        for (let i = 0; i < total; i++) vals.push(u8[q + i]!)
        q += total
        const t = buildHuff(bits, vals)
        if (tc === 0) huffDC[th] = t
        else huffAC[th] = t
      }
    } else if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      const h = u16(p + 3)
      const w = u16(p + 5)
      const nc = u8[p + 7]!
      const comps: Component[] = []
      let q = p + 8
      for (let i = 0; i < nc; i++) {
        comps.push({
          id: u8[q]!, hs: u8[q + 1]! >> 4, vs: u8[q + 1]! & 15, tq: u8[q + 2]!,
          pred: 0, sum: 0, count: 0,
        })
        q += 3
      }
      frame = { w, h, comps, progressive: marker === 0xc2 }
    } else if (marker === 0xc6 || marker === 0xca || marker === 0xce) {
      throw new Error('unsupported jpeg type ' + marker.toString(16))
    } else if (marker === 0xdd) {
      restartInterval = u16(p + 2)
    } else if (marker === 0xee) {
      if (u8[p + 2] === 0x41 && u8[p + 3] === 0x64 && u8[p + 4] === 0x6f) adobeTransform = u8[p + 13]!
    } else if (marker === 0xda) {
      if (!frame) throw new Error('scan before frame header')
      const ns = u8[p + 2]!
      const scan: { id: number; td: number; ta: number }[] = []
      let q = p + 3
      for (let i = 0; i < ns; i++) {
        scan.push({ id: u8[q]!, td: u8[q + 1]! >> 4, ta: u8[q + 1]! & 15 })
        q += 2
      }
      const ss = u8[q]!
      const se = u8[q + 1]!
      const ah = u8[q + 2]! >> 4
      const al = u8[q + 2]! & 15
      const dataStart = q + 3

      const isBaseline = !frame.progressive
      if (!isBaseline && !(ss === 0 && se === 0 && ah === 0)) {
        p = findNextMarker(u8, dataStart)
        continue
      }

      let pos = dataStart
      let bitBuf = 0
      let bitCnt = 0
      let hitMarker = false
      const reader: BitReader = {
        bit() {
          if (bitCnt === 0) {
            if (pos >= u8.length) throw new Error('eof')
            const b = u8[pos++]!
            if (b === 0xff) {
              const nb = u8[pos]!
              if (nb === 0x00) pos++
              else { hitMarker = true; return 0 }
            }
            bitBuf = b
            bitCnt = 8
          }
          bitCnt--
          return (bitBuf >> bitCnt) & 1
        },
        bits(n: number) {
          let v = 0
          for (let i = 0; i < n; i++) v = (v << 1) | this.bit()
          return v
        },
        align() { bitCnt = 0 },
      }

      const { w, h, comps } = frame
      const maxH = Math.max(...comps.map(c => c.hs))
      const maxV = Math.max(...comps.map(c => c.vs))
      const mcusX = Math.ceil(w / (8 * maxH))
      const mcusY = Math.ceil(h / (8 * maxV))
      const byId = new Map(comps.map(c => [c.id, c]))
      const dcShift = 1 << al
      let mcuCount = 0

      outer:
      for (let my = 0; my < mcusY; my++) {
        for (let mx = 0; mx < mcusX; mx++) {
          if (restartInterval && mcuCount > 0 && mcuCount % restartInterval === 0) {
            reader.align()
            while (pos + 1 < u8.length && !(u8[pos] === 0xff && u8[pos + 1]! >= 0xd0 && u8[pos + 1]! <= 0xd7)) pos++
            pos += 2
            for (const c of comps) c.pred = 0
          }
          mcuCount++
          for (const s of scan) {
            const c = byId.get(s.id)
            if (!c) continue
            const dcT = huffDC[s.td]
            if (!dcT) throw new Error('missing dc table')
            const acT = isBaseline ? huffAC[s.ta] : undefined
            for (let by = 0; by < c.vs; by++) {
              for (let bx = 0; bx < c.hs; bx++) {
                const t = decodeHuff(reader, dcT)
                let diff = 0
                if (t) diff = extend(reader.bits(t), t)
                c.pred += diff
                const q0 = qt[c.tq] ? qt[c.tq]![0]! : 1
                // 反量化后的 DC 除以 8 再加 128 = 该块平均像素
                c.sum += ((c.pred * dcShift) * q0) / 8 + 128
                c.count++
                if (acT) {
                  // AC 只为跳过比特，系数本身不要
                  for (let k = 1; k < 64;) {
                    const rs = decodeHuff(reader, acT)
                    const r = rs >> 4
                    const sz = rs & 15
                    if (sz === 0) {
                      if (r === 15) { k += 16; continue }
                      break
                    }
                    k += r + 1
                    reader.bits(sz)
                  }
                }
              }
            }
          }
          if (hitMarker) break outer
        }
      }

      const avg = comps.map(c => (c.count ? c.sum / c.count : 128))
      if (adobeTransform === 0 && comps.length >= 3) {
        return { r: clamp(avg[0]!), g: clamp(avg[1]!), b: clamp(avg[2]!) }
      }
      const Y = avg[0]!
      const Cb = comps.length > 1 ? avg[1]! : 128
      const Cr = comps.length > 2 ? avg[2]! : 128
      return {
        r: clamp(Y + 1.402 * (Cr - 128)),
        g: clamp(Y - 0.344136 * (Cb - 128) - 0.714136 * (Cr - 128)),
        b: clamp(Y + 1.772 * (Cb - 128)),
      }
    }
    p = segEnd
  }
  throw new Error('no dc scan')
}

/* ---------------- 对外：取色 + 背景配色 ---------------- */

/** url -> 颜色，避免同一首歌反复解码 */
const cache = new Map<string, Rgb | null>()

/**
 * 取封面主色。任何失败都返回 null（不是抛错）——
 * 背景色属于装饰，取不到就不该影响播放。
 */
export async function coverColor(url: string | undefined | null): Promise<Rgb | null> {
  if (!url || !/^https?:\/\//i.test(url)) return null
  if (cache.has(url)) return cache.get(url)!

  try {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
    // 封面只用来取色，不需要原图那么大；CDN 基本都支持缩小参数，
    // 但不同源参数不一样，所以这里只做超时保护，不强行改写 URL。
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 6000) : null
    const res = await fetch(url, ctrl ? { signal: ctrl.signal } : undefined)
    if (timer) clearTimeout(timer)
    if (!res.ok) throw new Error('http ' + res.status)
    const ab = await res.arrayBuffer()
    const rgb = decodeJpegDc(ab)
    cache.set(url, rgb)
    return rgb
  } catch {
    cache.set(url, null)
    return null
  }
}

/* ---------------- 颜色运算 ---------------- */

export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  const k = Math.max(0, Math.min(1, t))
  return {
    r: Math.round(a.r + (b.r - a.r) * k),
    g: Math.round(a.g + (b.g - a.g) * k),
    b: Math.round(a.b + (b.b - a.b) * k),
  }
}

export function rgbCss(c: Rgb, alpha = 1): string {
  return alpha >= 1 ? `rgb(${c.r},${c.g},${c.b})` : `rgba(${c.r},${c.g},${c.b},${alpha})`
}

/** 相对亮度，用来判断该压暗还是提亮才能保证白字可读 */
export function luma(c: Rgb): number {
  return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255
}

/**
 * 提高饱和度。
 *
 * 封面取到的是「整张图的平均色」，一旦画面里颜色杂，平均下来就会发灰 ——
 * 网易云那种鲜艳的蓝/紫背景不是平均色，而是提过饱和的。
 * 做法是把每个通道相对灰轴往外推：灰色不动（推了也没用），有色相的颜色更浓。
 */
export function saturate(c: Rgb, k = 1): Rgb {
  const grey = (c.r + c.g + c.b) / 3
  return {
    r: clamp(c.r + (c.r - grey) * k),
    g: clamp(c.g + (c.g - grey) * k),
    b: clamp(c.b + (c.b - grey) * k),
  }
}

/**
 * 由封面主色生成播放页的背景色阶（从上到下）。
 *
 * 三步：提饱和 → 压到目标亮度 → 往黑色过渡。
 * 压暗是必须的：封面平均色往往偏亮，直接铺满会让白字糊掉；
 * 但压得太狠就变成一块死灰，所以目标亮度给到 0.34 上下。
 */
export function moodStops(base: Rgb, steps = 40): string[] {
  const vivid = saturate(base, 1.15)
  const bright = luma(vivid)
  const target = bright > 0.6 ? 0.34 : bright > 0.35 ? 0.38 : 0.42
  const k = target / Math.max(bright, 0.05)
  const top: Rgb = {
    r: Math.min(255, Math.round(vivid.r * k)),
    g: Math.min(255, Math.round(vivid.g * k)),
    b: Math.min(255, Math.round(vivid.b * k)),
  }
  const bottom: Rgb = { r: 16, g: 16, b: 16 }
  const out: string[] = []
  for (let i = 0; i < steps; i++) {
    // 平方缓动：上半段颜色停留久一点，下半段更快落到黑，接近网易云那种「顶部有色、底部沉」的观感
    const t = Math.pow(i / (steps - 1), 1.7)
    out.push(rgbCss(mix(top, bottom, t)))
  }
  return out
}
