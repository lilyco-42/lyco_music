/**
 * 会员页 —— 付费入口 + 订阅链接激活
 *
 * 购买流程：https://lain42.top/shop/ 用积分购买「音乐会员 · 年卡」（88 元/年）
 *          -> 我的账户复制订阅链接 -> 在此粘贴激活 -> 自动补全全部第三方音源
 */
import { useState } from 'react'
import {
  ActivityIndicator, Linking, Pressable, ScrollView, Text, TextInput, View,
} from 'react-native'
import { ANNUAL_PRICE_CNY, SHOP_URL } from '@lxmn/core'
import type { MembershipStatus, ApplyResult } from '@lxmn/core'
import { activate, status as fetchStatus, deactivate } from '../license'
import { connectWithMembership, disconnectSync } from '../sync'
import { colors, useTopInset } from '../theme'

const FEATURES = [
  '一键补全全部第三方音源',
  '桌面端 / 移动端同一账号通用',
  '会员期内自动续期提醒',
  '音源失效后自动更新订阅',
]

function fmtDate(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return iso
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function MembershipScreen() {
  const insetTop = useTopInset()
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<MembershipStatus | null>(null)
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null)
  const [error, setError] = useState('')

  async function onActivate() {
    if (!link.trim()) {
      setError('请先粘贴订阅链接或令牌')
      return
    }
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const { status: st, applied } = await activate(link.trim())
      setResult(st)
      setApplyResult(applied)
      // 会员身份即同步身份：激活的同时把云同步一起开通，
      // 不额外要求用户去注册账号或再填一次令牌。
      // 放在这里而不是 license.ts，是因为移动端 tsconfig 不支持动态 import，
      // 而 license → sync 的静态 import 会与 sync → license 成环。
      if (st.state === 'active') {
        await connectWithMembership().catch(() => undefined)
      }
      if (st.state === 'expired') setError('会员已过期，请续费后重新获取订阅链接')
      if (st.state === 'invalid') setError(st.reason)
      if (st.state === 'active') setLink('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function onCheck() {
    setBusy(true)
    setError('')
    try {
      setResult(await fetchStatus())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function onDeactivate() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await deactivate()
      await disconnectSync().catch(() => undefined)
      setResult({ state: 'none' })
      setApplyResult(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function onOpenShop() {
    try {
      await Linking.openURL(SHOP_URL)
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
      console.warn('[Lyco Music] Failed to open shop', e)
      setError(`浏览器打开失败（${reason}），请手动访问 ${SHOP_URL}`)
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insetTop }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 32 }}>
        <Text style={{ color: colors.fg, fontSize: 24, fontWeight: '700', marginBottom: 6 }}>音乐会员</Text>
        <Text style={{ color: colors.muted, fontSize: 13, marginBottom: 22 }}>
          购买后获得订阅链接，填入下方即可解锁全部音源
        </Text>

        {/* 价格卡 */}
        <View
          style={{
            backgroundColor: colors.surface,
            borderRadius: 16,
            padding: 22,
            borderWidth: 1,
            borderColor: '#2f2f2f',
            marginBottom: 20,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
            <Text style={{ color: colors.accent, fontSize: 42, fontWeight: '800', lineHeight: 46 }}>
              ¥{ANNUAL_PRICE_CNY}
            </Text>
            <Text style={{ color: colors.muted, fontSize: 15, marginLeft: 8, marginBottom: 6 }}>/ 年</Text>
          </View>
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
            {ANNUAL_PRICE_CNY * 10} 积分（10 积分 = 1 元）
          </Text>
          <Text style={{ color: colors.fg, fontSize: 15, fontWeight: '600', marginTop: 10 }}>音乐会员 · 年卡</Text>

          <View style={{ marginTop: 16, gap: 10 }}>
            {FEATURES.map(f => (
              <View key={f} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent }} />
                <Text style={{ color: colors.muted, fontSize: 13.5, flex: 1 }}>{f}</Text>
              </View>
            ))}
          </View>

          <Pressable
            onPress={() => { void onOpenShop() }}
            style={{
              marginTop: 22,
              backgroundColor: colors.accent,
              borderRadius: 24,
              paddingVertical: 14,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>去商城购买</Text>
          </Pressable>
          <Text style={{ color: colors.fainter, fontSize: 11, marginTop: 10, textAlign: 'center' }}>
            {SHOP_URL}
          </Text>
        </View>

        {/* 激活区 */}
        <Text style={{ color: colors.fg, fontSize: 16, fontWeight: '600', marginBottom: 10 }}>激活订阅</Text>
        <TextInput
          value={link}
          onChangeText={setLink}
          placeholder="粘贴订阅链接或令牌"
          placeholderTextColor={colors.fainter}
          autoCapitalize="none"
          autoCorrect={false}
          style={{
            backgroundColor: colors.surface,
            borderRadius: 12,
            paddingHorizontal: 14,
            paddingVertical: 13,
            color: colors.fg,
            fontSize: 14,
            borderWidth: 1,
            borderColor: '#2f2f2f',
          }}
        />

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
          <Pressable
            onPress={onActivate}
            disabled={busy}
            style={{
              flex: 1,
              backgroundColor: busy ? '#7a2630' : colors.accent,
              borderRadius: 22,
              paddingVertical: 13,
              alignItems: 'center',
            }}
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600' }}>激活</Text>}
          </Pressable>
          <Pressable
            onPress={onCheck}
            disabled={busy}
            style={{
              paddingHorizontal: 22,
              borderRadius: 22,
              paddingVertical: 13,
              alignItems: 'center',
              borderWidth: 1,
              borderColor: '#3a3a3a',
            }}
          >
            <Text style={{ color: colors.fg, fontSize: 15 }}>查询</Text>
          </Pressable>
        </View>

        {error ? (
          <Text style={{ color: colors.accent, fontSize: 13, marginTop: 12 }}>{error}</Text>
        ) : null}

        {/* 状态 */}
        {result ? (
          <View style={{ marginTop: 20, backgroundColor: colors.surface, borderRadius: 14, padding: 18, borderWidth: 1, borderColor: '#2f2f2f' }}>
            {result.state === 'active' ? (
              <>
                <Text style={{ color: '#4ec97a', fontSize: 15, fontWeight: '700' }}>会员有效</Text>
                <Text style={{ color: colors.fg, fontSize: 14, marginTop: 8 }}>{result.plan.name}</Text>
                <Text style={{ color: colors.muted, fontSize: 13, marginTop: 4 }}>
                  到期时间：{fmtDate(result.plan.expiresAt)}
                </Text>
                <Text style={{ color: colors.muted, fontSize: 13, marginTop: 10, marginBottom: 4 }}>
                  订阅包含的音源（{result.sources.length}）
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {result.sources.map(s => (
                    <View key={s.id} style={{ backgroundColor: colors.elevated, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
                      <Text style={{ color: colors.fg, fontSize: 12 }}>{s.name || s.id}</Text>
                    </View>
                  ))}
                </View>
                {/* 订阅清单是「产品计划」，客户端未必都已实现。
                    不把未实现的算作已解锁，避免用户以为能听却搜不到歌。 */}
                {applyResult && applyResult.applied.length ? (
                  <Text style={{ color: colors.fainter, fontSize: 12, marginTop: 10 }}>
                    本次已应用：{applyResult.applied.join('、')}
                  </Text>
                ) : null}
                {applyResult && applyResult.unavailable.length ? (
                  <Text style={{ color: '#c88a3a', fontSize: 12, marginTop: 6 }}>
                    暂未支持：{applyResult.unavailable.join('、')}（订阅包含，但当前版本尚未内置）
                  </Text>
                ) : null}
                <Pressable onPress={onDeactivate} disabled={busy} style={{ marginTop: 16 }}>
                  <Text style={{ color: colors.fainter, fontSize: 13 }}>退出会员</Text>
                </Pressable>
              </>
            ) : result.state === 'expired' ? (
              <>
                <Text style={{ color: colors.accent, fontSize: 15, fontWeight: '700' }}>会员已过期</Text>
                <Text style={{ color: colors.muted, fontSize: 13, marginTop: 6 }}>
                  {result.plan.name} · {fmtDate(result.plan.expiresAt)}
                </Text>
              </>
            ) : result.state === 'invalid' ? (
              <Text style={{ color: colors.accent, fontSize: 14 }}>{result.reason}</Text>
            ) : (
              <Text style={{ color: colors.muted, fontSize: 14 }}>尚未激活会员</Text>
            )}
          </View>
        ) : null}
      </ScrollView>
    </View>
  )
}
