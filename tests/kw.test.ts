/**
 * kw（酷我）音源的测试。
 *
 * 这里断言的是**真实响应的形状**（payload 逐字取自线上返回），
 * 而不是照着实现反推的假数据 —— 否则实现错了测试也会一起错。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  setPlatform, installKwSource, resetSources, getSource, getSupportQuality, handleKwSearchItem,
  normalizeKwPic,
  type HttpRequestOptions, type HttpResponse, type PlatformAdapter,
} from '@lxmn/core'
import { desktopPlatform } from '@lxmn/platform-desktop'

/** 线上 /r.s 的真实返回（截取，字段未改动） */
const REAL_ABS = {
  ALBUM: '起风了 (旧版)',
  ALBUMID: '4027807',
  ARTIST: '买辣椒也用券',
  DURATION: '312',
  FORMAT: 'wma',
  MUSICRID: 'MUSIC_26445261',
  SONGNAME: '起风了 (旧版)',
  web_albumpic_short: '120/s4s93/20/1171025426.jpg',
  MINFO: 'level:ff,bitrate:2000,format:flac,size:26.3Mb;level:p,bitrate:192,format:ogg,size:5.67Mb;level:p,bitrate:300,format:ogg,size:9.34Mb;level:h,bitrate:100,format:ogg,size:3.1Mb;level:p,bitrate:320,format:mp3,size:11.94Mb;level:s,bitrate:48,format:aac,size:1.82Mb;level:h,bitrate:128,format:mp3,size:4.78Mb',
  N_MINFO: 'level:dtsx,bitrate:25000,format:mmp4,size:8.41Mb;level:ff,bitrate:2000,format:flac,size:26.3Mb;level:p,bitrate:320,format:mp3,size:11.94Mb;level:h,bitrate:128,format:mp3,size:4.78Mb;level:s,bitrate:48,format:aac,size:1.82Mb',
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
})

describe('kw 音源', () => {
  it('把真实搜索结果映射成 MusicItem', () => {
    const item = handleKwSearchItem(REAL_ABS)!
    expect(item.songmid).toBe('26445261')
    expect(item.name).toBe('起风了 (旧版)')
    expect(item.singer).toBe('买辣椒也用券')
    expect(item.albumName).toBe('起风了 (旧版)')
    expect(item.albumId).toBe('4027807')
    expect(item.source).toBe('kw')
    // 312 秒 -> 05:12
    expect(item.interval).toBe('05:12')
    // flac(2000) -> flac24bit, mp3(320) -> 320k, mp3(128) -> 128k
    expect(item.qualitys).toHaveProperty('flac24bit')
    expect(item.qualitys).toHaveProperty('320k')
    expect(item.qualitys).toHaveProperty('128k')
  })

  it('按 bitrate 而不是写死的魔数识别音质', () => {
    // 上游只认 4000/2000/320/128 四个魔数；这里验证区间判定：
    // 1000kbps 的 flac 应落在 flac（而非 flac24bit），256kbps 的 mp3 落在 128k。
    // 后者是**刻意保守**的：内核的 Quality 联合类型只有 128k/320k 两档 mp3，
    // 把 256k 谎报成 320k 会让用户以为拿到了更高音质，宁可低报。
    const item = handleKwSearchItem({
      MUSICRID: 'MUSIC_1',
      SONGNAME: 'x',
      ARTIST: 'y',
      N_MINFO: 'level:x,bitrate:1000,format:flac,size:10Mb;level:y,bitrate:256,format:mp3,size:5Mb',
    })!
    expect(item.qualitys).toHaveProperty('flac')       // 1000 < 2000
    expect(item.qualitys).not.toHaveProperty('flac24bit')
    expect(item.qualitys).toHaveProperty('128k')       // 256 >= 128 但 < 320
    expect(item.qualitys).not.toHaveProperty('320k')
  })

  it('真机上出现过的 320k/128k mp3 档位能各自识别', () => {
    const item = handleKwSearchItem({
      MUSICRID: 'MUSIC_2',
      SONGNAME: 'x',
      ARTIST: 'y',
      N_MINFO: 'level:p,bitrate:320,format:mp3,size:11.94Mb;level:h,bitrate:128,format:mp3,size:4.78Mb',
    })!
    expect(item.qualitys).toHaveProperty('320k')
    expect(item.qualitys).toHaveProperty('128k')
  })

  it('歌手用 & 分隔时转成顿号', () => {
    const item = handleKwSearchItem({ MUSICRID: 'MUSIC_3', SONGNAME: 'x', ARTIST: '周杰伦&袁咏琳' })!
    expect(item.singer).toBe('周杰伦、袁咏琳')
  })

  it('搜索结果带专辑封面，且升到 500 宽', () => {
    const item = handleKwSearchItem(REAL_ABS)!
    // 相对路径 120/... -> https://img1.kuwo.cn/star/albumcover/500/...
    expect(item.picUrl).toBe('https://img1.kuwo.cn/star/albumcover/500/s4s93/20/1171025426.jpg')
  })

  it('没有封面字段时不塞空串', () => {
    const item = handleKwSearchItem({ MUSICRID: 'MUSIC_9', SONGNAME: 'x', ARTIST: 'y' })!
    expect(item.picUrl).toBeUndefined()
  })

  it('封面归一化：http 升 https、限流主机换掉、尺寸统一 500', () => {
    // getPic 端点真实返回（http + img1.kwcdn.kuwo.cn，该主机走 https 会 514）
    expect(normalizeKwPic('http://img1.kwcdn.kuwo.cn/star/albumcover/500/s4s93/20/1171025426.jpg'))
      .toBe('https://img1.kuwo.cn/star/albumcover/500/s4s93/20/1171025426.jpg')
    // 相对路径（搜索接口的 web_albumpic_short）
    expect(normalizeKwPic('120/s3s94/93/211513640.jpg'))
      .toBe('https://img1.kuwo.cn/star/albumcover/500/s3s94/93/211513640.jpg')
    // 已经是目标主机时保持不变（幂等）
    const once = normalizeKwPic('120/s3s94/93/211513640.jpg')
    expect(normalizeKwPic(once)).toBe(once)
  })

  it('封面归一化：垃圾输入返回空串，不拼半截地址', () => {
    for (const bad of ['', '   ', null, undefined, 42, {}, 'not-a-path', '120/']) {
      expect(normalizeKwPic(bad)).toBe('')
    }
  })

  it('搜索会带上酷我要求的固定参数', async () => {
    setPlatform(fakeHttp(() => ({ TOTAL: '3564', abslist: [REAL_ABS] })))
    installKwSource()

    const r = await getSource('kw').musicSearch!('起风了', 1, 30)
    expect(r.total).toBe(3564)
    expect(r.source).toBe('kw')
    expect(r.allPage).toBe(Math.ceil(3564 / 30))
    expect(r.list).toHaveLength(1)

    const url = captured[0]!.url
    expect(url).toContain('search.kuwo.cn')
    expect(url).toContain('client=kt')
    expect(url).toContain('rformat=json')
    // 分页：pn 从 0 开始
    expect(url).toContain('pn=0')
    expect(url).toContain('rn=30')
  })

  it('取流走 antiserver 并返回真实地址', async () => {
    setPlatform(fakeHttp(() => ({ code: 200, url: 'https://kw-bj.kuwo.cn/abc/def.mp3' })))
    installKwSource()

    const info = await getSource('kw').getMusicUrl(
      { id: '26445261', name: 'x', singer: 'y', source: 'kw', songmid: '26445261' }, '320k')
    expect(info.url).toBe('https://kw-bj.kuwo.cn/abc/def.mp3')
    expect(info.quality).toBe('320k')
    expect(captured[0]!.url).toContain('antiserver.kuwo.cn')
    expect(captured[0]!.url).toContain('rid=MUSIC_26445261')
    expect(captured[0]!.url).toContain('format=mp3')
  })

  it('无损档位请求 mp3（实测 flac 返回 code=-1）', async () => {
    setPlatform(fakeHttp(() => ({ code: 200, url: 'https://x/y.mp3' })))
    installKwSource()
    await getSource('kw').getMusicUrl(
      { id: '1', name: 'x', singer: 'y', source: 'kw', songmid: '1' }, 'flac')
    expect(captured[0]!.url).toContain('format=mp3')
  })

  it('取流失败时给出可读原因，而不是空地址', async () => {
    setPlatform(fakeHttp(() => ({ code: -1, url: '', msg: 'no permission' })))
    installKwSource()
    await expect(getSource('kw').getMusicUrl(
      { id: '1', name: 'x', singer: 'y', source: 'kw', songmid: '1' }, '320k'))
      .rejects.toThrow(/no permission/)
  })

  it('歌词解析成标准 LRC', async () => {
    setPlatform(fakeHttp(() => ({
      data: { lrclist: [{ lineLyric: '第一行', time: '6.42' }, { lineLyric: '第二行', time: '12.5' }] },
    })))
    installKwSource()
    const l = await getSource('kw').getLyric({ id: '1', name: 'x', singer: 'y', source: 'kw', songmid: '1' })
    expect(l.lyric).toContain('[00:06.42]第一行')
    expect(l.lyric).toContain('[00:12.50]第二行')
  })

  it('封面端点返回纯文本地址时升 https 并换掉限流主机', async () => {
    // 端点真实返回是 http://img1.kwcdn.kuwo.cn/...：Android 9+ 禁明文，
    // 且该主机走 https 会 514 Frequency Capped，所以必须重建到 img1.kuwo.cn
    setPlatform(fakeHttp(() => 'http://img1.kwcdn.kuwo.cn/star/albumcover/500/x.jpg'))
    installKwSource()
    const p = await getSource('kw').getPic({ id: '1', name: 'x', singer: 'y', source: 'kw', songmid: '1' })
    expect(p.url).toBe('https://img1.kuwo.cn/star/albumcover/500/x.jpg')
  })

  it('封面端点返回非 URL 时给空串而不是把错误内容当图片', async () => {
    setPlatform(fakeHttp(() => 'error'))
    installKwSource()
    const p = await getSource('kw').getPic({ id: '1', name: 'x', singer: 'y', source: 'kw', songmid: '1' })
    expect(p.url).toBe('')
  })

  it('注册后音源可被查询到，并声明支持的最高音质', () => {
    installKwSource()
    expect(getSource('kw').id).toBe('kw')
    expect(getSupportQuality('kw')).toContain('flac24bit')
    expect(getSupportQuality('kw')).toContain('128k')
  })
})