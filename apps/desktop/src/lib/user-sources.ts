/**
 * 用户自己导入的 lx 音源脚本
 *
 * lx-music 的护城河就是这个：用户手里有一堆 .js 音源脚本，导入即用。
 * 我们不支持导入，就等于要求迁移用户二选一。所以这里做最小但完整的一套：
 *
 *   - 从 URL 导入（与 lx 2.7+ 一致）
 *   - 从本地文件导入（把文本读进来存着，不依赖原文件还在）
 *   - 启用 / 停用 / 删除
 *
 * 脚本**没有**在导入时执行任何代码 —— 只有真的取流时，SourcePool 才会
 * 在沙箱里跑它（见 core 的 lxscript/runtime.ts）。导入页必须把这一点写清楚：
 * 用户是在执行第三方代码，这是他自己的选择，但不能不知情。
 */
import { computed, ref } from 'vue'

export interface UserSource {
  id: string
  /** 展示名，默认取脚本里的 name，取不到就用文件名/域名 */
  name: string
  /** 导入时的来源（URL 或文件名），只用于展示 */
  origin: string
  code: string
  enabled: boolean
  addedAt: number
  /** 导入时从脚本里读到的版本号，lx 的脚本会写 version */
  version?: string
}

const KEY = 'lxmn.user.sources.v1'
/** 单个脚本上限：lx 的脚本一般 30–200KB，2MB 已经很宽松了 */
const MAX_CODE = 2_000_000

const sources = ref<UserSource[]>([])
let loaded = false

function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(sources.value))
  } catch {
    // 配额满（脚本很大）时至少本次会话还能用
  }
}

export function loadUserSources(): UserSource[] {
  if (loaded) return sources.value
  loaded = true
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    if (Array.isArray(parsed)) {
      sources.value = parsed
        .filter((s): s is UserSource => Boolean(s) && typeof (s as UserSource).code === 'string')
        .map(s => ({
          id: String(s.id || '').trim() || 'user:' + Math.random().toString(36).slice(2),
          name: String(s.name || '未命名音源'),
          origin: String(s.origin || ''),
          code: s.code,
          enabled: s.enabled !== false,
          addedAt: Number(s.addedAt) || Date.now(),
          version: s.version ? String(s.version) : undefined,
        }))
    }
  } catch {
    sources.value = []
  }
  return sources.value
}

/** 给 SourcePool 用的条目。id 带 user: 前缀，避免和订阅里的脚本撞 id */
export function userSourceEntries(): Array<{ id: string; name: string; code: string; order: number; enabled: boolean }> {
  return loadUserSources()
    .filter(s => s.enabled && s.code)
    .map((s, i) => ({ id: s.id, name: s.name, code: s.code, order: 900 + i, enabled: true }))
}

/**
 * 从脚本源码里猜一个展示名。
 *
 * lx 脚本的元信息写法不统一（有的用 name 字段，有的写在注释里），
 * 所以只做尽力而为：注释里的 @name 优先，其次 name 字段，最后用来源兜底。
 */
export function guessName(code: string, fallback: string): string {
  const patterns = [
    /@name\s+([^\n*]+)/i,
    /\bname\s*[:=]\s*['"`]([^'"`]{1,60})['"`]/,
  ]
  for (const re of patterns) {
    const m = re.exec(code)
    const v = m && m[1] ? m[1].trim() : ''
    if (v && v.length <= 60) return v
  }
  return fallback
}

/** 从脚本里读 version 字段（lx 脚本普遍有） */
export function guessVersion(code: string): string | undefined {
  const m = /\bversion\s*[:=]\s*['"`]([^'"`]{1,20})['"`]/.exec(code) || /@version\s+([^\n*]+)/i.exec(code)
  return m && m[1] ? m[1].trim() : undefined
}

function normalizeCode(code: string): string {
  return String(code ?? '').replace(/^\uFEFF/, '')
}

/** 校验：太短、太大都挡在门外 */
export function validateCode(code: string): string {
  const c = normalizeCode(code)
  if (!c.trim()) return '脚本是空的'
  if (c.length < 200) return '脚本太小了（不到 200 字节），可能不是完整的音源脚本'
  if (c.length > MAX_CODE) return '脚本超过 2MB，拒绝导入'
  return ''
}

async function fetchCode(url: string): Promise<string> {
  const res = await fetch(url, { cache: 'no-cache' })
  if (!res.ok) throw new Error('下载失败（HTTP ' + res.status + '）')
  const text = await res.text()
  const bad = validateCode(text)
  if (bad) throw new Error(bad)
  return normalizeCode(text)
}

export function useUserSources() {
  loadUserSources()

  const list = computed(() => [...sources.value].sort((a, b) => b.addedAt - a.addedAt))
  const enabledCount = computed(() => sources.value.filter(s => s.enabled).length)

  function upsert(entry: { name: string; origin: string; code: string; version?: string }): UserSource {
    // 同一个来源重复导入视为更新，不产生第二条
    const exist = entry.origin ? sources.value.find(s => s.origin && s.origin === entry.origin) : undefined
    if (exist) {
      exist.code = entry.code
      exist.name = entry.name
      exist.version = entry.version
      exist.enabled = true
      persist()
      return exist
    }
    const item: UserSource = {
      id: 'user:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: entry.name,
      origin: entry.origin,
      code: entry.code,
      enabled: true,
      addedAt: Date.now(),
      version: entry.version,
    }
    sources.value = [item, ...sources.value]
    persist()
    return item
  }

  async function addFromUrl(rawUrl: string): Promise<UserSource> {
    const url = String(rawUrl ?? '').trim()
    if (!/^https?:\/\//i.test(url)) throw new Error('请填 http(s) 开头的脚本地址')
    const code = await fetchCode(url)
    let host = '网络导入'
    try { host = new URL(url).hostname.replace(/^www\./, '') } catch { /* 地址非法时用兜底名 */ }
    return upsert({ name: guessName(code, host), origin: url, code, version: guessVersion(code) })
  }

  async function addFromFile(file: File): Promise<UserSource> {
    const code = normalizeCode(await file.text())
    const bad = validateCode(code)
    if (bad) throw new Error(bad)
    return upsert({
      name: guessName(code, file.name.replace(/\.js$/i, '')),
      origin: file.name,
      code,
      version: guessVersion(code),
    })
  }

  function toggle(id: string): void {
    const s = sources.value.find(x => x.id === id)
    if (!s) return
    s.enabled = !s.enabled
    persist()
  }

  function remove(id: string): void {
    sources.value = sources.value.filter(s => s.id !== id)
    persist()
  }

  return { list, enabledCount, addFromUrl, addFromFile, toggle, remove }
}
