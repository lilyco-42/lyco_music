/**
 * 本地音乐（网易云下载目录导入）测试
 *
 * 只测内核里的纯函数：文件名解析、扩展名分类、分组、转 MusicItem。
 * 真正的目录遍历在 Electron 主进程，由 scripts/probe-local.cjs 实测。
 */
import { describe, it, expect } from 'vitest'
import {
  fileExt,
  fileBase,
  isAudioFile,
  isEncryptedFile,
  parseTrackName,
  localTrackId,
  localMediaUrl,
  localCoverUrl,
  pathFromMediaUrl,
  dirOf,
  dirBaseName,
  groupLocalFiles,
  summarizeScan,
  buildLocalTracks,
  AUDIO_EXTS,
  ENCRYPTED_EXTS,
  localSource,
  installLocalSource,
  resetSources,
  hasSource,
  getSource,
  getSupportQuality,
  type LocalFileEntry,
} from '@lxmn/core'

function entry(p: string, size = 1024): LocalFileEntry {
  const name = p.slice(Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/')) + 1)
  return { path: p, name, size, mtime: 0 }
}

describe('扩展名', () => {
  it('小写化并去掉点', () => {
    expect(fileExt('a.MP3')).toBe('mp3')
    expect(fileExt('a.Flac')).toBe('flac')
  })

  it('没有扩展名 / 只有点开头 都返回空', () => {
    expect(fileExt('noext')).toBe('')
    expect(fileExt('.gitignore')).toBe('')
    expect(fileExt('trailing.')).toBe('')
  })

  it('fileBase 去掉扩展名', () => {
    expect(fileBase('周杰伦 - 晴天.mp3')).toBe('周杰伦 - 晴天')
    expect(fileBase('noext')).toBe('noext')
  })

  it('音频与加密格式互不重叠', () => {
    for (const ext of AUDIO_EXTS) expect(isEncryptedFile('x.' + ext)).toBe(false)
    for (const ext of ENCRYPTED_EXTS) expect(isAudioFile('x.' + ext)).toBe(false)
  })

  it('识别常见音频格式', () => {
    for (const f of ['a.mp3', 'a.flac', 'a.m4a', 'a.wav', 'a.ogg']) {
      expect(isAudioFile(f)).toBe(true)
    }
    expect(isAudioFile('a.txt')).toBe(false)
    expect(isAudioFile('a.jpg')).toBe(false)
  })

  it('识别各平台的加密格式', () => {
    expect(isEncryptedFile('a.ncm')).toBe(true)   // 网易云
    expect(isEncryptedFile('a.kgm')).toBe(true)   // 酷狗
    expect(isEncryptedFile('a.qmcflac')).toBe(true) // QQ 音乐
    expect(isEncryptedFile('a.mp3')).toBe(false)
  })
})

describe('parseTrackName（网易云命名是「歌手 - 歌名」）', () => {
  it('常规：歌手 - 歌名', () => {
    expect(parseTrackName('周杰伦 - 晴天.mp3')).toEqual({ singer: '周杰伦', title: '晴天' })
  })

  it('多位歌手（逗号连接）整体当歌手', () => {
    expect(parseTrackName('拿花负荷,孟笙 - 天使之痕.mp3'))
      .toEqual({ singer: '拿花负荷,孟笙', title: '天使之痕' })
  })

  it('歌名里还有连字符：只切第一个，剩下的全归歌名', () => {
    expect(parseTrackName('A - 歌名 - Live.mp3')).toEqual({ singer: 'A', title: '歌名 - Live' })
  })

  it('没有分隔符：整串当歌名，歌手留空（由调用方补「未知歌手」）', () => {
    expect(parseTrackName('纯歌名.mp3')).toEqual({ title: '纯歌名', singer: '' })
  })

  it('全角连字符与长破折号也当分隔符', () => {
    expect(parseTrackName('周杰伦 － 晴天.mp3')).toEqual({ singer: '周杰伦', title: '晴天' })
    expect(parseTrackName('周杰伦 — 晴天.mp3')).toEqual({ singer: '周杰伦', title: '晴天' })
  })

  it('分隔符在开头不算（避免把「 - 歌名」解析成空歌手）', () => {
    expect(parseTrackName(' - 晴天.mp3')).toEqual({ title: '- 晴天', singer: '' })
  })

  it('扩展名不影响解析', () => {
    expect(parseTrackName('A - B.flac').title).toBe('B')
    expect(parseTrackName('A - B.ncm').singer).toBe('A')
  })
})

describe('媒体地址', () => {
  it('Windows 路径往返一致', () => {
    const p = 'C:\\CloudMusic\\VipSongsDownload\\Bôa - Duvet.mp3'
    expect(pathFromMediaUrl(localMediaUrl(p))).toBe(p)
  })

  it('中文与空格往返一致', () => {
    const p = 'D:\\我的音乐\\周杰伦 - 晴天 (Live).flac'
    expect(pathFromMediaUrl(localMediaUrl(p))).toBe(p)
  })

  it('不是本协议时返回空串', () => {
    expect(pathFromMediaUrl('https://x/y.mp3')).toBe('')
    expect(pathFromMediaUrl('')).toBe('')
  })

  it('localTrackId 用路径做身份', () => {
    expect(localTrackId('C:\\a.mp3')).toBe('local:C:\\a.mp3')
  })
})

describe('路径工具（不依赖 node:path）', () => {
  it('dirOf 兼容反斜杠与正斜杠', () => {
    expect(dirOf('C:\\CloudMusic\\a.mp3')).toBe('C:\\CloudMusic')
    expect(dirOf('/home/u/a.mp3')).toBe('/home/u')
  })

  it('dirBaseName 去掉尾部分隔符', () => {
    expect(dirBaseName('C:\\CloudMusic\\VipSongsDownload')).toBe('VipSongsDownload')
    expect(dirBaseName('/a/b/')).toBe('b')
  })
})

describe('groupLocalFiles（一个目录 = 一个歌单）', () => {
  it('平铺目录只有一组，组名取目录名', () => {
    const groups = groupLocalFiles([entry('C:\\CloudMusic\\a.mp3'), entry('C:\\CloudMusic\\b.mp3')], 'C:\\CloudMusic')
    expect(groups).toHaveLength(1)
    expect(groups[0]!.name).toBe('CloudMusic')
    expect(groups[0]!.files).toHaveLength(2)
  })

  it('子目录各成一组，根目录组排最前', () => {
    const groups = groupLocalFiles([
      entry('C:\\CloudMusic\\VipSongsDownload\\x.mp3'),
      entry('C:\\CloudMusic\\root.mp3'),
      entry('C:\\CloudMusic\\歌单A\\y.mp3'),
    ], 'C:\\CloudMusic')
    expect(groups.map(g => g.name)).toEqual(['CloudMusic', 'VipSongsDownload', '歌单A'])
  })

  it('根目录参数末尾带分隔符也能匹配', () => {
    const groups = groupLocalFiles([entry('C:\\CloudMusic\\root.mp3')], 'C:\\CloudMusic\\')
    expect(groups[0]!.dir).toBe('C:\\CloudMusic')
  })
})

describe('summarizeScan', () => {
  it('分别统计可导入 / 加密 / 忽略', () => {
    const s = summarizeScan([
      { name: 'a.mp3' }, { name: 'b.flac' },
      { name: 'c.ncm' }, { name: 'd.ncm' }, { name: 'e.kgm' },
      { name: 'f.jpg' }, { name: 'g.txt' },
    ])
    expect(s.playable).toBe(2)
    expect(s.encrypted).toBe(3)
    expect(s.ignored).toBe(2)
    expect(s.encryptedByExt).toEqual({ ncm: 2, kgm: 1 })
  })

  it('空列表全是 0', () => {
    expect(summarizeScan([])).toEqual({ playable: 0, encrypted: 0, ignored: 0, encryptedByExt: {} })
  })
})

describe('buildLocalTracks', () => {
  it('转成 source=local 的 MusicItem，并带上媒体地址', () => {
    const tracks = buildLocalTracks([entry('C:\\CloudMusic\\周杰伦 - 晴天.mp3')])
    expect(tracks).toHaveLength(1)
    const t = tracks[0]!
    expect(t.source).toBe('local')
    expect(t.name).toBe('晴天')
    expect(t.singer).toBe('周杰伦')
    expect(String(t.url)).toBe(localMediaUrl('C:\\CloudMusic\\周杰伦 - 晴天.mp3'))
    expect(t.songmid).toBe('C:\\CloudMusic\\周杰伦 - 晴天.mp3')
  })

  it('没有歌手时补「未知歌手」，不是空串', () => {
    const t = buildLocalTracks([entry('C:\\m\\纯歌名.mp3')])[0]!
    expect(t.singer).toBe('未知歌手')
  })

  it('跳过加密文件与无关文件', () => {
    const tracks = buildLocalTracks([
      entry('C:\\m\\a.mp3'),
      entry('C:\\m\\b.ncm'),
      entry('C:\\m\\c.jpg'),
    ])
    expect(tracks.map(t => t.name)).toEqual(['a'])
  })

  it('有同名歌词时一并带上', () => {
    const p = 'C:\\m\\A - B.mp3'
    const tracks = buildLocalTracks([entry(p)], { lyrics: { [p]: '[00:01.00]歌词' } })
    expect(tracks[0]!.lyric).toBe('[00:01.00]歌词')
  })

  it('没有歌词时不产生 lyric 字段（避免 getLyric 拿到 undefined 之外的脏值）', () => {
    const tracks = buildLocalTracks([entry('C:\\m\\A - B.mp3')])
    expect('lyric' in tracks[0]!).toBe(false)
  })

  it('id 稳定：同一路径两次构建得到同样的 id', () => {
    const a = buildLocalTracks([entry('C:\\m\\A - B.mp3')])[0]!
    const b = buildLocalTracks([entry('C:\\m\\A - B.mp3')])[0]!
    expect(a.id).toBe(b.id)
  })
})

/**
 * 本地音源（sources/local.ts）
 *
 * 这一层是「本地文件」与「在线歌」的接缝：播放器只认 MusicSource，
 * 只要这里行为正确，播放/歌词/封面三条链路就不需要任何 source 判断。
 */
describe('localSource', () => {
  it('getMusicUrl 直接返回导入时算好的地址，不发请求', async () => {
    const t = buildLocalTracks([entry('C:\\m\\周杰伦 - 晴天.mp3')])[0]!
    const info = await localSource.getMusicUrl(t, '320k')
    expect(info.url).toBe(localMediaUrl('C:\\m\\周杰伦 - 晴天.mp3'))
    expect(info.type).toBe('mp3')
    expect(info.quality).toBe('320k')
  })

  it('无损扩展名报 flac 音质（只影响界面显示）', async () => {
    const t = buildLocalTracks([entry('C:\\m\\A - B.flac')])[0]!
    expect((await localSource.getMusicUrl(t, '320k')).quality).toBe('flac')
    const ape = buildLocalTracks([entry('C:\\m\\A - B.ape')])[0]!
    expect((await localSource.getMusicUrl(ape, '320k')).quality).toBe('flac')
  })

  it('缺地址时抛错而不是返回空串（空串会让 <audio> 静默失败）', async () => {
    await expect(
      localSource.getMusicUrl({ ...buildLocalTracks([entry('C:\\m\\a.mp3')])[0]!, url: '' }, '320k'),
    ).rejects.toThrow(/重新导入/)
  })

  it('getLyric 没有歌词时返回空串，不抛错', async () => {
    const t = buildLocalTracks([entry('C:\\m\\a.mp3')])[0]!
    expect(await localSource.getLyric(t)).toEqual({ lyric: '' })
  })

  it('installLocalSource 把音源注册进内核，并声明支持音质', () => {
    resetSources()
    expect(hasSource('local')).toBe(false)
    installLocalSource()
    expect(hasSource('local')).toBe(true)
    expect(getSource('local')).toBe(localSource)
    expect(getSupportQuality('local')).toEqual(['flac', '320k'])
    resetSources()
  })

  it('没有 musicSearch —— 本地库没有搜索语义', () => {
    expect(localSource.musicSearch).toBeUndefined()
  })
})


/**
 * 内嵌标签与封面（PARITY 4.8）
 *
 * 标签优先、文件名兜底。这两条路径必须都成立：
 * 网易云下载的文件名不一定规范（`01.mp3`、`未知 - xxx.mp3`），
 * 而标签也可能是空的（用户自己转的裸文件）。
 */
describe('buildLocalTracks：内嵌标签', () => {
  const BS = String.fromCharCode(92)

  function file(path: string, extra: Partial<LocalFileEntry> = {}): LocalFileEntry {
    const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf(BS))
    return { path, name: path.slice(at + 1), size: 1, mtime: 0, ...extra }
  }

  it('标签覆盖文件名解析结果', () => {
    const t = buildLocalTracks([file('C:/m/01.mp3', { title: '晴天', artist: '周杰伦', album: '叶惠美' })])[0]!
    expect(t.name).toBe('晴天')
    expect(t.singer).toBe('周杰伦')
    expect(t.albumName).toBe('叶惠美')
  })

  it('没有标签时退回文件名', () => {
    const t = buildLocalTracks([file('C:/m/周杰伦 - 晴天.mp3')])[0]!
    expect(t.name).toBe('晴天')
    expect(t.singer).toBe('周杰伦')
    expect(t.albumName).toBeUndefined()
  })

  it('标签是空白串时也退回文件名，不会产生空歌名', () => {
    const t = buildLocalTracks([file('C:/m/周杰伦 - 晴天.mp3', { title: '   ', artist: '' })])[0]!
    expect(t.name).toBe('晴天')
    expect(t.singer).toBe('周杰伦')
  })

  it('Windows 反斜杠路径同样能取到文件名', () => {
    const t = buildLocalTracks([file('C:' + BS + 'm' + BS + '周杰伦 - 晴天.mp3')])[0]!
    expect(t.name).toBe('晴天')
    expect(t.singer).toBe('周杰伦')
  })

  it('有封面时 picUrl 指向 lxmn-media://cover/，且不会被当成音频地址', () => {
    const t = buildLocalTracks([file('C:/m/a b.mp3', { title: 'x', hasCover: true })])[0]!
    expect(t.picUrl).toBe(localCoverUrl('C:/m/a b.mp3'))
    expect(String(t.picUrl)).toContain('lxmn-media://cover/')
    // 封面路由和音频路由不能互相误判
    expect(pathFromMediaUrl(String(t.picUrl))).toBe('')
    expect(t.url).toBe(localMediaUrl('C:/m/a b.mp3'))
  })

  it('没有封面时不写 picUrl（界面会走默认封面）', () => {
    const t = buildLocalTracks([file('C:/m/a.mp3', { title: 'x' })])[0]!
    expect(t.picUrl).toBeUndefined()
  })

  it('localCoverUrl 对空格与中文做了 URL 编码', () => {
    const url = localCoverUrl('C:/我的音乐/晴天.mp3')
    expect(url).not.toContain(' ')
    expect(decodeURIComponent(url.slice('lxmn-media://cover/'.length))).toBe('C:/我的音乐/晴天.mp3')
  })
})
