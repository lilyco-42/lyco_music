/**
 * QMC 解密（QQ 音乐 .qmc0 / .qmc3 / .qmcflac / .qmcogg）
 *
 * 这类文件没有文件头，整个文件都是音频密文：密钥流由 SEED_MAP 上的蛇形遍历
 * 生成（128 字节一轮），逐字节异或；位置超过 0x7FFF 时按 0x7FFF 取模
 * —— 这是老实现的边界行为，去掉就会在长文件里花屏。
 *
 * .mflac / .mgg（QMCv2）需要先从文件里解出 per-file ekey，暂未支持，
 * 导入页会明确提示，而不是静默跳过。
 */
const tables = require('./decoder-tables.cjs')
const SEED_MAP = tables.SEED_MAP

class QmcSeed {
  constructor() {
    this.x = -1
    this.y = 8
    this.dx = 1
    this.index = -1
  }

  nextMask() {
    this.index++
    let ret
    if (this.x < 0) {
      this.dx = 1
      this.y = (8 - this.y) % 8
      ret = 0xc3
    } else if (this.x > 6) {
      this.dx = -1
      this.y = 7 - this.y
      ret = 0xd8
    } else {
      ret = SEED_MAP[this.y][this.x]
    }
    this.x += this.dx
    if (this.index === 0x8000 || (this.index > 0x8000 && (this.index + 1) % 0x8000 === 0)) return this.nextMask()
    return ret
  }
}

/** 128 字节密钥流；QMCv1 是静态密码，所有文件相同 */
function buildKey() {
  const seed = new QmcSeed()
  const key = Buffer.alloc(128)
  for (let i = 0; i < 128; i++) key[i] = seed.nextMask()
  return key
}

const EXT_FORMAT = {
  qmc0: 'mp3',
  qmc3: 'mp3',
  qmcflac: 'flac',
  qmcogg: 'ogg',
  bkc: 'mp3',
  bkcmp3: 'mp3',
  bkcflac: 'flac',
  bkcogg: 'ogg',
}

function decodeQmc(buf, ext) {
  try {
    if (!Buffer.isBuffer(buf) || buf.length < 16) return { ok: false, error: '文件太小' }
    const format = EXT_FORMAT[String(ext || '').toLowerCase()]
    if (!format) return { ok: false, error: '未知的 QMC 扩展名' }
    const key = buildKey()
    const audio = Buffer.from(buf)
    for (let i = 0; i < audio.length; i++) {
      const o = i > 0x7fff ? i % 0x7fff : i
      audio[i] ^= key[o % 128]
    }
    return { ok: true, audio, format }
  } catch (error) {
    return { ok: false, error: error && error.message ? error.message : '解密失败' }
  }
}

module.exports = { decodeQmc, buildKey }
