import { describe, expect, it } from 'vitest'
import { dictFor, translate, translateFormat, TRANSLATION_KEYS, type Locale } from '../packages/core/src/i18n'

const LOCALES: Locale[] = ['zh-CN', 'zh-TW', 'en-US', 'ko-KR']
const MOBILE_KEYS = [
  'tab.home', 'tab.search', 'source.wy', 'mobile.home.find',
  'mobile.search.total', 'mobile.my.imported', 'mobile.my.selected',
  'mobile.my.tracks', 'mobile.acct.title', 'mobile.acct.subtitle',
  'settings.languageNote',
]

describe('shared i18n dictionary (core)', () => {
  it('桌面与移动端共用同一份字典：新 key 四语都非空', () => {
    for (const key of MOBILE_KEYS) {
      expect(TRANSLATION_KEYS).toContain(key)
      for (const loc of LOCALES) {
        const value = translate(key, loc)
        expect(value, key + ' / ' + loc).toBeTruthy()
        expect(value, key + ' / ' + loc).not.toBe(key)
      }
    }
  })

  it('繁体走逐字转换，简体与英/韩各有独立词条', () => {
    expect(translate('nav.settings', 'zh-TW')).toBe('設置')
    expect(translate('my.title', 'zh-CN')).toBe('我的音乐')
    expect(translate('my.title', 'en-US')).toBe('My Music')
    expect(translate('my.title', 'ko-KR')).toBe('내 음악')
    expect(translate('mobile.my.tabFav', 'zh-TW')).toContain('喜歡')
  })

  it('查不到的 key 回退到 fallback 或 key 本身', () => {
    expect(translate('no.such.key', 'en-US', 'Fallback')).toBe('Fallback')
    expect(translate('no.such.key', 'en-US')).toBe('no.such.key')
    expect(translate('mobile.search.total', 'xx-YY' as Locale)).toBe('共 {n} 首')
  })

  it('插值在多语言下都生效', () => {
    expect(translateFormat('mobile.search.total', 'en-US', { n: 7 })).toBe('7 tracks')
    expect(translateFormat('mobile.search.total', 'ko-KR', { n: 3 })).toBe('총 3곡')
    expect(translateFormat('mobile.my.imported', 'zh-CN', { name: '测试歌单', added: 2, total: 3 }))
      .toBe('已导入「测试歌单」共 2 首（歌单 3 首）')
  })

  it('dictFor 对三种显式语言都返回完整字典', () => {
    for (const loc of ['zh-CN', 'en-US', 'ko-KR'] as Locale[]) {
      const dict = dictFor(loc)
      for (const key of MOBILE_KEYS) expect(dict[key], loc + ' / ' + key).toBeTruthy()
    }
  })
})
