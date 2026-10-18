/**
 * 网易云评论映射（离线单测）。
 *
 * 真实接口返回结构复杂，这里只钉住两件事：
 *   1. hotComments 只在第 1 页拼在最前面，并打上 hot 标记；
 *   2. 字段映射（昵称/头像/点赞/楼层）不能丢，否则 UI 会显示「匿名」。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  setPlatform, installWySource, resetSources, getSource,
  type PlatformAdapter, type HttpRequestOptions, type HttpResponse,
} from '@lxmn/core'
import { desktopPlatform } from '@lxmn/platform-desktop'

const PAYLOAD = {
  code: 200,
  total: 1234,
  more: true,
  hotComments: [
    { commentId: 1, content: '热评一', likedCount: 5200, time: 1700000000000, user: { nickname: '甲', avatarUrl: 'http://a/1.jpg' } },
  ],
  comments: [
    { commentId: 2, content: '普通评论', likedCount: 12, time: 1700000100000, floor: 3, user: { nickname: '乙', avatarUrl: 'http://a/2.jpg' } },
    { commentId: 3, content: '无头像', likedCount: 0, time: 0, user: { nickname: '丙' } },
  ],
}

function fakePlatform(): PlatformAdapter {
  return {
    ...desktopPlatform,
    http: {
      async request(_o: HttpRequestOptions): Promise<HttpResponse> {
        return { statusCode: 200, headers: {}, body: JSON.stringify(PAYLOAD), raw: new Uint8Array() }
      },
    },
  }
}

beforeEach(() => {
  resetSources()
  setPlatform(fakePlatform())
  installWySource()
})

describe('wy getComments', () => {
  it('第 1 页把热评拼在最前面并标记 hot', async () => {
    const r = await getSource('wy').getComments!({ songmid: '1', name: 'x', singer: 'y', source: 'wy' } as never, 1, 20)
    expect(r.list[0]?.hot).toBe(true)
    expect(r.list[0]?.content).toBe('热评一')
    expect(r.list[1]?.content).toBe('普通评论')
    expect(r.total).toBe(1234)
    expect(r.more).toBe(true)
  })

  it('字段映射完整：昵称/头像/点赞/楼层', async () => {
    const r = await getSource('wy').getComments!({ songmid: '1', name: 'x', singer: 'y', source: 'wy' } as never, 1, 20)
    const c = r.list[1]!
    expect(c.userName).toBe('乙')
    expect(c.avatar).toBe('http://a/2.jpg')
    expect(c.likedCount).toBe(12)
    expect(c.floor).toBe(3)
    expect(r.list[2]?.avatar).toBe('')
  })

  it('第 2 页不再重复热评', async () => {
    const r = await getSource('wy').getComments!({ songmid: '1', name: 'x', singer: 'y', source: 'wy' } as never, 2, 20)
    expect(r.list.some(c => c.hot)).toBe(false)
    expect(r.page).toBe(2)
  })
})
