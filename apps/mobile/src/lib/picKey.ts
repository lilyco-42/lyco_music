/**
 * 封面去重用的归一化 key。
 *
 * 首页三张歌单卡各自搜一个关键词、拿结果里第一首的封面当卡面图，
 * 所以要判断「这张图是不是已经用过了」。直接比 URL 不行，实测踩到三个坑：
 *
 * 1. 尺寸参数：wy / kg 放在 query 里（`?param=300y300` / `?param=130y130`），
 *    kw 放在路径里（`/star/albumcover/500/...`）。
 * 2. **同一张图会给不同 CDN 主机**：网易把 `p1.music.126.net` 和
 *    `p2.music.126.net` 混着返回，路径完全一样。实测「热门」和「华语流行」
 *    的第一名都是《罗生门》，但一个 p1 一个 p2 —— 只抹尺寸的话两张卡照样撞图。
 * 3. 协议：同一张图 http / https 都出现过。
 *
 * 三样都抹掉，只留下「主机（去掉 CDN 编号）+ 路径 + 文件名」。
 */
export function picKey(url: string): string {
  return url
    .replace(/\?.*$/, '') // 尺寸 query
    .replace(/^https?:\/\//i, '') // 协议
    .replace(/^p\d+\.music\.126\.net\//i, 'music.126.net/') // 网易多 CDN 主机
    .replace(/(\/albumcover\/)\d+\//, '$1') // kw 把尺寸放在路径里
}
