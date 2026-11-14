/**
 * 账户页（移动端）
 *
 * 登录走设备码流程：App 只显示 8 位码并轮询，用户在浏览器里确认。
 * 密码全程不进入 App —— 这是与「在 App 里填账号密码」的关键差别。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native'
import {
  accessToken, cancelPolling, pollDeviceToken, profile, requestDeviceCode,
  signOut as signOutAccount, VERIFICATION_URI,
} from '../account'
import type { AccountProfile, DeviceCode } from '../account'
import { ACCENT_PRESETS, colors, getAccent, setAccent, useTopInset } from '../theme'
import { MOBILE_LOCALES, setLocale, t as tr, tf, useLocale } from '../lib/i18n'

export default function AccountScreen({ onBack }: { onBack?: () => void }) {
  const insetTop = useTopInset()
  const loc = useLocale()
  const [me, setMe] = useState<AccountProfile | null>(null)
  const [accent, setAccentState] = useState(getAccent())
  const [device, setDevice] = useState<DeviceCode | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    void (async () => {
      // 有可用令牌就静默恢复，不打扰用户
      if (await accessToken()) {
        const p = await profile()
        if (alive.current) setMe(p)
      }
    })()
    return () => { alive.current = false; cancelPolling() }
  }, [])

  const startLogin = useCallback(async () => {
    setBusy(true)
    setError('')
    setDevice(null)
    try {
      const code = await requestDeviceCode()
      if (!alive.current) return
      setDevice(code)
      setSecondsLeft(code.expires_in)
      // 让用户直接跳到确认页（带上预填的设备码），省得手输
      void Linking.openURL(code.verification_uri_complete).catch(() => undefined)

      const account = await pollDeviceToken(code, (left) => {
        if (alive.current) setSecondsLeft(left)
      })
      if (!alive.current) return
      setMe(account)
      setDevice(null)
    } catch (e) {
      if (!alive.current) return
      setError(e instanceof Error ? e.message : tr('mobile.acct.authFailed'))
      setDevice(null)
    } finally {
      if (alive.current) setBusy(false)
    }
  }, [])

  const cancel = useCallback(() => {
    cancelPolling()
    setDevice(null)
    setBusy(false)
    setError(tr('mobile.acct.cancelled'))
  }, [])

  const doSignOut = useCallback(async () => {
    setBusy(true)
    try {
      await signOutAccount()
      if (alive.current) setMe(null)
    } finally {
      if (alive.current) setBusy(false)
    }
  }, [])

  const initial = (me?.username ?? '?').slice(0, 1).toUpperCase()

  return (
    <ScrollView
      style={styles.root}
      // paddingTop 在渲染期算：写进模块级 StyleSheet 等于还是加载期求值
      contentContainerStyle={[styles.content, { paddingTop: insetTop + 12 }]}
    >
      {/* 二级页要有明确的返回入口：标签栏虽然停在「我的」，
          但用户不一定会想到「再点一次我的」就是返回 */}
      {onBack ? (
        <Pressable onPress={onBack} hitSlop={10} style={{ marginBottom: 14 }}>
          <Text style={{ color: colors.muted, fontSize: 13.5 }}>{tr('mobile.acct.back')}</Text>
        </Pressable>
      ) : null}
      <Text style={styles.title}>{tr('mobile.acct.title')}</Text>
            <Text style={styles.subtitle}>{tr('mobile.acct.subtitle')}</Text>

      {/* 移动端没有独立设置页，账户页是最自然的语言切换位置 */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{tr('settings.language')}</Text>
        <Text style={styles.faint}>{tr('settings.languageNote')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
          {MOBILE_LOCALES.map(l => (
            <Pressable
              key={l.id}
              onPress={() => { void setLocale(l.id) }}
              style={{
                borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7,
                borderWidth: 1, borderColor: loc === l.id ? colors.accent : colors.divider,
                backgroundColor: loc === l.id ? colors.accent : colors.surface,
              }}
            >
              <Text style={{ color: loc === l.id ? '#fff' : colors.muted, fontSize: 12.5 }}>{l.native}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {me ? (
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{initial}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.username}>{me.username}</Text>
              <Text style={styles.faint}>{tf('mobile.acct.id', { id: me.account_id })}</Text>
            </View>
            {me.founder ? (
              <View style={styles.badge}><Text style={styles.badgeText}>{tr('mobile.acct.founder')}</Text></View>
            ) : null}
          </View>

          <Text style={styles.muted}>{tf('mobile.acct.entitlements', { n: me.entitlements.length })}</Text>
          <Text style={styles.faint}>{tr('mobile.acct.tokenSaved')}</Text>
          <Text style={styles.faint}>{tr('mobile.acct.memberNote')}</Text>

          <Pressable style={styles.ghostButton} onPress={doSignOut} disabled={busy}>
            <Text style={styles.ghostButtonText}>{busy ? tr('mobile.acct.signingOut') : tr('mobile.acct.signOut')}</Text>
          </Pressable>
        </View>
      ) : device ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{tr('mobile.acct.confirmInBrowser')}</Text>
          <Text style={styles.muted}>{tr('mobile.acct.deviceCodeHint')}</Text>
          <Text style={styles.code}>{device.user_code}</Text>
          <Text style={styles.faint}>{tr('mobile.acct.openConfirmHint')}</Text>
          <Text style={styles.link} onPress={() => void Linking.openURL(device.verification_uri_complete)}>
            {VERIFICATION_URI}
          </Text>
          <View style={styles.pendingRow}>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.muted}>{tr('mobile.acct.waiting')}{secondsLeft > 0 ? ' ' + tf('mobile.acct.secondsLeft', { n: secondsLeft }) : ''}</Text>
          </View>
          <Pressable style={styles.ghostButton} onPress={cancel}>
            <Text style={styles.ghostButtonText}>{tr('common.cancel')}</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{tr('acct.login')}</Text>
          <Text style={styles.muted}>{tr('mobile.acct.loginDesc')}</Text>
          <View style={styles.bullets}>
            <Text style={styles.bullet}>{tr('mobile.acct.bullet1')}</Text>
            <Text style={styles.bullet}>{tr('mobile.acct.bullet2')}</Text>
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable style={styles.primaryButton} onPress={startLogin} disabled={busy}>
            <Text style={styles.primaryButtonText}>{busy ? tr('mobile.acct.waitingBrowser') : tr('mobile.acct.startAuth')}</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 26, fontWeight: '700', color: colors.fg },
  subtitle: { marginTop: 6, fontSize: 13, color: colors.fainter, lineHeight: 20 },
  card: {
    marginTop: 18, padding: 18, borderRadius: 16,
    backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.divider,
  },
  cardTitle: { fontSize: 16, fontWeight: '600', color: colors.fg, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  avatar: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  username: { fontSize: 16, fontWeight: '600', color: colors.fg },
  badge: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.accent,
  },
  badgeText: { fontSize: 11, color: colors.accent },
  muted: { fontSize: 13, color: colors.muted, lineHeight: 20 },
  faint: { marginTop: 6, fontSize: 12, color: colors.fainter, lineHeight: 18 },
  code: {
    marginVertical: 14, fontSize: 30, fontWeight: '700', letterSpacing: 6,
    color: colors.fg, textAlign: 'center',
  },
  link: { marginTop: 4, fontSize: 12, color: colors.accent },
  pendingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 },
  bullets: { marginTop: 14, gap: 6 },
  bullet: { fontSize: 12.5, color: colors.muted, lineHeight: 19 },
  error: { marginTop: 12, fontSize: 13, color: colors.accent },
  primaryButton: {
    marginTop: 18, height: 46, borderRadius: 23, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  ghostButton: {
    marginTop: 16, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.divider,
  },
  ghostButtonText: { color: colors.muted, fontSize: 14 },
})
