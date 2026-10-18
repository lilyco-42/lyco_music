import { describe, it, beforeAll } from 'vitest'
import fs from 'node:fs'
import { setPlatform, installWySource, installKwSource, installKgSource, installMgSource, getSource } from '@lxmn/core'
import { desktopPlatform } from '@lxmn/platform-desktop'

const live = process.env.LIVE === '1'

describe.skipIf(!live)('采集各平台歌曲 ID', () => {
  beforeAll(() => {
    setPlatform(desktopPlatform)
    installWySource(); installKwSource(); installKgSource(); installMgSource()
  })

  it('采集', async () => {
    const out: Record<string, unknown> = {}
    for (const sid of ['kw', 'kg', 'wy', 'mg'] as const) {
      try {
        const r = await getSource(sid).musicSearch!('十年 陈奕迅', 1, 3)
        const s = r.list[0]
        if (!s) { console.log(sid, '搜不到'); continue }
        out[sid] = {
          songmid: s.songmid, hash: s.hash, name: s.name, singer: s.singer,
          albumName: s.albumName, interval: s.interval, copyrightId: s.copyrightId,
          _raw: s,
        }
        console.log(sid, JSON.stringify({ songmid: s.songmid, hash: s.hash, name: s.name, singer: s.singer }))
      } catch (e) {
        console.log(sid, 'FAIL', (e as Error).message.slice(0, 60))
      }
    }
    fs.writeFileSync('D:/demo/.oauth-dev/songs.json', JSON.stringify(out, null, 2))
  }, 180000)
})
