import { describe, it, beforeAll } from 'vitest'
import { setPlatform, installKwSource, getSource } from '@lxmn/core'
import { desktopPlatform } from '@lxmn/platform-desktop'

const live = process.env.LIVE === '1'

describe.skipIf(!live)('酷我取流是否串歌', () => {
  beforeAll(() => { setPlatform(desktopPlatform); installKwSource() })

  it('不同歌曲必须拿到不同 url', async () => {
    const kw = getSource('kw')
    const urls: Record<string, string> = {}
    for (const kwd of ['倔强 五月天', '演员 薛之谦', '十年 陈奕迅']) {
      const r = await kw.musicSearch(kwd, 1, 3)
      const s = r.list[0]!
      const info = await kw.getMusicUrl(s, '320k')
      urls[kwd] = info.url
      console.log('  ' + kwd + ' | id=' + s.id + ' | ' + s.name + '-' + s.singer)
      console.log('    url: ' + info.url.slice(0, 70) + ' | size=' + info.size + ' | type=' + info.type)
    }
    const vals = Object.values(urls)
    console.log('  去重后数量:', new Set(vals).size, '/', vals.length)
  }, 180000)
})
