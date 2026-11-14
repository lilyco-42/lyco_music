/**
 * 时长相关的小工具（零依赖，桌面端与移动端共用）。
 *
 * 为什么放内核：试听片段的判定逻辑在两端都要用，而且它是纯计算，
 * 放在这里才能被单测覆盖 —— 塞在 player.ts 里只能靠手动点歌验证。
 */

/** 'mm:ss' / 'hh:mm:ss' -> 秒；无法解析返回 0 */
export function intervalSeconds(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v !== 'string' || !v.includes(':')) return 0
  const parts = v.split(':').map(Number)
  if (parts.some(n => !Number.isFinite(n))) return 0
  return parts.reduce((acc, n) => acc * 60 + n, 0)
}

/**
 * 判断拿到的音频是不是「试听片段」。
 *
 * 取流阶段看不出来：接口给的是一个能正常播放的地址，只是内容只有 30 秒。
 * 只有等播放器报出 duration 才能发现。
 *
 * 判定要保守：
 *   - 原曲本来就很短（< 60s）时不做判断，避免把铃声/间奏当试听；
 *   - 只有明显短于原曲一半、且不超过 45 秒，才算试听。
 */
export function isTrialClip(actualSeconds: number, expectedSeconds: number): boolean {
  if (!Number.isFinite(actualSeconds) || actualSeconds <= 0) return false
  if (!Number.isFinite(expectedSeconds) || expectedSeconds < 60) return false
  return actualSeconds < Math.min(expectedSeconds * 0.5, 45)
}


/**
 * 所有音源都只给试听片段时的统一文案（桌面 / 移动端共用）。
 *
 * 以前写「该音源只提供试听片段」，用户以为压根没换过源；实际上
 * 此时已走过 内置音源 → 脚本音源 → 其他平台 → 试听重取 四轮。
 * 只在**彻底失败**时说明已尝试过，播放成功时依旧全程静默。
 */
export const TRIAL_EXHAUSTED_MESSAGE =
  '已自动尝试内置音源、脚本音源和其他平台，仍只拿到试听片段；完整版需要在对应平台开通会员，或在设置里导入可用音源'
