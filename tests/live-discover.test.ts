import { describe, it, expect, beforeAll } from 'vitest'
import { setPlatform, installWySource, searchWyPlaylists, fetchWyPlaylist, WY_BOARDS } from '@lxmn/core'
import { desktopPlatform } from '@lxmn/platform-desktop'

const live = process.env.LIVE === '1'

describe.skipIf(!live)('discover', () => {
  beforeAll(() => { setPlatform(desktopPlatform); installWySource() })

  it('搜歌单', async () => {
    const r = await searchWyPlaylists('周杰伦', 1, 6)
    console.log('total', r.total, r.list.map(x => `${x.name}(${x.trackCount})`).join(' | '))
    expect(r.list.length).toBeGreaterThan(0)
    expect(r.list[0].id).toMatch(/^\d+$/)
  })

  it('榜单详情', async () => {
    const b = WY_BOARDS[0]!
    const pl = await fetchWyPlaylist(b.id)
    console.log('board', b.name, pl.name, pl.tracks.length)
    expect(pl.tracks.length).toBeGreaterThan(10)
  })
})
