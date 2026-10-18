/**
 * 跨音源兜底 —— 真实网络集成测试（LIVE=1 才跑）
 *   LIVE=1 pnpm vitest run tests/fallback-live.test.ts
 *
 * 验证用户要的效果：网易标 VIP / 没版权的歌，客户端自己换音源放出来，
 * 且**不告诉用户换了**（静默）。
 */
import { describe, it, expect, beforeAll } from 'vitest'
import {
  setPlatform, installWySource, installKwSource, installKgSource, installMgSource, getSource,
} from '@lxmn/core'
import { desktopPlatform } from '@lxmn/platform-desktop'
import { resolveWithFallback, pickBestMatch } from '../apps/desktop/src/lib/fallback'

const live = process.env.LIVE === '1'

describe.skipIf(!live)('跨音源兜底（真实网络）', () => {
  beforeAll(() => {
    setPlatform(desktopPlatform)
    installWySource(); installKwSource(); installKgSource(); installMgSource()
  })

  it('pickBestMatch 拒绝翻唱、接受正主', () => {
    const want = { id: '1', name: '晴天', singer: '周杰伦', source: 'wy' as const }
    const candidates = [
      { id: '2', name: '晴天', singer: '周杰伦', source: 'kg' as const },
      { id: '3', name: '晴天 (翻唱版)', singer: '某网红', source: 'kw' as const },
      { id: '4', name: '晴天', singer: '别的歌手', source: 'mg' as const },
    ]
    expect(pickBestMatch(want, candidates)?.id).toBe('2')
  })

  // 这几首实测在网易都是 fee=1（VIP 专享），url 为 null
  for (const kw of ['十年 陈奕迅', '江南 林俊杰', '倔强 五月天', '演员 薛之谦']) {
    it(kw + ' 能串源播放', async () => {
      const wy = getSource('wy')
      const found = await wy.musicSearch(kw, 1, 3)
      expect(found.list.length).toBeGreaterThan(0)
      const song = found.list[0]!

      let wyError = ''
      try { await wy.getMusicUrl(song, '320k') } catch (e) {
        wyError = e instanceof Error ? e.message : String(e)
      }
      expect(wyError).toMatch(/VIP 专享|试听|无可播放/)

      const out = await resolveWithFallback(song, '320k')
      console.log('  ' + kw + ' -> 串源=' + out.switched + ' 音源=' + out.item.source +
        ' | ' + out.item.name + ' - ' + out.item.singer + ' | ' + out.info.url.slice(0, 50))
      expect(out.switched).toBe(true)
      expect(out.info.url).toMatch(/^https?:/)
      // 串到的必须是同一首歌，不能是翻唱
      expect(out.item.singer).toContain(song.singer.split(/[/、]/)[0]!.slice(0, 2))
    }, 180000)
  }
})
