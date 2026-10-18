import { describe, it, beforeAll } from 'vitest'
import { setPlatform, installKgSource, installMgSource, installWySource, getSource } from '@lxmn/core'
import { desktopPlatform } from '@lxmn/platform-desktop'

const live = process.env.LIVE === '1'

describe.skipIf(!live)('各音源取流是否真的对得上歌', () => {
  beforeAll(() => { setPlatform(desktopPlatform); installKgSource(); installMgSource(); installWySource() })

  for (const sid of ['kg', 'mg'] as const) {
    it(sid + ' 不同歌拿到不同 url', async () => {
      const src = getSource(sid)
      const urls: string[] = []
      for (const kw of ['十年 陈奕迅', '江南 林俊杰', '倔强 五月天']) {
        try {
          const r = await src.musicSearch!(kw, 1, 3)
          if (!r.list.length) { console.log('  ' + sid + ' ' + kw + ' -> 搜不到'); continue }
          const s = r.list[0]!
          const info = await src.getMusicUrl(s, '320k')
          urls.push(info.url)
          console.log('  ' + sid + ' ' + kw + ' -> ' + s.name + '-' + s.singer + ' | ' + info.url.slice(0, 55))
        } catch (e) {
          console.log('  ' + sid + ' ' + kw + ' -> 失败 ' + (e instanceof Error ? e.message : '').slice(0, 60))
        }
      }
      console.log('  ' + sid + ' 去重:', new Set(urls).size, '/', urls.length)
    }, 180000)
  }
})
