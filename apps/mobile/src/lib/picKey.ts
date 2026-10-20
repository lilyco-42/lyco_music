/**
 * 封面去重用的归一化 key。
 *
 * 首页三张歌单卡各自搜一个关键词、拿结果里第一首的封面当卡面图，
 * 所以要判断「这张图是不是已经用过了」。直接比 URL 不行，各音源
 * 表达尺寸的方式不一样：
 *
 * - wy / kg 把尺寸放在 query 里：`...?param=300y300` / `...?param=130y130`
 * - kw 把尺寸放在路径里：`.../star/albumcover/500/s3s94/93/xxx.jpg`
 *
 * 两种都要抹掉。否则同一张图会被当成两张，几张卡就撞成同一张脸。
 */
export function picKey(url: string): string {
  return url.replace(/\?.*$/, '').replace(/(\/albumcover\/)\d+\//, '$1')
}
