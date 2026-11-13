/**
 * 播放器模式的「来路」。
 *
 * 痛点：在搜索结果里点开某首歌 -> 底栏封面进播放器模式看歌词 -> 点左上角收起，
 * 直接掉回首页，搜索结果没了，得重新搜一遍。
 *
 * 原来 Player.vue 的 close() 写死 router.push({ name: 'home' })。改成记下
 * **进入播放器之前**的完整路径（含 ?q= 与滚动位置用的 query），收起时再回去。
 *
 * 为什么不用 router.back()：播放器模式是全屏独立界面，进入时是 push，
 * back() 理论上能退回去，但用户如果在播放器里点过「相似推荐」「歌手」之类
 * 会再 push 若干层，back() 只退一层，仍落在播放器相关页面。用一个显式记录的
 * 落点最稳，且不依赖历史栈有多深。
 */

/** 空串表示「没有记录」，调用方退回首页 */
let returnPath = ''

/** 记录来路。只接受站内绝对路径，防止被塞进外链 */
export function rememberReturnPath(path: string): string {
  const p = typeof path === 'string' ? path.trim() : ''
  // '#/search?q=x' 与 '/search?q=x' 都收，统一存成 hash 路由的 fullPath
  const clean = p.startsWith('#') ? p.slice(1) : p
  if (!clean.startsWith('/')) {
    returnPath = ''
    return returnPath
  }
  returnPath = clean
  return returnPath
}

/** 取出并清空（一次性消费，避免下次再进播放器时回到很久以前的页面） */
export function takeReturnPath(): string {
  const p = returnPath
  returnPath = ''
  return p
}

/** 只看不取（调试/测试用） */
export function peekReturnPath(): string {
  return returnPath
}

/** 丢弃记录（比如用户从播放器模式里主动跳去了别的页面） */
export function clearReturnPath(): void {
  returnPath = ''
}
