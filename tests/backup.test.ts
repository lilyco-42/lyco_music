/**
 * 备份文件的解析与统计。
 *
 * 导出/导入的对话框没法自动化，但最容易出错的是「解析用户手改过或
 * 老版本导出的 JSON」——这部分是纯函数，可以直接测。
 */
import { describe, it, expect } from 'vitest'
import { parseBackup, countPayload, type BackupFile } from '../apps/desktop/src/lib/backup'

const song = (id: string) => ({ id, name: '歌' + id, singer: '人', source: 'wy' as const, songmid: id })

const valid: BackupFile = {
  schema: 1,
  app: 'lyco-music',
  version: '0.2.32',
  exportedAt: '2026-10-21T00:00:00.000Z',
  payload: {
    favorites: [song('1'), song('2')],
    playlists: [{ id: 'p1', name: '我的', items: [song('3')], createdAt: 1, updatedAt: 2 }],
    history: [{ item: song('4'), playedAt: 3 }],
    trial: [song('5')],
    dislikes: ['某歌@某人'],
    settings: { quality: '320k' },
    settingsUpdatedAt: 4,
  },
}

describe('备份解析', () => {
  it('正常备份能解析出全部字段', () => {
    const r = parseBackup(JSON.stringify(valid))
    expect('payload' in r).toBe(true)
    if (!('payload' in r)) return
    const c = countPayload(r.payload)
    expect(c).toEqual({ favorites: 2, playlists: 1, history: 1, trial: 1, dislikes: 1, settings: true })
  })

  it('老备份缺 trial/dislikes 时补空数组而不是报错', () => {
    const legacy = {
      schema: 1,
      app: 'lyco-music',
      payload: { favorites: [song('1')], playlists: [], history: [] },
    }
    const r = parseBackup(JSON.stringify(legacy))
    expect('payload' in r).toBe(true)
    if (!('payload' in r)) return
    expect(r.payload.trial).toEqual([])
    expect(r.payload.dislikes).toEqual([])
  })

  it('不是 JSON / 不是本应用的备份 / 没有 payload 都要给出人话原因', () => {
    expect(parseBackup('not json')).toEqual({ error: '不是合法的 JSON，可能选错了文件' })
    expect(parseBackup(JSON.stringify({ app: 'other-app', payload: {} })))
      .toEqual({ error: '这份备份不是 Lyco Music 的（other-app）' })
    expect(parseBackup(JSON.stringify({ app: 'lyco-music' })))
      .toEqual({ error: '备份里没有 payload 字段' })
  })

  it('字段类型不对时按空处理，不把脏数据带进曲库', () => {
    const r = parseBackup(JSON.stringify({ app: 'lyco-music', payload: { favorites: 'oops', playlists: 3 } }))
    if (!('payload' in r)) throw new Error('应当解析成功')
    expect(r.payload.favorites).toEqual([])
    expect(r.payload.playlists).toEqual([])
  })
})
