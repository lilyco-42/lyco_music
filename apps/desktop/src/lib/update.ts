/**
 * 检查更新（6.9）与更新日志（6.10）
 *
 * 不引 electron-updater：它要求产物带 latest.yml + 签名校验，而我们的
 * 安装包是未签名的，自动下载安装只会换来一堆「被系统拦下」的求助。
 * 这里做的是**告知 + 一键打开下载页**：用户知道有新版本，点一下去装，
 * 比装一个半残的自动更新器诚实。
 */
import { computed, ref } from 'vue'
import { APP_VERSION } from '@lxmn/core'
import { prefs } from './prefs'
import { toast } from './toast'

const RELEASES_API = 'https://api.github.com/repos/lilyco-42/lyco_music/releases?per_page=5'
const RELEASES_PAGE = 'https://github.com/lilyco-42/lyco_music/releases'
const CHECK_INTERVAL = 6 * 60 * 60 * 1000

export interface ReleaseInfo {
  tag: string
  name: string
  notes: string
  url: string
  publishedAt: string
  version: string
  newer: boolean
}

const checking = ref(false)
const latest = ref<ReleaseInfo | null>(null)
const error = ref('')
const lastCheckedAt = ref(0)

/** 把 v0.2.31-20261021 / v0.2.31 这类 tag 归一成可比较的三段式 */
export function versionFromTag(tag: string): string {
  const m = /v?(\d+)\.(\d+)\.(\d+)/.exec(String(tag || ''))
  return m ? m[1] + '.' + m[2] + '.' + m[3] : ''
}

/** 三段式比较：返回 1 表示 a 比 b 新 */
export function compareVersion(a: string, b: string): number {
  const pa = a.split('.').map(n => Number(n) || 0)
  const pb = b.split('.').map(n => Number(n) || 0)
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x !== y) return x > y ? 1 : -1
  }
  return 0
}

export function useUpdater() {
  const current = APP_VERSION
  const hasUpdate = computed(() => Boolean(latest.value?.newer))

  async function check(silent = false): Promise<ReleaseInfo | null> {
    if (checking.value) return latest.value
    checking.value = true
    error.value = ''
    try {
      const res = await fetch(RELEASES_API, { headers: { accept: 'application/vnd.github+json' } })
      if (!res.ok) throw new Error('GitHub 返回 ' + res.status)
      const raw = (await res.json()) as Array<{ tag_name?: string; name?: string; body?: string; html_url?: string; published_at?: string; draft?: boolean }>
      const items = (Array.isArray(raw) ? raw : [])
        .filter(r => !r.draft && r.tag_name)
        .map(r => {
          const v = versionFromTag(String(r.tag_name))
          return {
            tag: String(r.tag_name),
            name: String(r.name || r.tag_name),
            notes: String(r.body || ''),
            url: String(r.html_url || RELEASES_PAGE),
            publishedAt: String(r.published_at || ''),
            version: v,
            newer: v ? compareVersion(v, current) > 0 : false,
          }
        })
      const best = items
        .filter(i => i.version)
        .sort((a, b) => compareVersion(b.version, a.version))[0]
      latest.value = best ?? null
      lastCheckedAt.value = Date.now()
      if (hasUpdate.value && !silent) toast('发现新版本 ' + (latest.value?.version ?? ''))
      else if (!silent) toast('已经是最新版本')
      return latest.value
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      if (!silent) toast('检查更新失败：' + error.value)
      return null
    } finally {
      checking.value = false
    }
  }

  /** 启动后静默检查一次（开关在设置页） */
  function maybeAutoCheck(): void {
    if (!prefs.autoCheckUpdate) return
    if (Date.now() - lastCheckedAt.value < CHECK_INTERVAL) return
    setTimeout(() => { void check(true) }, 3000)
  }

  function openDownload(): void {
    const url = latest.value?.newer ? latest.value.url : RELEASES_PAGE
    void window.lxmnNative?.openExternal?.(url)
  }

  return { current, latest, checking, error, lastCheckedAt, hasUpdate, check, maybeAutoCheck, openDownload, RELEASES_PAGE }
}
