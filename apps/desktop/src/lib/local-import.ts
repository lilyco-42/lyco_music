/**
 * 本地音乐导入（桌面端）
 *
 * 「网易云一键同步」的落地：不登录、不调接口，直接扫本机的网易云下载目录。
 * 目录是用户自己机器上的既成事实，不需要任何授权，也不存在 cookie 过期。
 *
 * 分工：
 *   - 主进程（electron/local.cjs）只负责「把目录里的文件列出来」和「读 .lrc」
 *   - 内核（@lxmn/core 的 local/）负责文件名解析、分类统计、转成 MusicItem
 *   - 这里负责把两边接起来，并把结果落进曲库
 */
import { computed, ref } from 'vue'
import {
  buildLocalTracks,
  groupLocalFiles,
  summarizeScan,
  type LocalFileEntry,
  type MusicItem,
} from '@lxmn/core'
import { library } from './sync'

interface NativeLocal {
  detect: () => Promise<{ downloads: string[]; clientData: string[] }>
  scan: (dir: string) => Promise<{
    root: string
    entries: (LocalFileEntry & { ext: string })[]
    lrc?: Record<string, string>
    truncated?: boolean
    error?: string
  }>
  pickDir: () => Promise<string>
}

function nativeLocal(): NativeLocal | null {
  const w = window as unknown as { lxmnNative?: { local?: NativeLocal } }
  return w.lxmnNative?.local ?? null
}

/** 一个待导入的分组（一个目录 = 一个歌单） */
export interface ImportGroup {
  /** 组名，来自子目录名 */
  name: string
  dir: string
  /** 可导入的曲目 */
  tracks: MusicItem[]
  /** 加密文件数（.ncm 等），不能导入 */
  encrypted: number
  /** 加密文件按扩展名统计 */
  encryptedByExt: Record<string, number>
  /** 被忽略的其他文件（图片、txt 等） */
  ignored: number
}

const detecting = ref(false)
const scanning = ref(false)
const importing = ref(false)
const error = ref('')
/** 探测到的下载目录 */
const foundDirs = ref<string[]>([])
/** 探测到的客户端数据目录（只用于告知用户「我们找到了，但不解析」） */
const clientDirs = ref<string[]>([])
/** 当前扫描的目录 */
const currentDir = ref('')
/** 扫描结果的各个分组 */
const groups = ref<ImportGroup[]>([])
const truncated = ref(false)
/** 最近一次扫描的顶层统计（音频/加密/忽略各多少） */
const lastSummary = ref(summarizeScan([]))

export function useLocalImport() {
  const totalTracks = computed(() => groups.value.reduce((n, g) => n + g.tracks.length, 0))
  const totalEncrypted = computed(() => groups.value.reduce((n, g) => n + g.encrypted, 0))
  /** 已就地解密的文件数（.ncm -> mp3/flac），用于告诉用户「不是跳过了，是解开了」 */
  const totalDecoded = computed(() => lastSummary.value.decoded)

  /** 探测网易云目录（绿色安装/自定义下载路径都能找到） */
  async function detect(): Promise<string[]> {
    const native = nativeLocal()
    if (!native) {
      error.value = '本地导入只在桌面端可用'
      return []
    }
    detecting.value = true
    error.value = ''
    try {
      const r = await native.detect()
      foundDirs.value = r.downloads
      clientDirs.value = r.clientData
      return r.downloads
    } catch (e) {
      error.value = e instanceof Error ? e.message : '探测目录失败'
      return []
    } finally {
      detecting.value = false
    }
  }

  /** 扫一个目录，按子目录分组 */
  async function scan(dir: string): Promise<ImportGroup[]> {
    const native = nativeLocal()
    if (!native) {
      error.value = '本地导入只在桌面端可用'
      return []
    }
    scanning.value = true
    error.value = ''
    groups.value = []
    truncated.value = false
    try {
      const r = await native.scan(dir)
      if (r.error) {
        error.value = r.error
        return []
      }
      currentDir.value = r.root
      truncated.value = Boolean(r.truncated)
      const summary = summarizeScan(r.entries)
      const grouped = groupLocalFiles(r.entries, r.root)
      groups.value = grouped.map(g => {
        const part = summarizeScan(g.files)
        return {
          name: g.name,
          dir: g.dir,
          tracks: buildLocalTracks(g.files, { dir: g.dir, lyrics: r.lrc ?? {} }),
          encrypted: part.encrypted,
          encryptedByExt: part.encryptedByExt,
          ignored: part.ignored,
        }
      }).filter(g => g.tracks.length || g.encrypted)
      // 顶层统计只在整体上算一次，用于界面顶部那句汇总
      lastSummary.value = summary
      return groups.value
    } catch (e) {
      error.value = e instanceof Error ? e.message : '扫描失败'
      return []
    } finally {
      scanning.value = false
    }
  }

  async function pickDir(): Promise<string> {
    const native = nativeLocal()
    if (!native) return ''
    try {
      return await native.pickDir()
    } catch {
      return ''
    }
  }

  /**
   * 把选中的分组导入成歌单。
   *
   * 一个分组建一个歌单 —— 用户按歌单分目录下载的话，导入后结构和他
   * 在网易云里看到的一致；平铺的目录就只建一个。
   * 已存在的同名歌单会复用（不新建重复的），重复曲目由内核去重。
   */
  async function importGroups(selected: readonly ImportGroup[]): Promise<{ playlists: number; tracks: number }> {
    if (!selected.length) return { playlists: 0, tracks: 0 }
    importing.value = true
    error.value = ''
    let playlists = 0
    let tracks = 0
    try {
      await library.load()
      const existing = new Map(library.snapshot().playlists.map(p => [p.name, p.id]))
      for (const g of selected) {
        if (!g.tracks.length) continue
        let id = existing.get(g.name)
        if (!id) {
          const pl = await library.createPlaylist(g.name || '本地音乐')
          id = pl.id
          existing.set(pl.name, pl.id)
          playlists++
        }
        for (const t of g.tracks) {
          const added = await library.addToPlaylist(id, t)
          if (added) tracks++
        }
      }
      return { playlists, tracks }
    } catch (e) {
      error.value = e instanceof Error ? e.message : '导入失败'
      return { playlists, tracks }
    } finally {
      importing.value = false
    }
  }

  function reset(): void {
    groups.value = []
    currentDir.value = ''
    error.value = ''
    truncated.value = false
    lastSummary.value = summarizeScan([])
  }

  return {
    detecting, scanning, importing, error, truncated,
    foundDirs, clientDirs, currentDir, groups,
    totalTracks, totalEncrypted, totalDecoded, lastSummary,
    detect, scan, pickDir, importGroups, reset,
  }
}
