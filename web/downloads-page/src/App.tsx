import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Apple, ArrowUpRight, Check, ChevronDown, Command, Download, ExternalLink, Filter,
  Github, Globe, HardDrive, Info, Laptop, Loader2, Package, Search, ShieldCheck, Smartphone,
  Sparkles, Terminal, X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Card, Separator } from '@/components/ui/card'
import { cn, formatSize } from '@/lib/utils'
import type { Item, Manifest } from './types'

const PLATFORM_LABELS: Record<string, string> = {
  windows: 'Windows', macos: 'macOS', ios: 'iPhone / iPad', android: 'Android', linux: 'Linux',
}

const PLATFORM_ICONS: Record<string, typeof Laptop> = {
  windows: Laptop, macos: Apple, ios: Smartphone, android: Smartphone, linux: Terminal,
}

const DL_KEY = 'wb-token'
const DL_PRICE = 10

function getToken() {
  try { return localStorage.getItem(DL_KEY) || '' } catch { return '' }
}

function sourceBadge(item: Item) {
  if (Array.isArray(item.downloads) && item.downloads.length) return { label: '多平台直链', tone: 'brand' as const }
  if (item.mirror) {
    if (/github\.com/.test(item.mirror.url)) return { label: 'GitHub 直链 · 断点续传', tone: 'brand' as const }
    if (/dl\.lilyco42\.top|\.workers\.dev/.test(item.mirror.url)) return { label: 'Cloudflare R2', tone: 'brand' as const }
    return { label: '本站文件', tone: 'secondary' as const }
  }
  if (item.channel === '开发者测试') return { label: '开发者测试', tone: 'outline' as const }
  if (item.download_url) return { label: 'GitHub Release', tone: 'secondary' as const }
  if (item.channel === 'App Store') return { label: 'App Store', tone: 'outline' as const }
  return { label: item.channel || '官方站点', tone: 'outline' as const }
}

function FacetGroup({
  title, children, defaultOpen = true,
}: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-b border-border py-3 last:border-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 py-1 text-[13px] font-semibold text-foreground"
        aria-expanded={open}
      >
        {title}
        <ChevronDown className={cn('size-3.5 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="mt-2 space-y-0.5">{children}</div>}
    </div>
  )
}

function FacetOption({
  label, count, active, onClick, icon: Icon,
}: { label: string; count: number; active: boolean; onClick: () => void; icon?: typeof Laptop }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors',
        active ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
      )}
    >
      {Icon && <Icon className="size-3.5 shrink-0 opacity-80" />}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground">{count}</span>
      {active && <Check className="size-3 shrink-0" />}
    </button>
  )
}

export default function App() {
  const [items, setItems] = useState<Item[] | null>(null)
  const [error, setError] = useState('')
  const [updatedAt, setUpdatedAt] = useState('')
  const [q, setQ] = useState('')
  const [platform, setPlatform] = useState('')
  const [category, setCategory] = useState('')
  const [channel, setChannel] = useState('')
  const [sort, setSort] = useState<'default' | 'name' | 'size'>('default')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [busySlug, setBusySlug] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    setQ(params.get('q') || '')
    const p = params.get('platform') || ''
    if (p in PLATFORM_LABELS) setPlatform(p)
  }, [])

  useEffect(() => {
    let alive = true
    fetch('/downloads/manifest.json', { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error('manifest ' + r.status); return r.json() })
      .then((data: Manifest) => {
        if (!alive) return
        setItems(Array.isArray(data.items) ? data.items : [])
        setUpdatedAt(fmtUpdated(data.updatedAt))
      })
      .catch(() => { if (alive) { setItems([]); setError('目录暂时不可用，请稍后重试或前往软件官网。') } })
    return () => { alive = false }
  }, [])

  const countFor = useCallback((predicate: (i: Item) => boolean) => (
    (items || []).filter(predicate).length
  ), [items])

  const categories = useMemo(() => {
    const m = new Map<string, number>()
    for (const i of items || []) if (i.category) m.set(i.category, (m.get(i.category) || 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'))
  }, [items])

  const channels = useMemo(() => {
    const m = new Map<string, number>()
    for (const i of items || []) {
      const label = sourceBadge(i).label
      m.set(label, (m.get(label) || 0) + 1)
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [items])

  const shown = useMemo(() => {
    const needle = q.toLowerCase().trim()
    let list = (items || []).filter((i) => {
      if (platform && !(i.platforms || []).includes(platform)) return false
      if (category && i.category !== category) return false
      if (channel && sourceBadge(i).label !== channel) return false
      if (!needle) return true
      return [i.name, i.summary, i.category, i.license, i.channel, i.id].join(' ').toLowerCase().includes(needle)
    })
    if (sort === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    if (sort === 'size') list = [...list].sort((a, b) => (b.mirror?.size || 0) - (a.mirror?.size || 0))
    return list
  }, [items, q, platform, category, channel, sort])

  const activeFilters = [platform && PLATFORM_LABELS[platform], category, channel].filter(Boolean) as string[]

  function reset() {
    setPlatform('')
    setCategory('')
    setChannel('')
    setQ('')
    const url = new URL(location.href)
    url.search = ''
    history.replaceState(null, '', url.pathname + url.hash)
  }

  function pickPlatform(next: string) {
    const value = next === platform ? '' : next
    setPlatform(value)
    const url = new URL(location.href)
    if (value) url.searchParams.set('platform', value)
    else url.searchParams.delete('platform')
    history.replaceState(null, '', url.pathname + url.search + url.hash)
  }

  function download(slug: string, name: string) {
    const token = getToken()
    if (!token) {
      alert('下载需要登录 lain42.top 账户（每次下载扣 ' + DL_PRICE + ' 积分，同一文件当天只扣一次）。')
      location.href = '/shop/#register'
      return
    }
    setBusySlug(slug)
    fetch('/studio/api/download/ticket', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ slug }),
    })
      .then((r) => r.json().then((j) => ({ ok: r.ok, body: j })))
      .then((res) => {
        if (!res.ok) {
          let detail = res.body && res.body.detail
          if (Array.isArray(detail)) detail = detail.map((x: { msg?: string }) => x.msg || x).join('；')
          throw new Error(detail || (res.body && res.body.message) || '无法获取下载链接（' + name + '）')
        }
        location.href = res.body.url
      })
      .catch((err) => alert('下载失败：' + err.message))
      .finally(() => setBusySlug(''))
  }

  const total = items?.length ?? 0

  return (
    <div className="dl-page mx-auto w-full max-w-[1180px] px-4 pb-16 pt-6 sm:px-6">
      {/* ── hero ─────────────────────────────────────────────── */}
      <header className="border-b border-border pb-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              <Sparkles className="size-3.5" /> All platforms · official & verified
            </div>
            <h1 className="mt-2 text-[clamp(28px,4vw,40px)] font-semibold leading-tight tracking-tight">
              软件下载中心
            </h1>
            <p className="mt-2 max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
              开发、AI、创作、安全与效率工具目录。优先官方安装入口；本站镜像提供版本、大小与 SHA-256，支持断点续传。
              当前共 <span className="font-medium text-foreground tabular-nums">{total}</span> 个条目
              {items && updatedAt ? <>，更新于 <span className="tabular-nums">{updatedAt}</span></> : null}。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="brand" size="sm">
              <a href="/downloads/rembg/index.html"><Package />批量抠图教程</a>
            </Button>
            <Button asChild variant="secondary" size="sm">
              <a href="/shop/"><Sparkles />充值积分</a>
            </Button>
          </div>
        </div>

        <div className="mt-5 flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-3 text-[12px] leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0 text-brand" />
          <div>
            <b className="text-foreground">镜像计费说明</b>：标注「{DL_PRICE} 积分」的按钮需登录后点击，系统扣除 {DL_PRICE} 积分并签发 1 小时有效链接；
            同一文件当天只扣一次，断点续传或重试不重复计费。新用户注册赠送 25 积分。
            <a className="ml-1 inline-flex items-center gap-0.5 font-medium text-foreground underline underline-offset-2" href="/shop/#register">注册 / 登录<ArrowUpRight className="size-3" /></a>
          </div>
        </div>
      </header>

      {/* ── body: facets + results ───────────────────────────── */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
        {/* facets */}
        <aside className={cn('min-w-0', filtersOpen ? 'block' : 'hidden lg:block')} aria-label="筛选">
          <div className="sticky top-4">
            <div className="flex items-center justify-between pb-1 lg:hidden">
              <span className="text-sm font-semibold">筛选</span>
              <Button variant="ghost" size="icon-sm" onClick={() => setFiltersOpen(false)} aria-label="关闭筛选">
                <X />
              </Button>
            </div>
            <FacetGroup title="平台">
              {Object.entries(PLATFORM_LABELS).map(([key, label]) => (
                <FacetOption
                  key={key}
                  label={label}
                  icon={PLATFORM_ICONS[key]}
                  count={countFor((i) => (i.platforms || []).includes(key))}
                  active={platform === key}
                  onClick={() => pickPlatform(key)}
                />
              ))}
            </FacetGroup>
            <FacetGroup title="分类">
              {categories.map(([name, n]) => (
                <FacetOption
                  key={name}
                  label={name}
                  count={n}
                  active={category === name}
                  onClick={() => setCategory(category === name ? '' : name)}
                />
              ))}
            </FacetGroup>
            <FacetGroup title="下载源" defaultOpen={false}>
              {channels.map(([name, n]) => (
                <FacetOption
                  key={name}
                  label={name}
                  count={n}
                  active={channel === name}
                  onClick={() => setChannel(channel === name ? '' : name)}
                />
              ))}
            </FacetGroup>
            {activeFilters.length > 0 && (
              <Button variant="secondary" size="sm" className="mt-3 w-full" onClick={reset}>
                <X />清除全部筛选
              </Button>
            )}
          </div>
        </aside>

        {/* results */}
        <section className="min-w-0" aria-label="软件列表">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="搜索名称、用途、许可证…"
                aria-label="搜索软件"
                className="h-9 pl-9 pr-9"
              />
              {q && (
                <button
                  type="button"
                  onClick={() => setQ('')}
                  aria-label="清空搜索"
                  className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
            <Button
              variant="secondary"
              size="sm"
              className="lg:hidden"
              onClick={() => setFiltersOpen((v) => !v)}
            >
              <Filter />筛选{activeFilters.length ? ' · ' + activeFilters.length : ''}
            </Button>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as typeof sort)}
              aria-label="排序方式"
              className="h-9 shrink-0 rounded-md border border-input bg-background px-2.5 text-[13px] shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
            >
              <option value="default">默认排序</option>
              <option value="name">按名称</option>
              <option value="size">按体积</option>
            </select>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
            <span aria-live="polite" className="tabular-nums">
              {items === null ? '正在加载目录…' : '显示 ' + shown.length + ' / ' + total + ' 项'}
            </span>
            {activeFilters.map((f) => (
              <Badge key={f} variant="soft" className="gap-1">
                {f}
              </Badge>
            ))}
            {platform === 'ios' && <span className="text-muted-foreground">iPhone / iPad：优先 App Store；未签名 IPA 仅限开发者签名测试。</span>}
            {platform === 'macos' && <span className="text-muted-foreground">Mac：下载前请确认 Apple Silicon (arm64) 还是 Intel (x64)。</span>}
          </div>

          <Separator className="my-3" />

          {error && (
            <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
              {error}
            </div>
          )}

          {items === null && !error && (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />正在加载目录…
            </div>
          )}

          {items !== null && !error && shown.length === 0 && (
            <div className="rounded-lg border border-dashed border-border p-10 text-center">
              <p className="text-sm text-muted-foreground">该筛选下没有软件，试试其他平台或关键词。</p>
              <Button variant="secondary" size="sm" className="mt-3" onClick={reset}>清除筛选</Button>
            </div>
          )}

          <ul className="space-y-2.5">
            {shown.map((item) => (
              <SoftwareRow
                key={item.id}
                item={item}
                busy={busySlug === (item.mirror?.slug || '')}
                onDownload={download}
              />
            ))}
          </ul>
        </section>
      </div>

      {/* ── footer sections ──────────────────────────────────── */}
      <section className="mt-12 grid grid-cols-1 gap-3 md:grid-cols-2">
        <Card className="bg-muted/40 p-5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">lain42 API · cc-switch</div>
          <h2 className="mt-1.5 text-base font-semibold">连接自己的 AI 客户端</h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
            登录后创建个人令牌，在 cc-switch、Zed 或任意 OpenAI-compatible 客户端里加一个 provider。上游密钥只保存在服务端。
          </p>
          <code className="mt-3 block overflow-auto rounded-md bg-foreground px-2.5 py-2 text-[12px] text-background">Base URL: https://api.lain42.top/v1</code>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button asChild variant="brand" size="sm"><a href="https://api.lain42.top/keys">创建 API 令牌<ExternalLink /></a></Button>
            <Button asChild variant="secondary" size="sm"><a href="https://api.lain42.top/playground">打开 Playground</a></Button>
          </div>
        </Card>
        <Card className="bg-muted/40 p-5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Local first</div>
          <h2 className="mt-1.5 text-base font-semibold">本地服务无需登录</h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
            客户端支持 OpenAI-compatible 接口。常见默认地址：Ollama <code>127.0.0.1:11434/v1</code>，LM Studio <code>127.0.0.1:1234/v1</code>。
          </p>
          <code className="mt-3 block overflow-auto rounded-md bg-foreground px-2.5 py-2 text-[12px] text-background">curl http://127.0.0.1:1234/v1/models</code>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button asChild variant="secondary" size="sm"><a href="/tool/">打开 WASM 工具箱</a></Button>
          </div>
        </Card>
      </section>
    </div>
  )
}

function fmtUpdated(iso?: string) {
  if (!iso) return ''
  // manifest 目前只写 YYYY-MM-DD；不要补一个假的 00:00 时间。
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
}

function SoftwareRow({
  item, busy, onDownload,
}: { item: Item; busy: boolean; onDownload: (slug: string, name: string) => void }) {
  const rows = Array.isArray(item.downloads) ? item.downloads : []
  const badge = sourceBadge(item)
  const primaryHref = item.mirror ? item.mirror.url : (item.download_url || item.official || '')
  const platforms = item.platforms || []

  return (
    <li id={'software-' + item.id} className="scroll-mt-20">
      <Card className="gap-0 p-0 transition-colors hover:border-border-strong hover:bg-accent/20">
        <div className="flex items-start gap-3 p-4">
          {item.icon ? (
            <img src={item.icon} alt="" loading="lazy" className="size-11 shrink-0 rounded-lg border border-border object-cover" />
          ) : (
            <div className="grid size-11 shrink-0 place-items-center rounded-lg border border-border bg-muted text-[15px] font-semibold text-muted-foreground">
              {item.name.slice(0, 1).toUpperCase()}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h2 className="text-[15px] font-semibold leading-snug tracking-tight">
                <a href={'#'} onClick={(e) => e.preventDefault()} className="hover:underline">{item.name}</a>
              </h2>
              {item.version && <Badge variant="outline" className="font-mono">{item.version}</Badge>}
              <Badge variant={badge.tone}>{badge.label}</Badge>
              {item.disabled && <Badge variant="secondary">已暂停</Badge>}
            </div>

            <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">{item.summary}</p>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {platforms.map((p) => {
                const Icon = PLATFORM_ICONS[p] || Globe
                return (
                  <Badge key={p} variant="soft" className="gap-1 text-muted-foreground">
                    <Icon className="size-3" />{PLATFORM_LABELS[p] || p}
                  </Badge>
                )
              })}
              {item.category && <Badge variant="outline">{item.category}</Badge>}
              {item.license && <Badge variant="outline" className="max-w-[22ch] truncate" title={item.license}>{item.license}</Badge>}
              {item.mirror && <span className="text-[11px] tabular-nums text-muted-foreground">{formatSize(item.mirror.size)}</span>}
            </div>

            {rows.length > 0 && (
              <div className="mt-3 overflow-hidden rounded-lg border border-border">
                {rows.map((r, idx) => (
                  <div key={(r.slug || r.file || r.platform) + idx} className="flex items-center gap-3 border-t border-border px-3 py-2 first:border-t-0 even:bg-muted/40">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12.5px] font-medium">{r.platform}</div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {r.file || ''}{r.size ? ' · ' + formatSize(r.size) : ''}{r.note ? ' · ' + r.note : ''}
                      </div>
                    </div>
                    {r.slug ? (
                      <Button variant="brand" size="xs" onClick={() => onDownload(r.slug!, r.file || item.name)}>
                        {DL_PRICE} 积分
                      </Button>
                    ) : (
                      <Button asChild variant="secondary" size="xs">
                        <a href={r.url} rel="noopener noreferrer">下载</a>
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {item.mirror && (
              <div className="mt-2.5 rounded-lg bg-muted/60 px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground">
                <div className="flex flex-wrap items-center gap-x-1.5">
                  <ShieldCheck className="size-3 shrink-0 text-brand" />
                  <span className="font-medium text-foreground">{item.mirror.platform}</span>
                  <span>·</span>
                  <span className="truncate font-mono">{item.mirror.file}</span>
                  {item.mirror.size ? <><span>·</span><span className="tabular-nums">{formatSize(item.mirror.size)}</span></> : null}
                </div>
                <div className="mt-0.5 break-all font-mono text-[10.5px] leading-snug opacity-80">SHA-256 {item.mirror.sha256}</div>
              </div>
            )}

            {item.note && (
              <p className="mt-2.5 rounded-md border-l-2 border-brand/60 bg-muted/50 px-2.5 py-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
                {item.note}
              </p>
            )}

            {item.install && (
              <code className="mt-2.5 block overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-muted-foreground">
                {item.install}
              </code>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {rows.length > 0 ? (
                <Button asChild variant="secondary" size="sm">
                  <a href={item.release || item.official} target="_blank" rel="noopener noreferrer">官方发布页 / 校验值<ArrowUpRight /></a>
                </Button>
              ) : item.disabled ? (
                <Button variant="secondary" size="sm" disabled>已暂停下载</Button>
              ) : item.mirror?.slug ? (
                <Button variant="brand" size="sm" disabled={busy} onClick={() => onDownload(item.mirror!.slug!, item.mirror!.file)}>
                  {busy ? <Loader2 className="animate-spin" /> : <Download />}下载 · {DL_PRICE} 积分
                </Button>
              ) : item.mirror ? (
                <Button asChild variant="brand" size="sm"><a href={primaryHref}>下载校验文件<Download /></a></Button>
              ) : item.channel === '开发者测试' ? (
                <Button asChild variant="brand" size="sm"><a href={primaryHref} target="_blank" rel="noopener noreferrer">获取未签名 IPA<ArrowUpRight /></a></Button>
              ) : item.download_url ? (
                <Button asChild variant="brand" size="sm"><a href={primaryHref} target="_blank" rel="noopener noreferrer">下载官方文件<Download /></a></Button>
              ) : (
                <Button asChild variant="brand" size="sm">
                  <a href={primaryHref} target="_blank" rel="noopener noreferrer">
                    {item.channel === 'App Store' ? '前往 App Store' : '前往官网下载'}<ArrowUpRight />
                  </a>
                </Button>
              )}

              {item.guide && (
                <Button asChild variant="secondary" size="sm">
                  <a href={item.guide}>{item.guideLabel || '使用步骤'}</a>
                </Button>
              )}
              {!item.disabled && item.originMirror && (
                <Button asChild variant="secondary" size="sm">
                  <a href={item.originMirror} target="_blank" rel="noopener noreferrer">源站备用<ArrowUpRight /></a>
                </Button>
              )}
              {item.official && item.official !== primaryHref && (
                <Button asChild variant="ghost" size="sm"><a href={item.official} target="_blank" rel="noopener noreferrer">版本与说明<ArrowUpRight /></a></Button>
              )}
              {item.repository && (
                <Button asChild variant="ghost" size="sm"><a href={item.repository} target="_blank" rel="noopener noreferrer" aria-label="源码仓库"><Github />源码</a></Button>
              )}
            </div>
          </div>
        </div>
      </Card>
    </li>
  )
}
