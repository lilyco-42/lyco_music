/**
 * 可移植平台工厂
 *
 * 用纯 JS 的 crypto 组装出一个 PlatformAdapter。
 * 只要宿主提供 http / timer / storage，就能在任意 JS 运行时跑起来：
 *   - Node / Electron：直接用（见 @lxmn/platform-desktop）
 *   - React Native：fetch + AsyncStorage
 *   - 浏览器：fetch + localStorage
 *
 * 压缩（compress）不在这里实现：Hermes 没有 Blob.stream / DecompressionStream，
 * 浏览器与 Node 的可用性也不一致。需要压缩的宿主自行注入 compress。
 */
import type { PlatformAdapter, HttpAdapter, TimerAdapter, StorageAdapter, CompressAdapter } from './platform'
import { portableCrypto } from './crypto/portable'
import { utf8Encode, utf8Decode, toBase64, fromBase64 } from './util/bytes'

export interface PortablePlatformOptions {
  name: PlatformAdapter['name']
  http: HttpAdapter
  timer?: TimerAdapter
  storage?: StorageAdapter
  /**
   * 压缩实现。默认抛错——目前所有音源都不需要压缩，
   * 真要用时由宿主注入（Node 用 node:zlib，浏览器用 DecompressionStream）。
   */
  compress?: CompressAdapter
  /** 名称解码：默认按 UTF-8 解；中文站源可注入 iconv-lite 实现 */
  decodeName?: (s: string | Uint8Array) => string
  version?: string
}

const unavailableCompress: CompressAdapter = {
  async inflate() {
    throw new Error('[lxmn] compress.inflate 未注入：请通过 createPortablePlatform({ compress }) 提供')
  },
  async inflateToString() {
    throw new Error('[lxmn] compress.inflateToString 未注入：请通过 createPortablePlatform({ compress }) 提供')
  },
  async deflate() {
    throw new Error('[lxmn] compress.deflate 未注入：请通过 createPortablePlatform({ compress }) 提供')
  },
}

const defaultTimer: TimerAdapter = {
  setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number,
  clearTimeout: id => clearTimeout(id),
  setInterval: (fn, ms) => setInterval(fn, ms) as unknown as number,
  clearInterval: id => clearInterval(id),
}

const memory = new Map<string, string>()
const defaultStorage: StorageAdapter = {
  async get(k) { return memory.get(k) ?? null },
  async set(k, v) { memory.set(k, v) },
  async remove(k) { memory.delete(k) },
  async keys() { return [...memory.keys()] },
}

export function createPortablePlatform(options: PortablePlatformOptions): PlatformAdapter {
  return {
    name: options.name,
    crypto: portableCrypto,
    compress: options.compress ?? unavailableCompress,
    http: options.http,
    timer: options.timer ?? defaultTimer,
    storage: options.storage ?? defaultStorage,
    codec: {
      utf8Encode,
      utf8Decode,
      base64Encode: (b) => toBase64(typeof b === 'string' ? utf8Encode(b) : b),
      base64Decode: (s) => fromBase64(s),
      decodeName: options.decodeName ?? ((s) => (typeof s === 'string' ? s : utf8Decode(s))),
    },
    version: options.version ?? '0.2.53',
  }
}
