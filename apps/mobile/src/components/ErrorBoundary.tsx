/**
 * 渲染期错误边界。
 *
 * 没有它时：某个页面渲染抛错 -> 整棵树卸载 -> release 包里直接退出。
 * 有它时：显示一张可截图的错误卡片，并把最近的操作错误一并列出。
 */
import React from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { errorRecords, recordError } from '../lib/safe'
import { colors } from '../theme'

interface Props { children: React.ReactNode }
interface State { error: Error | null; showDetail: boolean }

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, showDetail: false }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    const where = info.componentStack ? info.componentStack.split('\n')[1]?.trim() ?? 'unknown' : 'unknown'
    recordError('渲染 ' + where, error)
  }

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children
    const recs = errorRecords()
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: 80, paddingHorizontal: 24 }}>
        <Text style={{ color: colors.accent, fontSize: 18, fontWeight: '700' }}>界面出错了</Text>
        <Text style={{ color: colors.fg, fontSize: 14, marginTop: 10 }}>
          {this.state.error.message || String(this.state.error)}
        </Text>
        <Pressable
          onPress={() => { this.setState({ error: null }) }}
          style={{ marginTop: 20, alignSelf: 'flex-start', backgroundColor: colors.accent, borderRadius: 18, paddingHorizontal: 18, paddingVertical: 9 }}
        >
          <Text style={{ color: '#fff', fontSize: 14 }}>返回继续用</Text>
        </Pressable>
        <Pressable
          onPress={() => this.setState({ showDetail: !this.state.showDetail })}
          style={{ marginTop: 14 }}
        >
          <Text style={{ color: colors.muted, fontSize: 13 }}>
            {this.state.showDetail ? '收起诊断信息' : '查看诊断信息（截图发给开发者）'}
          </Text>
        </Pressable>
        {this.state.showDetail ? (
          <ScrollView style={{ marginTop: 10, maxHeight: 320 }}>
            {recs.length === 0 ? <Text style={{ color: colors.fainter, fontSize: 12 }}>暂无记录</Text> : null}
            {recs.map((r, i) => (
              <Text key={i} style={{ color: colors.fainter, fontSize: 11, marginBottom: 8 }}>
                {new Date(r.at).toLocaleTimeString()} [{r.label}] {r.message}
              </Text>
            ))}
          </ScrollView>
        ) : null}
      </View>
    )
  }
}
