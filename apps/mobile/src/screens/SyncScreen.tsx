/**
 * 云同步页（移动端）
 *
 * 默认服务器 lain42.top。会员用户点一下就用订阅令牌开通同步，
 * 不额外注册账号。也支持自建服务器。
 */
import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator, Pressable, ScrollView, Text, TextInput, View,
} from 'react-native'
import type { SyncOutcome } from '@lxmn/core'
import {
  connectCustom, connectWithMembership, disconnectSync, library,
  loadLibrary, restoreSync, syncNow, syncServer, syncToken,
} from '../sync'
import { useMembership } from '../license'
import { colors, useTopInset } from '../theme'

interface Counts {
  favorites: number
  playlists: number
  history: number
}

export default function SyncScreen({ onBack }: { onBack?: () => void }) {
  const insetTop = useTopInset()
  const [counts, setCounts] = useState<Counts>({ favorites: 0, playlists: 0, history: 0 })
  const [configured, setConfigured] = useState(false)
  const [mask, setMask] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [syncedAt, setSyncedAt] = useState(0)
  const [token, setToken] = useState('')
  const [base, setBase] = useState('')
  const [showCustom, setShowCustom] = useState(false)

  const { isActive } = useMembership()

  const pull = useCallback(() => {
    const s = library.snapshot()
    setCounts({ favorites: s.favorites.length, playlists: s.playlists.length, history: s.history.length })
  }, [])

  const maskToken = (t: string) => {
    if (!t) return ''
    if (t.length <= 8) return t[0] + '****'
    return t.slice(0, 4) + '****' + t.slice(-4)
  }

  const refreshTokenMask = useCallback(async () => {
    setMask(maskToken(await syncToken()))
  }, [])

  useEffect(() => {
    void (async () => {
      await loadLibrary()
      pull()
      const r = await restoreSync()
      setConfigured(r.configured)
      setSyncedAt(r.syncedAt)
      await refreshTokenMask()
      pull()
    })()
  }, [pull, refreshTokenMask])

  /** 把同步结果翻译成人话；返回 true 表示成功 */
  function report(r: SyncOutcome | null): boolean {
    if (!r) return false
    switch (r.state) {
      case 'ok':
        setSyncedAt(Date.now())
        setMessage(r.pushed ? '已上传本机改动' : '已是最新')
        return true
      case 'conflict':
        setMessage('另一台设备也在改，已合并，稍后再同步一次即可')
        return true
      case 'disabled':
        setConfigured(false)
        setMessage(r.reason)
        return false
      case 'error':
        setError(r.reason)
        return false
    }
  }

  async function onUseMembership() {
    setBusy(true); setError(''); setMessage('')
    try {
      report(await connectWithMembership())
      setConfigured(true)
      await refreshTokenMask()
      pull()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function onConnectCustom() {
    setBusy(true); setError(''); setMessage('')
    try {
      report(await connectCustom(base, token))
      setConfigured(true)
      setToken('')
      await refreshTokenMask()
      pull()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function onSyncNow() {
    setBusy(true); setError(''); setMessage('')
    try {
      report(await syncNow())
      pull()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function onDisconnect() {
    await disconnectSync()
    setConfigured(false)
    setMask('')
    setMessage('已关闭云同步（本地收藏保留）')
  }

  function fmtTime(ms: number): string {
    if (!ms) return '从未'
    const d = new Date(ms)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  }

  const card = {
    backgroundColor: colors.surface, borderRadius: 16, padding: 20,
    borderWidth: 1, borderColor: '#2f2f2f',
  } as const

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insetTop }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 32 }}>
        {onBack ? (
          <Pressable onPress={onBack} hitSlop={10} style={{ marginBottom: 12 }}>
            <Text style={{ color: colors.muted, fontSize: 13.5 }}>‹ 返回</Text>
          </Pressable>
        ) : null}
        <Text style={{ color: colors.fg, fontSize: 24, fontWeight: '700', marginBottom: 6 }}>云同步</Text>
        <Text style={{ color: colors.muted, fontSize: 13, marginBottom: 20 }}>
          收藏、歌单、播放记录在桌面端与移动端之间自动同步
        </Text>

        {/* 服务器 + 状态 */}
        <View style={card}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.fg, fontSize: 16, fontWeight: '600' }}>同步服务器</Text>
              <Text style={{ color: colors.muted, fontSize: 13, marginTop: 4 }}>{syncServer}</Text>
            </View>
            <View style={{
              borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6,
              backgroundColor: configured ? '#1d3324' : colors.elevated,
            }}>
              <Text style={{ color: configured ? '#6ede8a' : colors.muted, fontSize: 12 }}>
                {configured ? '已开通' : '未开通'}
              </Text>
            </View>
          </View>

          <Text style={{ color: colors.fainter, fontSize: 12, marginTop: 14, lineHeight: 18 }}>
            默认使用官方服务器，无需配置。会员身份即同步身份 —— 激活会员后自动开通。
          </Text>

          {!configured ? (
            <>
              {isActive ? (
                <Pressable
                  onPress={onUseMembership}
                  disabled={busy}
                  style={{
                    marginTop: 16, backgroundColor: busy ? '#7a2630' : colors.accent,
                    borderRadius: 24, paddingVertical: 14, alignItems: 'center',
                  }}
                >
                  {busy ? <ActivityIndicator color="#fff" /> : (
                    <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>用会员订阅一键开通</Text>
                  )}
                </Pressable>
              ) : (
                <View style={{ marginTop: 16, backgroundColor: colors.bg, borderRadius: 12, padding: 14 }}>
                  <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 19 }}>
                    还没开通会员。同步使用会员令牌，请先到「会员」页激活订阅链接。
                  </Text>
                </View>
              )}

              <Pressable onPress={() => setShowCustom(v => !v)} style={{ marginTop: 12, paddingVertical: 6 }}>
                <Text style={{ color: colors.fainter, fontSize: 13 }}>
                  {showCustom ? '收起自建服务器' : '使用自建同步服务器'}
                </Text>
              </Pressable>

              {showCustom ? (
                <>
                  <TextInput
                    value={base}
                    onChangeText={setBase}
                    placeholder="服务器地址，如 https://sync.example.com/studio"
                    placeholderTextColor={colors.fainter}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={{
                      marginTop: 12, backgroundColor: colors.bg, borderRadius: 12,
                      paddingHorizontal: 14, paddingVertical: 13, color: colors.fg,
                      fontSize: 14, borderWidth: 1, borderColor: '#2f2f2f',
                    }}
                  />
                  <TextInput
                    value={token}
                    onChangeText={setToken}
                    placeholder="同步令牌"
                    placeholderTextColor={colors.fainter}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={{
                      marginTop: 10, backgroundColor: colors.bg, borderRadius: 12,
                      paddingHorizontal: 14, paddingVertical: 13, color: colors.fg,
                      fontSize: 14, borderWidth: 1, borderColor: '#2f2f2f',
                    }}
                  />
                  <Pressable
                    onPress={onConnectCustom}
                    disabled={busy}
                    style={{
                      marginTop: 10, borderRadius: 22, paddingVertical: 13,
                      alignItems: 'center', borderWidth: 1, borderColor: '#3a3a3a',
                    }}
                  >
                    <Text style={{ color: colors.fg, fontSize: 15 }}>连接</Text>
                  </Pressable>
                </>
              ) : null}
            </>
          ) : (
            <>
              <View style={{
                marginTop: 16, backgroundColor: colors.bg, borderRadius: 12,
                padding: 16, flexDirection: 'row', alignItems: 'center',
              }}>
                <View>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>同步令牌</Text>
                  <Text style={{ color: colors.fg, fontSize: 14, marginTop: 4 }}>{mask || '—'}</Text>
                </View>
                <View style={{ marginLeft: 'auto', alignItems: 'flex-end' }}>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>上次同步</Text>
                  <Text style={{ color: colors.fg, fontSize: 14, marginTop: 4 }}>{fmtTime(syncedAt)}</Text>
                </View>
              </View>

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                <Pressable
                  onPress={onSyncNow}
                  disabled={busy}
                  style={{
                    flex: 1, backgroundColor: busy ? '#7a2630' : colors.accent,
                    borderRadius: 22, paddingVertical: 13, alignItems: 'center',
                  }}
                >
                  {busy ? <ActivityIndicator color="#fff" /> : (
                    <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600' }}>立即同步</Text>
                  )}
                </Pressable>
                <Pressable
                  onPress={onDisconnect}
                  disabled={busy}
                  style={{
                    paddingHorizontal: 22, borderRadius: 22, paddingVertical: 13,
                    alignItems: 'center', borderWidth: 1, borderColor: '#3a3a3a',
                  }}
                >
                  <Text style={{ color: colors.fg, fontSize: 15 }}>关闭同步</Text>
                </Pressable>
              </View>
            </>
          )}

          {error ? <Text style={{ color: colors.accent, fontSize: 13, marginTop: 12 }}>{error}</Text> : null}
          {!error && message ? <Text style={{ color: colors.muted, fontSize: 13, marginTop: 12 }}>{message}</Text> : null}
        </View>

        {/* 本地数据概览 */}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
          {([
            ['我喜欢的', counts.favorites],
            ['歌单', counts.playlists],
            ['最近播放', counts.history],
          ] as const).map(([label, n]) => (
            <View key={label} style={[card, { flex: 1, padding: 16 }]}>
              <Text style={{ color: colors.fg, fontSize: 22, fontWeight: '700' }}>{n}</Text>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>{label}</Text>
            </View>
          ))}
        </View>

        {/* 冲突策略说明 */}
        <View style={[card, { marginTop: 16 }]}>
          <Text style={{ color: colors.fg, fontSize: 15, fontWeight: '600' }}>冲突是怎么处理的</Text>
          {[
            '收藏、歌单取并集 —— 任何一台设备上收藏过的歌都不会丢',
            '播放次数取两边较大的值，不会因为同步而翻倍',
            '歌单里歌曲的顺序以最近修改的那台设备为准，不重排',
          ].map(t => (
            <View key={t} style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent, marginTop: 6 }} />
              <Text style={{ color: colors.muted, fontSize: 13, flex: 1, lineHeight: 19 }}>{t}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  )
}
