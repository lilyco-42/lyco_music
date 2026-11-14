/**
 * 桌面端多语言适配层。
 *
 * 字典与查词逻辑已抽到 @lxmn/core（packages/core/src/i18n.ts），桌面 / 移动端共用。
 * 这里只保留 Vue 响应式语言、宿主 prefs 与组件用的 useI18n()，
 * 并继续导出 t / tf / Locale / LOCALES / TRANSLATION_KEYS，
 * 既有页面与 tests/i18n.test.ts 的 import 不需要改。
 */
import { computed } from 'vue'
import {
  LOCALES,
  TRANSLATION_KEYS,
  translate,
  translateFormat,
  type Locale,
} from '@lxmn/core'
import { prefs } from './prefs'

export type { Locale }
export { LOCALES, TRANSLATION_KEYS }

/** 当前语言（响应式，改设置立刻换） */
export const locale = computed<Locale>(() => (prefs.locale as Locale) || 'zh-CN')

export function t(key: string, fallback?: string, loc?: Locale): string {
  return translate(key, loc ?? locale.value, fallback)
}

export function tf(key: string, params?: Record<string, string | number>, fallback?: string): string {
  return translateFormat(key, locale.value, params, fallback)
}

export function useI18n() {
  return { t, tf, locale, locales: LOCALES }
}
