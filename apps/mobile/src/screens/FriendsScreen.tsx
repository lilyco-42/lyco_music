/**
 * 好友页（移动端）
 *
 * 身份即订阅：未开通会员时引导去会员页；开通后用好友码加好友。
 */
import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator, Image, Pressable, ScrollView, Text, TextInput, View,
} from 'react-native'
import { useFriendsApi, type FriendsState } from '../friends'
import { pullFeed, type FeedItem } from '../share'
import { colors, useTopInset } from '../theme'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const AVATAR = require('../assets/art/avatar-default.jpg') as number

function fmtTime(t: number): string {
  if (!t) return '—'
  const d = new Date(t * 1000)
  return (d.getMonth() + 1) + '/' + d.getDate() + ' ' +
    String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}

export default function FriendsScreen({ onNeedMembership, onOpenMy }: { onNeedMembership?: () => void; onOpenMy?: () => void }) {
  const insetTop = useTopInset()
  const api = useFriendsApi()
  const [state, setState] = useState<FriendsState>({
    me: null, friends: [], pendingIn: [], pendingOut: [],
  })
  const [feed, setFeed] = useState<FeedItem[]>([])
  const [code, setCode] = useState('')
  const [loaded, setLoaded] = useState(false)

  const pull = useCallback(async () => {
    const r = await api.refresh()
    if (r) {
      setState({ me: r.mine, friends: r.list.friends, pendingIn: r.list.pendingIn, pendingOut: r.list.pendingOut })
      setLoaded(true)
    }
    const f = await pullFeed()
    if (f) setFeed(f.items)
  }, [])

  useEffect(() => { void pull() }, [])

  const submit = async () => {
    if (!code.trim()) return
    const ok = await api.addByCode(code)
    if (ok !== null) {
      setCode('')
      void pull()
    }
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insetTop }}
      contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
    >
      <Text style={{ color: colors.fg, fontSize: 24, fontWeight: '700' }}>好友</Text>

      {/* 未开通会员 */}
      {loaded && !state.me ? (
        <View style={{ marginTop: 40, alignItems: 'center' }}>
          <Image source={AVATAR} style={{ width: 110, height: 110, borderRadius: 55, opacity: 0.9 }} />
          <Text style={{ marginTop: 16, color: colors.fg, fontSize: 16 }}>好友功能需要音乐会员</Text>
          <Text style={{ marginTop: 6, color: colors.muted, fontSize: 13, textAlign: 'center' }}>
            开通后用好友码加好友{'\n'}看在线状态
          </Text>
          <Pressable
            onPress={onNeedMembership}
            style={{ marginTop: 18, backgroundColor: colors.accent, borderRadius: 999, paddingHorizontal: 26, paddingVertical: 11 }}
          >
            <Text style={{ color: '#fff', fontSize: 14 }}>去开通</Text>
          </Pressable>
        </View>
      ) : null}

      {api.error ? (
        <Text style={{ marginTop: 10, color: colors.accent, fontSize: 13 }}>{api.error}</Text>
      ) : null}

      {state.me ? (
        <>
          {/* 我的身份卡 */}
          <View style={{
            marginTop: 14, backgroundColor: colors.surface, borderRadius: 12, padding: 16,
            flexDirection: 'row', alignItems: 'center', gap: 12,
          }}>
            <Image source={AVATAR} style={{ width: 56, height: 56, borderRadius: 28 }} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.fg, fontSize: 16, fontWeight: '600' }} numberOfLines={1}>
                {state.me.nickname}
              </Text>
              <View style={{ marginTop: 4, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ color: colors.muted, fontSize: 12 }}>好友码</Text>
                <Text style={{ color: colors.fg, fontSize: 14, letterSpacing: 2, fontFamily: 'monospace' }}>
                  {state.me.friendCode}
                </Text>
              </View>
            </View>
          </View>

          {/* 加好友 */}
          <View style={{ marginTop: 14, backgroundColor: colors.surface, borderRadius: 12, padding: 16 }}>
            <Text style={{ color: colors.fg, fontSize: 15, fontWeight: '600' }}>添加好友</Text>
            <View style={{ marginTop: 10, flexDirection: 'row', gap: 8 }}>
              <TextInput
                value={code}
                onChangeText={(t) => setCode(t.toUpperCase())}
                maxLength={8}
                autoCapitalize="characters"
                placeholder="对方的好友码"
                placeholderTextColor={colors.fainter}
                style={{
                  flex: 1, borderWidth: 1, borderColor: colors.divider, borderRadius: 10,
                  paddingHorizontal: 12, paddingVertical: 10, color: colors.fg,
                  fontSize: 14, letterSpacing: 2, fontFamily: 'monospace',
                }}
              />
              <Pressable
                onPress={() => { void submit() }}
                disabled={api.busy || !code.trim()}
                style={{
                  backgroundColor: colors.accent, borderRadius: 999, paddingHorizontal: 18,
                  paddingVertical: 10, justifyContent: 'center', opacity: api.busy || !code.trim() ? 0.5 : 1,
                }}
              >
                <Text style={{ color: '#fff', fontSize: 13 }}>添加</Text>
              </Pressable>
            </View>
          </View>

          {/* 收到的请求 */}
          {state.pendingIn.length ? (
            <View style={{ marginTop: 16 }}>
              <Text style={{ color: colors.fg, fontSize: 15, fontWeight: '600' }}>
                收到的请求（{state.pendingIn.length}）
              </Text>
              {state.pendingIn.map((p) => (
                <View key={p.id} style={{
                  marginTop: 8, backgroundColor: colors.surface, borderRadius: 12, padding: 12,
                  flexDirection: 'row', alignItems: 'center', gap: 10,
                }}>
                  <Image source={AVATAR} style={{ width: 40, height: 40, borderRadius: 20 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.fg, fontSize: 14 }} numberOfLines={1}>{p.nickname}</Text>
                    <Text style={{ color: colors.muted, fontSize: 11 }}>
                      {p.friendCode} · {fmtTime(p.createdAt)}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => { void api.accept(p.id).then(() => pull()) }}
                    style={{ backgroundColor: colors.accent, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 }}
                  >
                    <Text style={{ color: '#fff', fontSize: 12 }}>接受</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => { void api.decline(p.id).then(() => pull()) }}
                    style={{ borderWidth: 1, borderColor: colors.divider, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 }}
                  >
                    <Text style={{ color: colors.muted, fontSize: 12 }}>拒绝</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}

          {/* 好友动态 */}
          {feed.length ? (
            <View style={{ marginTop: 16 }}>
              <Text style={{ color: colors.fg, fontSize: 15, fontWeight: '600' }}>好友动态</Text>
              {feed.map((item, i) => (
                <View key={i} style={{
                  marginTop: 8, backgroundColor: colors.surface, borderRadius: 12, padding: 12,
                  flexDirection: 'row', alignItems: 'center', gap: 10,
                }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.fg, fontSize: 13.5 }} numberOfLines={1}>
                      {item.nickname} 分享了「{item.payload.name}」
                    </Text>
                    <Text style={{ color: colors.muted, fontSize: 11 }}>{item.payload.count} 首</Text>
                  </View>
                  <Pressable
                    onPress={() => {
                      // 导入走「我的」页：把码暂存，MyMusicScreen 挂载时识别
                      // （RN 无 sessionStorage，用全局挂一个）
                      ;(globalThis as { __lycoImportShare?: string }).__lycoImportShare = item.payload.shareCode
                      onOpenMy?.()
                    }}
                    style={{ backgroundColor: colors.accent + '22', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}>
                    <Text style={{ color: colors.accent, fontSize: 12 }}>导入</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}

          {/* 好友列表 */}
          <View style={{ marginTop: 16 }}>
            <Text style={{ color: colors.fg, fontSize: 15, fontWeight: '600' }}>
              我的好友（{state.friends.length}）
            </Text>
            {!state.friends.length ? (
              <Text style={{ marginTop: 8, color: colors.muted, fontSize: 13 }}>
                还没有好友。把你的好友码发给朋友。
              </Text>
            ) : state.friends.map((f) => (
              <View key={f.friendCode} style={{
                marginTop: 8, backgroundColor: colors.surface, borderRadius: 12, padding: 12,
                flexDirection: 'row', alignItems: 'center', gap: 10,
              }}>
                <View>
                  <Image source={AVATAR} style={{ width: 40, height: 40, borderRadius: 20 }} />
                  <View style={{
                    position: 'absolute', right: -1, bottom: -1, width: 11, height: 11,
                    borderRadius: 6, backgroundColor: f.online ? '#22c55e' : colors.fainter,
                    borderWidth: 2, borderColor: colors.surface,
                  }} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.fg, fontSize: 14 }} numberOfLines={1}>{f.nickname}</Text>
                  <Text style={{ color: colors.muted, fontSize: 11 }}>
                    {f.online ? '在线' : '最近活跃 ' + fmtTime(f.lastActiveAt)}
                  </Text>
                </View>
                <Pressable
                  onPress={() => { void api.remove(f.friendCode).then(() => pull()) }}
                  style={{ borderWidth: 1, borderColor: colors.divider, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}
                >
                  <Text style={{ color: colors.muted, fontSize: 12 }}>删除</Text>
                </Pressable>
              </View>
            ))}
          </View>

          {api.busy ? (
            <ActivityIndicator style={{ marginTop: 18 }} color={colors.accent} />
          ) : null}
        </>
      ) : null}
    </ScrollView>
  )
}
