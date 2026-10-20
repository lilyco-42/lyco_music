import { describe, it } from 'vitest'
import { installWySource, installKwSource, installMgSource, installKgSource, getSource } from '../packages/core/src/index'
import { desktopPlatform } from '../packages/platform-desktop/src/index'
import { setPlatform } from '../packages/core/src/registry'

describe('audio probe', () => {
  it('dump play urls', async () => {
    setPlatform(desktopPlatform)
    installWySource(); installKwSource(); installMgSource(); installKgSource()
    for (const id of ['wy','kw','kg','mg'] as const) {
      try {
        const r = await getSource(id).musicSearch!('周杰伦 晴天', 1, 3)
        const it = r.list[0]
        if (!it) { console.log('URL', id, 'NO RESULT'); continue }
        const info = await getSource(id).getMusicUrl(it, '320k')
        console.log('URL', id, it.name, '|', info.quality, '|', info.url)
      } catch (e) {
        console.log('URL', id, 'FAIL', (e as Error).message.slice(0, 100))
      }
    }
  }, 90000)
})
