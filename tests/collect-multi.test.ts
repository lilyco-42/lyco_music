import { describe, it, beforeAll } from 'vitest'
import fs from 'node:fs'
import { setPlatform, installWySource, installKwSource, installKgSource, installMgSource, getSource } from '@lxmn/core'
import { desktopPlatform } from '@lxmn/platform-desktop'

const live = process.env.LIVE === '1'

describe.skipIf(!live)('采集多样本歌曲 ID', () => {
  beforeAll(() => {
    setPlatform(desktopPlatform)
    installWySource(); installKwSource(); installKgSource(); installMgSource()
  })

  it('采集', async () => {
    const kws = ['十年 陈奕迅', '演员 薛之谦', '倔强 五月天', '江南 林俊杰', '晴天 周杰伦', '消愁 毛不易']
    const out: Record<string, unknown[]> = { kw: [], kg: [], wy: [], mg: [] }
    for (const sid of ['kw', 'kg', 'wy', 'mg'] as const) {
      for (const kw of kws) {
        try {
          const r = await getSource(sid).musicSearch!(kw, 1, 1)
          const s = r.list[0]
          if (!s) continue
          out[sid]!.push({
            songmid: s.songmid, hash: s.hash, name: s.name, singer: s.singer,
            interval: s.interval, copyrightId: (s as any).copyrightId,
          })
        } catch { /* ignore */ }
      }
    }
    fs.writeFileSync('D:/demo/.oauth-dev/songs-multi.json', JSON.stringify(out, null, 2))
    console.log('kw:', out.kw!.length, 'kg:', out.kg!.length, 'wy:', out.wy!.length, 'mg:', out.mg!.length)
  }, 300000)
})
