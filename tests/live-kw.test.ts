import { describe, it, expect, beforeAll } from 'vitest'
import { setPlatform, installWySource, installKwSource, getSource } from '@lxmn/core'
import { desktopPlatform } from '@lxmn/platform-desktop'

const live = process.env.LIVE === '1'

describe.skipIf(!live)('kw against the real Kuwo API', () => {
  beforeAll(() => { setPlatform(desktopPlatform); installWySource(); installKwSource() })

  it('searches, resolves a play url, and fetches lyric + pic', async () => {
    const r = await getSource('kw').musicSearch!('起风了', 1, 10)
    expect(r.total).toBeGreaterThan(0)
    console.log('  kw total:', r.total, 'returned:', r.list.length)
    const s = r.list[0]!
    console.log('  first:', s.name, '|', s.singer, '|', s.albumName, '|', s.interval, '| q=', JSON.stringify(s.qualitys))
    expect(s.songmid).toBeTruthy()

    let ok = 0
    for (const item of r.list.slice(0, 5)) {
      try {
        const u = await getSource('kw').getMusicUrl(item, '320k')
        if (u.url) { console.log('  playable:', item.name, '->', u.url.slice(0, 60) + '...'); ok++ }
      } catch (e) { console.log('  fail:', item.name, '->', (e as Error).message) }
    }
    console.log('  playable:', ok, '/ 5')
    expect(ok).toBeGreaterThan(0)

    // 歌词：酷我并非每首都收录（实测同一关键词下有的 rid 返回空 data），
    // 所以遍历搜索结果，只要有一首能拿到带时间轴的歌词即视为通过。
    let withLyric = 0
    for (const item of r.list) {
      try {
        const l = await getSource('kw').getLyric(item)
        if (/\[\d{2}:\d{2}/.test(l.lyric)) {
          console.log('  lyric ok:', item.name, '->', l.lyric.length, 'bytes')
          withLyric++
        }
      } catch { /* 该曲目无歌词，属正常 */ }
    }
    console.log('  songs with lyric:', withLyric, '/', r.list.length)
    expect(withLyric).toBeGreaterThan(0)

    const p = await getSource('kw').getPic(s)
    console.log('  pic:', p.url)
    // 端点原本给的是 http://img1.kwcdn.kuwo.cn/...，Android 9+ 禁明文，
    // 且该主机走 https 会 514，所以必须已重建到 img1.kuwo.cn 且为 https
    expect(p.url).toMatch(/^https:\/\/img1\.kuwo\.cn\/star\/albumcover\//)

    // 搜索结果的 picUrl 必须与 getPic 一致（同一张图的两种取法）
    expect(s.picUrl).toBeTruthy()
    expect(s.picUrl).toMatch(/^https:\/\/img1\.kuwo\.cn\/star\/albumcover\/500\//)
    expect(s.picUrl).toBe(p.url)

    // 封面能真的下载成图片，而不只是一个像 URL 的字符串
    const img = await desktopPlatform.http.request({ url: s.picUrl!, method: 'GET' })
    console.log('  pic bytes:', img.statusCode, img.raw.length)
    expect(img.statusCode).toBe(200)
    expect(img.raw[0]).toBe(0xff)
    expect(img.raw[1]).toBe(0xd8)
  }, 120000)
})
