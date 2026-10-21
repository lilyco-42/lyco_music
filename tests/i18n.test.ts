/**
 * 多语言（7.4）用例。
 *
 * 重点不是「翻得对不对」（那要靠人看），而是三件机械的事：
 *   1. 各语言的 key 集合完整 —— 漏一条界面上就会冒出中文或 key；
 *   2. 繁体是从简体转换来的，转换表得真的生效；
 *   3. 查不到时按 fallback → key 的顺序退化，不能返回空白。
 */
import { describe, expect, it } from 'vitest'
import { TRANSLATION_KEYS, t } from '../apps/desktop/src/lib/i18n'

describe('i18n', () => {
  it('每种语言的 key 集合都完整', () => {
    const missing: string[] = []
    for (const loc of ['zh-TW', 'en-US', 'ko-KR'] as const) {
      for (const key of TRANSLATION_KEYS) {
        if (!t(key, undefined, loc)) missing.push(`${loc}:${key}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('简体取简体', () => {
    expect(t('nav.settings', undefined, 'zh-CN')).toBe('设置')
    expect(t('nav.trial', undefined, 'zh-CN')).toBe('试听列表')
  })

  it('繁体由简体转换而来', () => {
    // 逐字转换：设置 → 設置（台湾习惯写「設定」，但这是用词差异，
    // 字符转换表不处理 —— 与「歌词转繁体」同一套表，行为保持一致）
    expect(t('nav.settings', undefined, 'zh-TW')).toBe('設置')
    expect(t('nav.trial', undefined, 'zh-TW')).toBe('試聽列表')
    expect(t('sidebar.group.mine', undefined, 'zh-TW')).toBe('我的音樂')
  })

  it('英文 / 韩文是手写字典', () => {
    expect(t('nav.settings', undefined, 'en-US')).toBe('Settings')
    expect(t('nav.trial', undefined, 'en-US')).toBe('Play Queue')
    expect(t('nav.settings', undefined, 'ko-KR')).toBe('설정')
  })

  it('未知 key 回退到 fallback，再回退到 key 本身', () => {
    expect(t('nope.key', '现成的中文')).toBe('现成的中文')
    expect(t('nope.key')).toBe('nope.key')
  })

  it('所有语言都不返回空串', () => {
    for (const loc of ['zh-CN', 'zh-TW', 'en-US', 'ko-KR'] as const) {
      for (const key of TRANSLATION_KEYS) {
        expect(t(key, undefined, loc).length).toBeGreaterThan(0)
      }
    }
  })

  it('翻译里没有残留的 key 写法', () => {
    for (const key of TRANSLATION_KEYS) {
      expect(t(key, undefined, 'en-US')).not.toMatch(/^[a-z]+\.[a-z]/i)
    }
  })
})
