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
import { ACCENT_PRESETS, colors, getAccent, setAccent, topInset } from '../theme'

export default function AccountScreen() {
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
      setError(e instanceof Error ? e.message : '授权失败')
      setDevice(null)
    } finally {
      if (alive.current) setBusy(false)
    }
  }, [])

  const cancel = useCallback(() => {
    cancelPolling()
    setDevice(null)
    setBusy(false)
    setError('已取消授权')
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
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title}>我的账户</Text>
      <Text style={styles.subtitle}>使用 lain42.top 账号登录，同步识别真实购买权益。</Text>

      {me ? (
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{initial}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.username}>{me.username}</Text>
              <Text style={styles.faint}>账户 ID：{me.account_id}</Text>
            </View>
            {me.founder ? (
              <View style={styles.badge}><Text style={styles.badgeText}>创始人</Text></View>
            ) : null}
          </View>

          <Text style={styles.muted}>当前权益：{me.entitlements.length} 项</Text>
          <Text style={styles.faint}>授权凭证保存在本机，下次打开自动验证。</Text>
          <Text style={styles.faint}>
            网站账号不等于音源订阅；已购买音乐会员可在「会员」页激活订阅。
          </Text>

          <Pressable style={styles.ghostButton} onPress={doSignOut} disabled={busy}>
            <Text style={styles.ghostButtonText}>{busy ? '正在退出…' : '退出登录'}</Text>
          </Pressable>
        </View>
      ) : device ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>在浏览器里确认</Text>
          <Text style={styles.muted}>把这串设备码填到 lain42.top 的确认页：</Text>
          <Text style={styles.code}>{device.user_code}</Text>
          <Text style={styles.faint}>
            已尝试为你打开确认页；没打开的话，手动访问：
          </Text>
          <Text style={styles.link} onPress={() => void Linking.openURL(device.verification_uri_complete)}>
            {VERIFICATION_URI}
          </Text>
          <View style={styles.pendingRow}>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.muted}>等待确认… {secondsLeft > 0 ? secondsLeft + ' 秒后过期' : ''}</Text>
          </View>
          <Pressable style={styles.ghostButton} onPress={cancel}>
            <Text style={styles.ghostButtonText}>取消</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>用 lain42.top 账号登录</Text>
          <Text style={styles.muted}>
            点击下方按钮会打开浏览器，登录并确认后自动回到这里。
          </Text>
          <View style={styles.bullets}>
            <Text style={styles.bullet}>· 密码只输入在 lain42.top 的页面上，本应用不会接触你的密码</Text>
            <Text style={styles.bullet}>· 应用拿到的是有期限、可随时撤销的授权凭证</Text>
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable style={styles.primaryButton} onPress={startLogin} disabled={busy}>
            <Text style={styles.primaryButtonText}>{busy ? '等待浏览器确认…' : '开始授权'}</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingTop: topInset + 12, paddingBottom: 40 },
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
