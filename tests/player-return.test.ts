import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearReturnPath, peekReturnPath, rememberReturnPath, takeReturnPath,
} from '../apps/desktop/src/lib/player-return'

const root = fileURLToPath(new URL('..', import.meta.url))

describe('播放器模式来路', () => {
  beforeEach(() => clearReturnPath())

  it('保留完整搜索路径（含 query），去掉 hash 前缀', () => {
    expect(rememberReturnPath('#/search?q=%E5%91%A8%E6%9D%B0%E4%BC%A6')).toBe('/search?q=%E5%91%A8%E6%9D%B0%E4%BC%A6')
    expect(peekReturnPath()).toBe('/search?q=%E5%91%A8%E6%9D%B0%E4%BC%A6')
  })

  it('一次性消费，没记录时为空；外链被拒', () => {
    rememberReturnPath('/discover?tab=playlists')
    expect(takeReturnPath()).toBe('/discover?tab=playlists')
    expect(takeReturnPath()).toBe('')
    expect(rememberReturnPath('https://evil.example')).toBe('')
    expect(rememberReturnPath('')).toBe('')
  })

  it('进入播放器前记来路，收起时不再硬编码回首页', () => {
    const playBar = readFileSync(resolve(root, 'apps/desktop/src/components/layout/PlayBar.vue'), 'utf8')
    const player = readFileSync(resolve(root, 'apps/desktop/src/views/Player.vue'), 'utf8')
    expect(playBar).toMatch(/rememberReturnPath\(route\.fullPath\)/)
    expect(player).toMatch(/takeReturnPath\(\)/)
    expect(player).toMatch(/router\.replace\(back\)/)
    // 没有来路时仍允许兜底回首页，关键是「有来路优先原路返回」
    const close = player.match(/function close\(\): void \{[\s\S]{0,300}?\n\}/)?.[0] ?? ''
    expect(close).toContain('takeReturnPath()')
    expect(close).toContain('router.replace(back)')
  })
})
