/**
 * 备份与恢复（4.10）
 *
 * 换设备 / 重装系统时，收藏、歌单、试听列表、历史、屏蔽规则都在这一个
 * JSON 里。刻意做成**用户能读的明文**：出问题时能打开看一眼，而不是
 * 扔进一个只有自己认识的二进制格式。
 *
 * 两种恢复方式：
 *   - 合并：与 lx 的云同步同一套 mergePayload 规则（并集/取较新），
 *     适合「新设备上已经有几首歌，再把旧备份并进来」；
 *   - 覆盖：直接用备份整体替换，适合「这台机器的列表已经乱了」。
 */
import { APP_VERSION, mergePayload, type SyncPayload } from '@lxmn/core'
import { library } from './sync'
import { saveText, safeFileName } from './download'

const SCHEMA = 1
const APP_TAG = 'lyco-music'

export interface BackupFile {
  schema: number
  app: string
  version: string
  exportedAt: string
  payload: SyncPayload
}

export interface BackupCounts {
  favorites: number
  playlists: number
  history: number
  trial: number
  dislikes: number
  settings: boolean
}

export function countPayload(p: SyncPayload): BackupCounts {
  return {
    favorites: p.favorites?.length ?? 0,
    playlists: p.playlists?.length ?? 0,
    history: p.history?.length ?? 0,
    trial: p.trial?.length ?? 0,
    dislikes: p.dislikes?.length ?? 0,
    settings: Boolean(p.settings && Object.keys(p.settings).length),
  }
}

export function buildBackup(): BackupFile {
  return {
    schema: SCHEMA,
    app: APP_TAG,
    version: APP_VERSION,
    exportedAt: new Date().toISOString(),
    payload: library.toPayload(),
  }
}

/** 导出到用户选的位置，返回落盘路径（取消时返回空串） */
export async function exportBackup(): Promise<{ path: string; counts: BackupCounts } | { error: string } | { canceled: true }> {
  const data = buildBackup()
  const name = safeFileName('lyco-music-backup-' + new Date().toISOString().slice(0, 10)) + '.json'
  const res = await saveText(name, JSON.stringify(data, null, 2))
  if (res.canceled) return { canceled: true }
  if (!res.ok) return { error: res.error || '保存失败' }
  return { path: res.path || name, counts: countPayload(data.payload) }
}

/** 解析备份文本，失败时给出人话原因而不是 JSON 报错 */
export function parseBackup(text: string): { payload: SyncPayload } | { error: string } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { error: '不是合法的 JSON，可能选错了文件' }
  }
  const data = raw as Partial<BackupFile>
  if (!data || typeof data !== 'object') return { error: '备份内容为空' }
  if (data.app && data.app !== APP_TAG) return { error: '这份备份不是 Lyco Music 的（' + data.app + '）' }
  const payload = data.payload as SyncPayload | undefined
  if (!payload || typeof payload !== 'object') return { error: '备份里没有 payload 字段' }
  // 只做形状校验：字段缺失按空数组处理，老版本备份里没有 trial/dislikes 也能导入
  return {
    payload: {
      favorites: Array.isArray(payload.favorites) ? payload.favorites : [],
      playlists: Array.isArray(payload.playlists) ? payload.playlists : [],
      history: Array.isArray(payload.history) ? payload.history : [],
      trial: Array.isArray(payload.trial) ? payload.trial : [],
      dislikes: Array.isArray(payload.dislikes) ? payload.dislikes : [],
      settings: payload.settings && typeof payload.settings === 'object' ? payload.settings : {},
      settingsUpdatedAt: Number(payload.settingsUpdatedAt) || 0,
    },
  }
}

export type ImportMode = 'merge' | 'replace'

/**
 * 导入备份。
 *
 * 合并用的是云同步那套 mergePayload：同一套规则才能保证「本机合并备份」
 * 和「两台设备同步」得到的列表一致，否则会出现「导入后多出一个重复歌单」。
 */
export async function importBackup(mode: ImportMode): Promise<{ ok: true; counts: BackupCounts } | { ok: false; error?: string; canceled?: boolean }> {
  const n = window.lxmnNative
  if (!n?.openFile) return { ok: false, error: '当前环境不支持选择文件' }
  const picked = await n.openFile({
    title: '选择 Lyco Music 备份文件',
    filters: [{ name: 'Lyco Music 备份', extensions: ['json'] }],
  })
  if (picked.canceled) return { ok: false, canceled: true }
  if (!picked.ok || typeof picked.content !== 'string') return { ok: false, error: picked.error || '读取失败' }

  const parsed = parseBackup(picked.content)
  if ('error' in parsed) return { ok: false, error: parsed.error }

  await library.load()
  const next = mode === 'replace' ? parsed.payload : mergePayload(library.toPayload(), parsed.payload)
  await library.replace(next)
  await library.load()
  return { ok: true, counts: countPayload(next) }
}
