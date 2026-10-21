/**
 * 评论正文切片（9.1 图片/表情）用例。
 *
 * 这一层的输入来自网易云的真实数据，形状很脏：表情码、markdown 图片、
 * 裸图片链接、歌词标记 `[00:12]` 全混在一行里。用例就照着这些来。
 */
import { describe, expect, it } from 'vitest'
import { commentHasImage, parseCommentContent } from '@lxmn/core'

function textOf(content: string): string {
  return parseCommentContent(content)
    .filter(s => s.type === 'text')
    .map(s => (s.type === 'text' ? s.text : ''))
    .join('')
}

describe('parseCommentContent', () => {
  it('纯文字原样返回一段', () => {
    const segs = parseCommentContent('这歌真好听')
    expect(segs).toEqual([{ type: 'text', text: '这歌真好听' }])
  })

  it('空串返回空数组', () => {
    expect(parseCommentContent('')).toEqual([])
  })

  it('已知表情码换成字符，前后文字保留', () => {
    const segs = parseCommentContent('好听[大笑]真的')
    expect(segs.map(s => s.type)).toEqual(['text', 'emoji', 'text'])
    expect(segs[1]).toMatchObject({ type: 'emoji', name: '大笑', char: '😄' })
    expect(textOf('好听[大笑]真的')).toBe('好听真的')
  })

  it('未知表情码原样留在文字里（不吞字）', () => {
    const segs = parseCommentContent('这是什么[不存在的表情]啊')
    expect(segs).toEqual([{ type: 'text', text: '这是什么[不存在的表情]啊' }])
  })

  it('markdown 图片切成 image 段', () => {
    const segs = parseCommentContent('看这个 ![图片](https://p1.music.126.net/a.jpg) 好看')
    expect(segs.map(s => s.type)).toEqual(['text', 'image', 'text'])
    expect(segs[1]).toMatchObject({ type: 'image', url: 'https://p1.music.126.net/a.jpg' })
  })

  it('裸图片链接也认', () => {
    const segs = parseCommentContent('https://p1.music.126.net/b.png')
    expect(segs).toEqual([{ type: 'image', url: 'https://p1.music.126.net/b.png' }])
  })

  it('带查询串的图片链接整条保留', () => {
    const url = 'https://p1.music.126.net/c.jpg?imageView&thumbnail=240y240'
    const segs = parseCommentContent(url)
    expect(segs[0]).toMatchObject({ type: 'image', url })
  })

  it('歌词时间标记不被当成表情', () => {
    // `[00:12]` 里是数字，表情码只认中英文，不能被吃掉
    const segs = parseCommentContent('[00:12]故事的小黄花')
    expect(segs).toEqual([{ type: 'text', text: '[00:12]故事的小黄花' }])
  })

  it('一条评论里同时有表情和图片', () => {
    const segs = parseCommentContent('[赞] ![x](https://a.net/1.jpg) [爱心]')
    expect(segs.map(s => s.type)).toEqual(['emoji', 'text', 'image', 'text', 'emoji'])
  })

  it('普通链接不是图片，保持文字', () => {
    const segs = parseCommentContent('来源 https://music.163.com/song?id=1')
    expect(segs).toEqual([{ type: 'text', text: '来源 https://music.163.com/song?id=1' }])
  })

  it('长文本不会因为反复扫描卡死', () => {
    const long = '好听'.repeat(2000) + '[大笑]' + '棒'.repeat(2000)
    const segs = parseCommentContent(long)
    expect(segs.length).toBeGreaterThan(1)
  })
})

describe('commentHasImage', () => {
  it('有图返回 true，没图返回 false', () => {
    expect(commentHasImage('![x](https://a.net/1.jpg)')).toBe(true)
    expect(commentHasImage('https://a.net/1.jpg')).toBe(true)
    expect(commentHasImage('只有文字')).toBe(false)
    expect(commentHasImage('https://music.163.com/song?id=1')).toBe(false)
  })
})
