import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const src = readFileSync(resolve(root, 'apps/desktop/src/views/Player.vue'), 'utf8')

// 播放器模式是独立全屏页，没有 PlayBar；这里没有 DOM 测试环境，
// 用源码断言守住「按钮有处理器」这条回归线，配合真机 CDP 冒烟。
describe('播放器模式底栏控件', () => {
  it('三个以前点了没反应的按钮都接上了动作', () => {
    expect(src).toMatch(/label="播放列表"[^>]*@click="togglePanel\('queue'\)"/)
    expect(src).toMatch(/aria-label="更多"[^>]*@click="togglePanel\('more'\)"/)
    expect(src).toMatch(/aria-label="桌面歌词"[^>]*@click="toggleLyric"/)
  })

  it('没有播放歌曲时更多菜单仍可展开且有可用动作', () => {
    expect(src).toMatch(/if \(!t\) \{\s*return \[\s*lyricItem/)
    expect(src).toMatch(/v-if="openPanel === 'more'"/)
    expect(src).not.toMatch(/v-if="openPanel === 'more' && moreItems.length"/)
    const onMore = src.slice(src.indexOf('async function onMore'), src.indexOf('/* ---- 歌曲换源 ---- */'))
    expect(onMore.indexOf("key === 'queue'")).toBeLessThan(onMore.indexOf('const t = current.value'))
  })

  it('纯音乐页面里字号和播放模式切换也有明确反馈', () => {
    expect(src).toMatch(/toast\('歌词字号 '/)
    expect(src).toMatch(/toast\('播放模式：' \+ player\.modeLabel\(\)\)/)
  })
})
