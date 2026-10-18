import { describe, it, beforeAll } from 'vitest'
import { setPlatform, installWySource, getSource } from '@lxmn/core'
import { desktopPlatform } from '@lxmn/platform-desktop'

const live = process.env.LIVE === '1'

describe.skipIf(!live)('找 VIP 专享样本', () => {
  beforeAll(() => { setPlatform(desktopPlatform); installWySource() })

  it('探测哪些歌在网易取不到流', async () => {
    const wy = getSource('wy')
    const keywords = [
      '周杰伦 稻香', '周杰伦 七里香', '陈奕迅 十年', '林俊杰 江南',
      'Taylor Swift Love Story', '邓紫棋 光年之外', '五月天 倔强',
      '李荣浩 年少有为', '薛之谦 演员', '毛不易 消愁',
    ]
    for (const kw of keywords) {
      try {
        const r = await wy.musicSearch(kw, 1, 3)
        if (!r.list.length) { console.log('  ' + kw + ' -> 搜不到'); continue }
        const s = r.list[0]!
        try {
          const info = await wy.getMusicUrl(s, '320k')
          console.log('  ' + kw + ' -> 可播 | ' + s.name + ' - ' + s.singer)
        } catch (e) {
          console.log('  ' + kw + ' -> 失败 | ' + s.name + ' - ' + s.singer + ' | ' +
            (e instanceof Error ? e.message : String(e)).slice(0, 60))
        }
      } catch (e) {
        console.log('  ' + kw + ' -> 搜索异常 ' + (e instanceof Error ? e.message : ''))
      }
    }
  }, 300000)
})
