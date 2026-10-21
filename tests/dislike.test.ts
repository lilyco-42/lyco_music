/**
 * 「不喜欢的歌曲」规则解析与匹配。
 *
 * 断言的是**用户可见的行为**，不是实现细节：
 * 用户写 `晴天@周杰伦`，播放到周杰伦的晴天就该被跳过；
 * 写 `@周杰伦`，他的所有歌都跳过；写 `晴天`，所有叫晴天的都跳过。
 *
 * 规则文本格式与 lx-music-desktop v2.12.6 的 `store/dislikeList` 完全一致，
 * 所以从 lx 导出的规则能直接粘进来 —— 这一条单独有测试。
 */
import { describe, it, expect } from 'vitest'
import {
  DISLIKE_ALIAS, DISLIKE_SPLIT,
  parseDislikeRules, hasDislike, ruleOf, addDislikeRules, removeDislikeRule,
  ruleLines, linesToRules, mergeRuleText,
} from '@lxmn/core'

const song = (name: string, singer: string) => ({ name, singer })

describe('规则解析', () => {
  it('三种写法分别落进三类集合', () => {
    const idx = parseDislikeRules([
      '晴天@周杰伦',   // 精确到一首
      '学猫叫',        // 只写歌名
      '@薛之谦',       // 只写艺术家
    ].join('\n'))

    expect(idx.names.has('晴天@周杰伦')).toBe(true)
    expect(idx.musicNames.has('学猫叫')).toBe(true)
    expect(idx.singerNames.has('薛之谦')).toBe(true)
    expect(idx.count).toBe(3)
    expect(idx.lines).toEqual(['晴天@周杰伦', '学猫叫', '@薛之谦'])
  })

  it('大小写与首尾空白都归一化', () => {
    const idx = parseDislikeRules('  Hello  @  Adele  \n\n  HELLO@adele  ')
    expect(idx.count).toBe(1)
    expect(idx.lines).toEqual(['hello@adele'])
  })

  it('重复规则只算一条，且保持首次出现的顺序', () => {
    const idx = parseDislikeRules('b@x\na@y\nb@x')
    expect(idx.lines).toEqual(['b@x', 'a@y'])
    expect(idx.count).toBe(2)
  })

  it('歌名里带 @ 时用 # 转义，解析后与数据的归一化方式一致', () => {
    // 用户想把歌名「A@B」整首屏蔽，规则得写成 A#B
    const idx = parseDislikeRules('A#B')
    expect(idx.musicNames.has('a#b')).toBe(true)
    // 数据里这首歌的 name 就是 'A@B'，归一化后同样是 'a#b'
    expect(hasDislike(idx, song('A@B', '某某'))).toBe(true)
  })

  it('非法行被丢弃而不是报错（用户正在输入时必然出现半截内容）', () => {
    const idx = parseDislikeRules('@\n\n   \n晴天@周杰伦')
    expect(idx.lines).toEqual(['晴天@周杰伦'])
    expect(idx.count).toBe(1)
  })

  it('空输入返回空索引', () => {
    for (const input of ['', '   ', '\n\n', null, undefined]) {
      const idx = parseDislikeRules(input as string)
      expect(idx.count).toBe(0)
      expect(idx.lines).toEqual([])
    }
  })
})

describe('匹配', () => {
  const idx = parseDislikeRules('晴天@周杰伦\n学猫叫\n@薛之谦')

  it('精确规则只命中那首歌，不同歌手不误伤', () => {
    expect(hasDislike(idx, song('晴天', '周杰伦'))).toBe(true)
    // 同名不同人（例如翻唱）不该被屏蔽
    expect(hasDislike(idx, song('晴天', '某翻唱歌手'))).toBe(false)
  })

  it('只写歌名时，任何歌手的同名曲都命中', () => {
    expect(hasDislike(idx, song('学猫叫', '小潘潘'))).toBe(true)
    expect(hasDislike(idx, song('学猫叫', '随便谁'))).toBe(true)
  })

  it('只写艺术家时，他的所有歌都命中', () => {
    expect(hasDislike(idx, song('演员', '薛之谦'))).toBe(true)
    expect(hasDislike(idx, song('认真的雪', '薛之谦'))).toBe(true)
  })

  it('大小写与空格不影响命中', () => {
    const i2 = parseDislikeRules('rolling in the deep@adele')
    expect(hasDislike(i2, song('Rolling In The Deep', 'Adele'))).toBe(true)
    expect(hasDislike(i2, song('  Rolling In The Deep ', ' ADELE '))).toBe(true)
  })

  it('不相关的歌不会被误伤', () => {
    expect(hasDislike(idx, song('稻香', '周杰伦'))).toBe(false)
    expect(hasDislike(idx, song('晴天', '周杰伦/费玉清'))).toBe(false)
  })

  it('空索引 / 空目标一律 false，不抛错', () => {
    expect(hasDislike(null, song('晴天', '周杰伦'))).toBe(false)
    expect(hasDislike(parseDislikeRules(''), song('晴天', '周杰伦'))).toBe(false)
    expect(hasDislike(idx, null)).toBe(false)
    expect(hasDislike(idx, {})).toBe(false)
  })
})

describe('增删规则', () => {
  it('追加一首歌返回归一化文本，重复添加不会产生两行', () => {
    const once = addDislikeRules('', [song('晴天', '周杰伦')])
    expect(once).toBe('晴天@周杰伦')
    const twice = addDislikeRules(once, [song('晴天', '周杰伦')])
    expect(twice).toBe('晴天@周杰伦')
    expect(ruleLines(twice)).toHaveLength(1)
  })

  it('歌手为空时退化成单边规则', () => {
    expect(addDislikeRules('', [song('纯音乐', '')])).toBe('纯音乐')
    expect(addDislikeRules('', [song('', '薛之谦')])).toBe('@薛之谦')
    expect(addDislikeRules('', [song('', '')])).toBe('')
  })

  it('删除只移除完全匹配的那一条，同类规则保留', () => {
    const text = '晴天@周杰伦\n晴天\n@周杰伦'
    const after = removeDislikeRule(text, song('晴天', '周杰伦'))
    expect(ruleLines(after)).toEqual(['晴天', '@周杰伦'])
  })

  it('ruleOf 与 hasDislike 互为逆运算', () => {
    const cases = [
      song('晴天', '周杰伦'),
      song('学猫叫', ''),
      song('', '薛之谦'),
      song('A@B', 'C'),
    ]
    for (const target of cases) {
      const idx = parseDislikeRules(ruleOf(target))
      expect(hasDislike(idx, target), JSON.stringify(target)).toBe(true)
    }
  })
})

describe('同步用的文本 ↔ 数组', () => {
  it('往返不丢规则', () => {
    const text = '晴天@周杰伦\n学猫叫\n@薛之谦'
    expect(linesToRules(ruleLines(text))).toBe(text)
  })

  it('合并取并集，双方独有的都保留', () => {
    const a = '晴天@周杰伦\n学猫叫'
    const b = '@薛之谦\n学猫叫'
    const merged = mergeRuleText(a, b)
    expect(ruleLines(merged).sort()).toEqual(['@薛之谦', '学猫叫', '晴天@周杰伦'].sort())
  })

  it('合并的交换律成立（结果集合相同，与先后无关）', () => {
    const a = '晴天@周杰伦\n学猫叫'
    const b = '@薛之谦\n稻香@周杰伦'
    const ab = ruleLines(mergeRuleText(a, b)).sort()
    const ba = ruleLines(mergeRuleText(b, a)).sort()
    expect(ab).toEqual(ba)
  })

  it('空值参与合并不污染结果', () => {
    expect(mergeRuleText('', '晴天')).toBe('晴天')
    expect(mergeRuleText('晴天', '')).toBe('晴天')
    expect(mergeRuleText('', '')).toBe('')
  })
})

describe('与 lx-music 的规则文本兼容', () => {
  it('lx 的示例规则原样可用', () => {
    // lx 设置页里的示例：歌曲名@艺术家 / 歌曲名 / @艺术家
    const idx = parseDislikeRules([
      '起风了@买辣椒也用券',
      '学猫叫',
      '@大张伟',
    ].join('\n'))
    expect(idx.count).toBe(3)
    expect(hasDislike(idx, song('起风了', '买辣椒也用券'))).toBe(true)
    expect(hasDislike(idx, song('学猫叫', '小潘潘'))).toBe(true)
    expect(hasDislike(idx, song('倍儿爽', '大张伟'))).toBe(true)
  })

  it('常量与 lx 一致（@ 是分隔符，# 是转义）', () => {
    expect(DISLIKE_SPLIT).toBe('@')
    expect(DISLIKE_ALIAS).toBe('#')
  })
})
