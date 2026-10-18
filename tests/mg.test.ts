/**
 * mg（咪咕）音源测试。
 *
 * payload **逐字取自线上 v1 search_all.do 的真实返回**（截取，字段名未改动）。
 * 这一点很重要：上游 musicSearch.js 解析的是 jadeite v3 的字段，
 * 与 v1 完全不同 —— 照抄上游会得到 0 条结果（实测确实如此）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  setPlatform, installMgSource, resetSources, getSource, getSupportQuality, handleMgSearchItem,
  type HttpRequestOptions, type HttpResponse, type PlatformAdapter,
} from '@lxmn/core'
import { desktopPlatform } from '@lxmn/platform-desktop'

/** 线上 resultList[0][0] 的真实字段（未改动） */
const REAL_SONG = {
  id: '1113200233',
  resourceType: '2',
  contentId: '600913000002601091',
  copyrightId: '63372200381',
  name: '起风了',
  singers: [{ id: '1111563990', name: '买辣椒也用券' }],
  albums: [{ id: '1115083587', name: '起风了', type: '1' }],
  lyricUrl: 'https://d.musicapp.migu.cn/data/oss/resource/00/5d/do/x',
  trcUrl: '',
  imgItems: [
    { imgSizeType: '01', img: 'https://d.musicapp.migu.cn/a.webp' },
    { imgSizeType: '02', img: 'https://d.musicapp.migu.cn/b.webp' },
    { imgSizeType: '03', img: 'https://d.musicapp.migu.cn/c.webp' },
  ],
  rateFormats: [
    { resourceType: '3', formatType: 'LQ', size: '2607730', fileType: 'mp3' },
    { resourceType: '2', formatType: 'PQ', size: '5215087', fileType: 'mp3' },
    { resourceType: '2', formatType: 'HQ', size: '13037403', fileType: 'mp3' },
    { resourceType: 'E', formatType: 'SQ', size: '41934499', androidFileType: 'flac' },
  ],
}

let captured: HttpRequestOptions[] = []

function fakeHttp(responder: (o: HttpRequestOptions) => unknown): PlatformAdapter {
  return {
    ...desktopPlatform,
    http: {
      async request(o: HttpRequestOptions): Promise<HttpResponse> {
        captured.push(o)
        const r = responder(o)
        const body = typeof r === 'string' ? r : JSON.stringify(r)
        return { statusCode: 200, headers: {}, body, raw: new Uint8Array() }
      },
    },
  }
}

beforeEach(() => {
  captured = []
  resetSources()
  // handleMgSearchItem 会走 formatSingerName -> codec.decodeName
  setPlatform(desktopPlatform)
})

describe('mg 音源', () => {
  it('把真实 v1 搜索结果映射成 MusicItem', () => {
    const item = handleMgSearchItem(REAL_SONG)!
    expect(item.songmid).toBe('1113200233')
    // 取流必须用 contentId，不能与 songmid 混
    expect(item.contentId).toBe('600913000002601091')
    expect(item.copyrightId).toBe('63372200381')
    expect(item.name).toBe('起风了')
    expect(item.singer).toBe('买辣椒也用券')
    expect(item.albumName).toBe('起风了')
    expect(item.albumId).toBe('1115083587')
    expect(item.source).toBe('mg')
    // 搜索接口没有时长，留空由 fillDurations 补
    expect(item.interval).toBe('')
    expect(item.qualitys).toHaveProperty('128k')
    expect(item.qualitys).toHaveProperty('320k')
    expect(item.qualitys).toHaveProperty('flac')
  })

  it('封面取尺寸最大的 03', () => {
    expect(handleMgSearchItem(REAL_SONG)!.picUrl).toBe('https://d.musicapp.migu.cn/c.webp')
  })

  it('只有 01 时回退到 01', () => {
    const item = handleMgSearchItem({
      ...REAL_SONG,
      imgItems: [{ imgSizeType: '01', img: 'https://x/a.webp' }],
    })!
    expect(item.picUrl).toBe('https://x/a.webp')
  })

  it('newRateFormats 里的 ZQ 也识别为 flac24bit', () => {
    const item = handleMgSearchItem({
      id: '1', name: 'x', copyrightId: 'c', contentId: 'ct',
      newRateFormats: [{ formatType: 'ZQ', size: '100000000' }],
    })!
    expect(item.qualitys).toHaveProperty('flac24bit')
  })

  it('搜索按 copyrightId 去重并批量补时长', async () => {
    setPlatform(fakeHttp(o => {
      if (o.url.includes('resourceinfo.do')) {
        return { code: '000000', resource: [{ songId: '1113200233', length: '00:05:25' }] }
      }
      return {
        code: '000000',
        songResultData: {
          totalCount: '191',
          resultList: [[REAL_SONG], [REAL_SONG, { ...REAL_SONG, id: '999', copyrightId: 'other' }]],
        },
      }
    }))
    installMgSource()

    const r = await getSource('mg').musicSearch!('起风了', 1, 20)
    expect(r.list).toHaveLength(2)
    expect(r.total).toBe(191)
    expect(r.source).toBe('mg')
    // 时长由第二次请求补齐
    expect(r.list[0]!.interval).toBe('00:05:25')

    expect(captured[0]!.url).toContain('search_all.do')
    expect(captured[0]!.url).toContain('pageNo=1')
    expect(captured[0]!.url).toContain('pageSize=20')
    // 补时长用的是 POST + resourceId 列表
    const info = captured.find(c => c.url.includes('resourceinfo.do'))!
    expect(info.method).toBe('POST')
    expect(String(info.body)).toContain('resourceId=1113200233')
  })

  it('补时长失败不影响搜索结果', async () => {
    setPlatform({
      ...desktopPlatform,
      http: {
        async request(o: HttpRequestOptions): Promise<HttpResponse> {
          captured.push(o)
          if (o.url.includes('resourceinfo.do')) throw new Error('boom')
          return {
            statusCode: 200, headers: {}, raw: new Uint8Array(),
            body: JSON.stringify({ code: '000000', songResultData: { totalCount: '1', resultList: [[REAL_SONG]] } }),
          }
        },
      },
    })
    installMgSource()
    const r = await getSource('mg').musicSearch!('x', 1, 20)
    expect(r.list).toHaveLength(1)
    expect(r.list[0]!.interval).toBe('')
  })

  it('搜索返回非 000000 时抛出可读错误', async () => {
    setPlatform(fakeHttp(() => ({ code: '100001', info: '参数错误' })))
    installMgSource()
    await expect(getSource('mg').musicSearch!('x', 1, 20)).rejects.toThrow(/参数错误/)
  })

  it('取流用 contentId 而不是 songmid，且不预下载整个文件', async () => {
    setPlatform(fakeHttp(() => 'x'))
    installMgSource()
    const base = {
      id: '1', name: 'x', singer: 'y', source: 'mg' as const,
      songmid: '1113200233', contentId: '600913000002601091', copyrightId: '63372200381',
    }

    const u1 = await getSource('mg').getMusicUrl(base, '320k')
    expect(u1.url).toContain('toneFlag=HQ')
    expect(u1.url).toContain('contentId=600913000002601091')
    expect(u1.url).toContain('copyrightId=63372200381')

    const u2 = await getSource('mg').getMusicUrl(base, 'flac24bit')
    expect(u2.url).toContain('toneFlag=ZQ24')

    const u3 = await getSource('mg').getMusicUrl(base, '128k')
    expect(u3.url).toContain('toneFlag=LQ')

    // 关键：只允许 2 字节 Range 探测请求，绝不预下载整个文件
    expect(captured.length).toBeGreaterThan(0)
    for (const req of captured) {
      expect(req.headers?.Range).toBe('bytes=0-1')
    }
  })

  it('缺少 contentId 时明确报错', async () => {
    setPlatform(fakeHttp(() => 'x'))
    installMgSource()
    await expect(getSource('mg').getMusicUrl(
      { id: '1', name: 'x', singer: 'y', source: 'mg', songmid: '1', copyrightId: 'c' }, '320k'))
      .rejects.toThrow(/contentId/)
  })

  it('歌词取 lrcUrl 文本', async () => {
    setPlatform(fakeHttp(() => '[00:01.00]第一行\n[00:02.00]第二行'))
    installMgSource()
    const l = await getSource('mg').getLyric({
      id: '1', name: 'x', singer: 'y', source: 'mg', songmid: '1',
      lrcUrl: 'https://cdn.migu.cn/1.lrc',
    })
    expect(l.lyric).toContain('[00:01.00]第一行')
  })

  it('没有 lrcUrl 时给出可读错误而不是空歌词', async () => {
    setPlatform(fakeHttp(() => ''))
    installMgSource()
    await expect(getSource('mg').getLyric({
      id: '1', name: 'x', singer: 'y', source: 'mg', songmid: '1' }))
      .rejects.toThrow(/暂无歌词/)
  })

  it('注册后能查到并声明支持的音质', () => {
    installMgSource()
    expect(getSource('mg').id).toBe('mg')
    expect(getSupportQuality('mg')).toContain('flac24bit')
  })
})
