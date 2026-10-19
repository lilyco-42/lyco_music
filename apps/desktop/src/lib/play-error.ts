/**
 * 播放失败的分类与文案。
 *
 * 单独成文件的原因：这是**纯函数**，不需要 <audio> 也不需要 Vue，
 * 可以直接单测。播放链路的容错逻辑全靠这两个判断，值得被测住：
 *   - 判错「可重试」会让一次地址过期变成一句报错；
 *   - 判错「不可重试」会让网络断了的情况白等三次重试。
 */

/**
 * 判断这个错误值不值得重取。
 *
 * 只有「拿到的音频打不开」才重试：地址过期、CDN 403、格式不被支持。
 * 自动播放被拦（NotAllowedError）重试也没用，网络整体断了重试更是白等。
 */
export function isRetriablePlayError(e: unknown): boolean {
  const name = e instanceof Error ? e.name : ''
  const msg = e instanceof Error ? e.message : String(e ?? '')
  if (/NotAllowedError|AbortError/i.test(name + msg)) return false
  // Chromium 的媒体错误原文，最常见的就是 "no supported source was found"
  if (/NotSupportedError/i.test(name)) return true
  if (/no supported source|Failed to load|MEDIA_ERR|MEDIA_ELEMENT/i.test(msg)) return true
  // 取流阶段的「这个源放不了」同样值得换源
  if (/VIP 专享|试听|无可播放|暂无|版权|下架|缺少|not found|no.*url|占位/i.test(msg)) return true
  return false
}

/**
 * 把底层错误翻成人话。
 *
 * 以前这里直接把 `e.message` 塞给界面，于是用户看到的是 Chromium 的原话
 * "Failed to load because no supported source was found."。
 * 用户不需要知道是哪个 C++ 枚举，他需要知道「接下来能做什么」。
 */
export function describePlayError(e: unknown): string {
  const name = e instanceof Error ? e.name : ''
  const msg = e instanceof Error ? e.message : String(e ?? '')
  if (/NotAllowedError/i.test(name + msg)) return '系统拦截了自动播放，点一下播放按钮即可'
  if (/NotSupportedError/i.test(name) || /no supported source/i.test(msg)) {
    return '这个音源的地址打不开（可能已过期），已自动换过音源仍不行，稍后再试'
  }
  if (/AbortError/i.test(name + msg)) return '加载被中断，点一下播放按钮重试'
  if (/Network|Failed to fetch|timeout|ECONN|ENOTFOUND/i.test(msg)) return '网络异常，检查网络后重试'
  if (/VIP 专享|试听/.test(msg)) return '该音源只提供试听片段，完整版需要在对应平台开通会员'
  if (/占位/.test(msg)) return '该音源没有这首歌的可播放版本，换个音源试试'
  if (/版权|下架|暂无可播放|暂无/.test(msg)) return '各音源都没有这首歌的可播放版本，换首歌试试'
  // 兜底：至少别把内部前缀暴露给用户
  return msg.replace(/^\[lxmn\/[a-z]+\]\s*/i, '') || '播放失败，请重试'
}
