/**
 * 下载队列与文件命名。
 *
 * 这里不真的下载文件 —— 用可控的假 transport 验证**调度规则**：
 * 并发上限、失败重试、暂停继续、降级改扩展名、重启后的状态修正。
 * 这些都是用户能直接感知的行为，写错了他会看到「点下载没反应」。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  setPlatform, DownloadManager, buildFileName, sanitizeFileName, clipBaseName,
  extForQuality, NAME_FORMATS,
  type DownloadEvent, type DownloadRequest, type DownloadTransport,
  type MusicItem, type PlatformAdapter,
} from '@lxmn/core'

const mem = new Map<string, string>()

const adapter: PlatformAdapter = {
  name: 'web',
  version: 'test',
  crypto: {
    aesEncrypt: () => new Uint8Array(), aesDecrypt: () => new Uint8Array(),
    rsaEncrypt: () => new Uint8Array(), randomBytes: () => new Uint8Array(),
    md5: () => '', sha1: () => '',
  },
  compress: {
    inflateToString: async () => '', inflate: async () => new Uint8Array(),
    deflate: async () => new Uint8Array(),
  },
  http: { request: async () => { throw new Error('no network') } },
  timer: {
    setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number,
    clearTimeout: id => clearTimeout(id as unknown as NodeJS.Timeout),
    setInterval: (fn, ms) => setInterval(fn, ms) as unknown as number,
    clearInterval: id => clearInterval(id as unknown as NodeJS.Timeout),
  },
  storage: {
    get: async k => mem.get(k) ?? null,
    set: async (k, v) => { mem.set(k, v) },
    remove: async k => { mem.delete(k) },
    keys: async () => [...mem.keys()],
  },
  codec: {
    utf8Encode: s => new Uint8Array(Buffer.from(s, 'utf8')),
    utf8Decode: b => Buffer.from(b).toString('utf8'),
    base64Encode: b => Buffer.from(typeof b === 'string' ? b : Buffer.from(b)).toString('base64'),
    base64Decode: s => new Uint8Array(Buffer.from(s, 'base64')),
    decodeName: s => String(s),
  },
} as PlatformAdapter

const song = (id: string, name: string, singer = '某歌手'): MusicItem => ({
  id, name, singer, source: 'wy', songmid: id,
})

/** 可控的假传输层：start 挂起，直到测试主动完成它 */
class FakeTransport implements DownloadTransport {
  /** 已启动的任务 id，按启动顺序 */
  readonly started: string[] = []
  /** 完整的启动请求（要断言目录/文件名时用） */
  readonly requests: DownloadRequest[] = []
  readonly paused: string[] = []
  readonly removed: string[] = []
  readonly pending = new Map<string, (event: DownloadEvent) => void>()
  /** 每个任务的 resolve，测试用它结束一个下载 */
  readonly done = new Map<string, () => void>()
  dirOk = true

  async ensureDir(): Promise<boolean> {
    return this.dirOk
  }

  start(request: DownloadRequest, emit: (event: DownloadEvent) => void): Promise<void> {
    this.started.push(request.id)
    this.requests.push(request)
    this.pending.set(request.id, emit)
    emit({ type: 'start' })
    return new Promise<void>(resolve => {
      this.done.set(request.id, () => {
        this.pending.delete(request.id)
        resolve()
      })
    })
  }

  async pause(id: string): Promise<void> {
    this.paused.push(id)
    this.done.get(id)?.()
    this.done.delete(id)
  }

  async remove(id: string): Promise<void> {
    this.removed.push(id)
    this.done.get(id)?.()
    this.done.delete(id)
  }

  /** 让某个任务成功完成 */
  finish(id: string, total = 1000): void {
    const emit = this.pending.get(id)
    emit?.({ type: 'progress', downloaded: total, total, speed: '1 MB/s' })
    emit?.({ type: 'complete', total })
    this.done.get(id)?.()
    this.done.delete(id)
  }

  /** 让某个任务失败 */
  failWith(id: string, event: Extract<DownloadEvent, { type: 'error' }>): void {
    this.pending.get(id)?.({ ...event, type: 'error' })
    this.done.get(id)?.()
    this.done.delete(id)
  }
}

function makeManager(overrides: Partial<ConstructorParameters<typeof DownloadManager>[0]> = {}) {
  const transport = new FakeTransport()
  const manager = new DownloadManager({
    transport,
    resolveStream: async task => ({ url: `https://cdn.test/${task.id}.mp3`, quality: task.quality }),
    directory: () => 'C:/Music',
    nameFormat: () => 'title-artist',
    concurrency: () => 2,
    ...overrides,
  })
  return { manager, transport }
}

/**
 * 让 pump 里的微任务跑完。
 *
 * 用 20ms 而不是 0：完成一个任务要经过「emit → resolve → finally → pump
 * → 下一个任务的三层 await」，setTimeout(0) 在部分环境下只够跑完第一层，
 * 测试会看到「没有补上下一个」的假失败。
 */
const tick = () => new Promise(r => setTimeout(r, 20))

beforeEach(() => {
  mem.clear()
  setPlatform(adapter)
})

describe('文件命名', () => {
  const item = { name: '晴天', singer: '周杰伦', albumName: '叶惠美' }

  it('三种内置模板', () => {
    expect(buildFileName(item, 'title-artist', 'mp3')).toBe('晴天 - 周杰伦.mp3')
    expect(buildFileName(item, 'artist-title', 'flac')).toBe('周杰伦 - 晴天.flac')
    expect(buildFileName(item, 'title', 'mp3')).toBe('晴天.mp3')
    expect(NAME_FORMATS).toHaveLength(3)
  })

  it('兼容 lx 的中文占位符（迁移用户原来的设置不用改）', () => {
    expect(buildFileName(item, '歌名 - 歌手', 'mp3')).toBe('晴天 - 周杰伦.mp3')
    expect(buildFileName(item, '歌手《歌名》', 'mp3')).toBe('周杰伦《晴天》.mp3')
  })

  it('艺术家为空时不留悬空的分隔符', () => {
    expect(buildFileName({ name: '纯音乐', singer: '' }, 'title-artist', 'mp3')).toBe('纯音乐.mp3')
    expect(buildFileName({ name: '', singer: '薛之谦' }, 'artist-title', 'mp3')).toBe('薛之谦.mp3')
  })

  it('非法字符替换成下划线而不是删掉（删掉会撞名）', () => {
    expect(sanitizeFileName('AC/DC')).toBe('AC_DC')
    expect(sanitizeFileName('a:b*c?d"e<f>g|h')).toBe('a_b_c_d_e_f_g_h')
    expect(buildFileName({ name: 'A/B', singer: 'C:D' }, 'title-artist', 'mp3')).toBe('A_B - C_D.mp3')
  })

  it('Windows 保留名加前缀（否则文件根本创建不了）', () => {
    expect(sanitizeFileName('CON')).toBe('_CON')
    expect(sanitizeFileName('nul.mp3')).toBe('_nul.mp3')
    expect(sanitizeFileName('CONSOLE')).toBe('CONSOLE')
  })

  it('去掉结尾的点和空格', () => {
    expect(sanitizeFileName('晴天...')).toBe('晴天')
    expect(sanitizeFileName('  晴天  ')).toBe('晴天')
  })

  it('超长名字按显示宽度截断（中文算 2 宽）', () => {
    const long = '一'.repeat(200)
    expect(clipBaseName(long).length).toBeLessThanOrEqual(60)
    expect(clipBaseName('short')).toBe('short')
  })

  it('音质映射扩展名', () => {
    expect(extForQuality('flac')).toBe('flac')
    expect(extForQuality('flac24bit')).toBe('flac')
    expect(extForQuality('320k')).toBe('mp3')
    expect(extForQuality('128k')).toBe('mp3')
    // 源明确给了容器类型时以它为准
    expect(extForQuality('320k', 'm4a')).toBe('m4a')
    expect(extForQuality('flac', 'ape')).toBe('ape')
  })
})

describe('下载队列', () => {
  it('加入任务后按并发上限启动', async () => {
    const { manager, transport } = makeManager()
    await manager.add([song('1', 'A'), song('2', 'B'), song('3', 'C')], '320k')
    await tick()
    expect(transport.started).toHaveLength(2)
    expect(manager.snapshot().filter(t => t.status === 'running')).toHaveLength(2)
    expect(manager.snapshot().filter(t => t.status === 'waiting')).toHaveLength(1)
  })

  it('一个完成后自动补上下一个', async () => {
    const { manager, transport } = makeManager()
    await manager.add([song('1', 'A'), song('2', 'B'), song('3', 'C')], '320k')
    await tick()
    // 新任务加在列表最前（与 lx 一致），所以先启动的是最后加的那首 ——
    // 用实际启动的 id，不要假设顺序
    const first = transport.started[0]!
    transport.finish(first)
    await tick()
    expect(transport.started).toHaveLength(3)
    expect(manager.snapshot().find(t => t.id === first)?.status).toBe('completed')
  })

  it('同一首重复加入不会产生两条任务', async () => {
    const { manager } = makeManager()
    await manager.add([song('1', 'A')], '320k')
    await manager.add([song('1', 'A')], '320k')
    expect(manager.snapshot()).toHaveLength(1)
  })

  it('不同音质算两个任务', async () => {
    const { manager } = makeManager()
    await manager.add([song('1', 'A')], '320k')
    await manager.add([song('1', 'A')], 'flac')
    expect(manager.snapshot()).toHaveLength(2)
  })

  it('进度上报后状态与百分比同步', async () => {
    const { manager, transport } = makeManager()
    await manager.add([song('1', 'A')], '320k')
    await tick()
    transport.pending.get('wy:1:320k')?.({ type: 'progress', downloaded: 250, total: 1000, speed: '2 MB/s' })
    const task = manager.snapshot()[0]!
    expect(task.downloaded).toBe(250)
    expect(task.progress).toBe(25)
    expect(task.speed).toBe('2 MB/s')
  })

  it('暂停会让传输层停下来，继续后重新排队', async () => {
    const { manager, transport } = makeManager()
    await manager.add([song('1', 'A')], '320k')
    await tick()
    await manager.pause('wy:1:320k')
    expect(transport.paused).toContain('wy:1:320k')
    expect(manager.snapshot()[0]!.status).toBe('paused')

    await manager.resume('wy:1:320k')
    await tick()
    expect(manager.snapshot()[0]!.status).toBe('running')
  })

  it('失败自动重试，超过 2 次才标红', async () => {
    const { manager, transport } = makeManager()
    await manager.add([song('1', 'A')], '320k')
    await tick()

    // 第 1 次失败 → 重试
    transport.failWith('wy:1:320k', { type: 'error', message: '连接被重置' })
    await tick()
    expect(manager.snapshot()[0]!.status).toBe('waiting')

    // 等退避（1s）后重试
    await new Promise(r => setTimeout(r, 1100))
    expect(transport.started).toHaveLength(2)

    transport.failWith('wy:1:320k', { type: 'error', message: '连接被重置' })
    await new Promise(r => setTimeout(r, 2100))
    expect(transport.started).toHaveLength(3)

    transport.failWith('wy:1:320k', { type: 'error', message: '连接被重置' })
    await tick()
    const task = manager.snapshot()[0]!
    expect(task.status).toBe('error')
    expect(task.error).toBe('连接被重置')
  }, 10000)

  it('没有写权限这类错误不重试（重试只是让用户多等）', async () => {
    const { manager, transport } = makeManager()
    await manager.add([song('1', 'A')], '320k')
    await tick()
    transport.failWith('wy:1:320k', { type: 'error', message: '磁盘已满', fatal: true })
    await tick()
    expect(manager.snapshot()[0]!.status).toBe('error')
    expect(transport.started).toHaveLength(1)
  })

  it('目录不可写时直接报错，不进入下载', async () => {
    const { manager, transport } = makeManager()
    transport.dirOk = false
    await manager.add([song('1', 'A')], '320k')
    await tick()
    expect(transport.started).toHaveLength(0)
    expect(manager.snapshot()[0]!.status).toBe('error')
  })

  it('源降级音质时扩展名跟着改（否则写出 .flac 实为 mp3）', async () => {
    const { manager } = makeManager({
      resolveStream: async task => ({ url: 'https://cdn.test/x', quality: '320k', type: 'mp3' }),
    })
    await manager.add([song('1', 'A')], 'flac')
    await tick()
    const task = manager.snapshot()[0]!
    expect(task.quality).toBe('flac')
    expect(task.resolvedQuality).toBe('320k')
    expect(task.ext).toBe('mp3')
    expect(task.fileName.endsWith('.mp3')).toBe(true)
  })

  it('删除任务会通知传输层清掉半截文件', async () => {
    const { manager, transport } = makeManager()
    await manager.add([song('1', 'A')], '320k')
    await tick()
    await manager.remove('wy:1:320k')
    expect(transport.removed).toContain('wy:1:320k')
    expect(manager.snapshot()).toHaveLength(0)
  })

  it('重启后正在跑的任务变成暂停，不会自动重新下载', async () => {
    const { manager } = makeManager()
    await manager.add([song('1', 'A'), song('2', 'B')], '320k')
    await tick()

    // 模拟进程重启：新 manager 读同一份存储
    const second = makeManager().manager
    await second.load()
    const statuses = second.snapshot().map(t => t.status)
    expect(statuses.every(s => s === 'paused' || s === 'waiting')).toBe(true)
    expect(statuses).not.toContain('running')
  })

  it('任务列表写进存储，重开还在', async () => {
    const { manager } = makeManager()
    await manager.add([song('1', 'A')], '320k')
    await tick()
    const second = makeManager().manager
    await second.load()
    expect(second.snapshot()).toHaveLength(1)
    expect(second.snapshot()[0]!.item.name).toBe('A')
  })

  it('开启「按歌单分目录」后，批量下载落到 <目录>/<歌单名>/', async () => {
    const { manager, transport } = makeManager({ subdirPerList: () => true })
    await manager.add([song('1', 'A')], '320k', { listName: '我喜欢的音乐' })
    await tick()
    expect(transport.requests[0]!.dir).toBe('C:/Music/我喜欢的音乐')
  })

  it('分目录开关关掉时，即使有歌单名也落在根目录', async () => {
    const { manager, transport } = makeManager({ subdirPerList: () => false })
    await manager.add([song('1', 'A')], '320k', { listName: '我喜欢的音乐' })
    await tick()
    expect(transport.requests[0]!.dir).toBe('C:/Music')
  })

  it('歌单名里的斜杠不会把目录写穿', async () => {
    const { manager, transport } = makeManager({ subdirPerList: () => true })
    await manager.add([song('1', 'A')], '320k', { listName: '../../etc' })
    await tick()
    // 斜杠被替换成下划线：子目录只有一段，无法穿越到下载目录之外
    const dir = transport.requests[0]!.dir
    expect(dir.startsWith('C:/Music/')).toBe(true)
    const sub = dir.slice('C:/Music/'.length)
    expect(sub).not.toMatch(/[\\/]/)
    expect(sub).not.toBe('..')
  })

  it('清空已完成只移除完成的任务', async () => {
    const { manager, transport } = makeManager()
    await manager.add([song('1', 'A'), song('2', 'B'), song('3', 'C')], '320k')
    await tick()
    transport.finish(transport.started[0]!)
    await tick()
    await manager.clearCompleted()
    expect(manager.snapshot()).toHaveLength(2)
    expect(manager.snapshot().every(t => t.status !== 'completed')).toBe(true)
  })
})
