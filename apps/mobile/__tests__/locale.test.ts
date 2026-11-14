import AsyncStorage from '@react-native-async-storage/async-storage'
import { getLocale, isLocale, LOCALE_STORAGE_KEY, restoreLocale, setLocale, t, tf } from '../src/lib/i18n'

describe('mobile locale helper', () => {
  afterEach(async () => {
    await setLocale('zh-CN')
    jest.clearAllMocks()
  })

  it('默认简体中文，与既有中文断言一致', () => {
    expect(getLocale()).toBe('zh-CN')
    expect(t('my.title')).toBe('我的音乐')
    expect(t('mobile.my.neteaseImport')).toBe('网易云导入')
  })

  it('切换英文会落盘并立刻改变文案', async () => {
    await setLocale('en-US')
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(LOCALE_STORAGE_KEY, 'en-US')
    expect(t('my.title')).toBe('My Music')
    expect(t('mobile.my.neteaseImport')).toBe('NetEase Import')
    expect(tf('mobile.search.total', { n: 12 })).toBe('12 tracks')
  })

  it('启动时恢复合法语言', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce('ko-KR')
    expect(await restoreLocale()).toBe('ko-KR')
    expect(t('my.title')).toBe('내 음악')
  })

  it('拒绝非法存储值，坏数据不挡启动', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce('xx-YY')
    expect(await restoreLocale()).toBe('zh-CN')
    expect(isLocale('xx-YY')).toBe(false)
    expect(isLocale('zh-TW')).toBe(true)
  })
})
