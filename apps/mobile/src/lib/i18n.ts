/**
 * 移动端多语言适配层。
 *
 * 字典与查词逻辑来自 @lxmn/core，这里只负责：
 *   1. 把当前语言持久化到 AsyncStorage；
 *   2. 语言变化时通知 React 组件重渲染；
 *   3. 暴露与桌面端同形状的 t / tf，页面不用关心平台差异。
 *
 * 不引入 vue-i18n / i18next 运行时依赖；四种语言与桌面设置页一致。
 */
import { useEffect, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { translate, translateFormat, type Locale } from '@lxmn/core'

export const MOBILE_LOCALES: { id: Locale; label: string; native: string }[] = [
  { id: 'zh-CN', label: '简体中文', native: '简体中文' },
  { id: 'zh-TW', label: '繁體中文', native: '繁體中文' },
  { id: 'en-US', label: 'English', native: 'English' },
  { id: 'ko-KR', label: '한국어', native: '한국어' },
]

export const LOCALE_STORAGE_KEY = 'lxmn.mobile.locale'

let current: Locale = 'zh-CN'
const listeners = new Set<() => void>()

export type { Locale }

export function isLocale(value: string | null | undefined): value is Locale {
  return typeof value === 'string' && MOBILE_LOCALES.some(l => l.id === value)
}

export function getLocale(): Locale {
  return current
}

export function subscribeLocale(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

function emit(): void {
  for (const fn of [...listeners]) fn()
}

/** 启动时调用一次：读回上次选择的语言，坏数据/无效值都当简体中文。 */
export async function restoreLocale(): Promise<Locale> {
  try {
    const raw = await AsyncStorage.getItem(LOCALE_STORAGE_KEY)
    if (isLocale(raw) && raw !== current) {
      current = raw
      emit()
    }
  } catch {
    // 存储坏了不能挡住 App 启动
  }
  return current
}

/** 切换语言：先更新内存并通知 UI，再异步落盘，存储失败也不回滚界面。 */
export async function setLocale(next: Locale): Promise<void> {
  if (!isLocale(next)) return
  current = next
  emit()
  try {
    await AsyncStorage.setItem(LOCALE_STORAGE_KEY, next)
  } catch {
    // 持久化失败只影响下次启动，不影响本次使用
  }
}

export function t(key: string, fallback?: string, loc?: Locale): string {
  return translate(key, loc ?? getLocale(), fallback)
}

export function tf(key: string, params?: Record<string, string | number>, fallback?: string): string {
  return translateFormat(key, getLocale(), params, fallback)
}

/** 在组件里订阅语言；返回值可直接用于高亮当前选项。 */
export function useLocale(): Locale {
  const [loc, setLoc] = useState<Locale>(getLocale())
  useEffect(() => subscribeLocale(() => setLoc(getLocale())), [])
  return loc
}
