/**
 * 交互安全网。
 *
 * 背景：真机上「点按钮直接闪退」。RN 在 release 包里没有红屏，事件回调里
 * 任何未捕获异常都会把 JS 线程干掉，表现就是「点一下就退出」。
 *
 * 这里做两件事：
 *   1. 把回调包一层 try/catch（含 Promise 拒绝），异常不再升级为崩溃；
 *   2. 把最近若干条错误留在内存里，配合 ErrorBoundary 显示出来，
 *      用户截图就能告诉我们真正的报错，而不是只有「闪退了」。
 */

export interface AppErrorRecord {
  label: string
  message: string
  stack?: string
  at: number
}

const MAX = 20
const records: AppErrorRecord[] = []
const listeners = new Set<() => void>()

export function recordError(label: string, error: unknown): AppErrorRecord {
  const e = error as { message?: string; stack?: string }
  const rec: AppErrorRecord = {
    label,
    message: e?.message ? String(e.message) : String(error),
    stack: e?.stack ? String(e.stack) : undefined,
    at: Date.now(),
  }
  records.unshift(rec)
  if (records.length > MAX) records.length = MAX
  // eslint-disable-next-line no-console
  console.error('[lyco] ' + label + ':', rec.message)
  for (const l of listeners) l()
  return rec
}

export function errorRecords(): AppErrorRecord[] {
  return records
}

export function subscribeErrors(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/**
 * 把事件回调包成「不会崩」的形式。
 * 同步异常和 Promise 拒绝都会被记录，控制流继续。
 */
export function safe<A extends unknown[]>(
  label: string,
  fn: (...args: A) => unknown,
): (...args: A) => void {
  return (...args: A) => {
    try {
      const ret = fn(...args)
      if (ret && typeof (ret as Promise<unknown>).then === 'function') {
        ;(ret as Promise<unknown>).catch((e: unknown) => { recordError(label, e) })
      }
    } catch (e) {
      recordError(label, e)
    }
  }
}
