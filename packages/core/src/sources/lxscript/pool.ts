/**
 * 音源池 —— 多个 lx 脚本的调度与自动切换
 *
 * 用户的要求是：「就算是 VIP 总有音乐源支持」「怎么方便听歌怎么来」。
 * 单个脚本随时可能失效（作者停更、接口被封），所以真正的可靠性来自
 * **多个独立脚本 + 自动降级**，而不是祈祷某一个永远活着。
 *
 * 调度策略（对用户完全透明）：
 *   1. 按服务端下发的 order 排序，也可以按历史成功率动态调整；
 *   2. 依次尝试，任何一个返回可播地址就停；
 *   3. 记录成功/失败次数，下次优先用更靠谱的源；
 *   4. 全部失败才报错。
 *
 * 注意：这里**不做**「同一个脚本内换音质」——那由脚本自己处理。
 * 我们只负责「这个脚本这条路不通，换下一个脚本」。
 */

import { LxScript, type LxMusicInfo, type LxSourceId } from './runtime'
import type { Quality, SourceId } from '../../types'

export interface PoolEntry {
  /** 唯一标识，通常是脚本名+版本 */
  id: string
  /** 展示名 */
  name: string
  /** 脚本源码 */
  code: string
  /** 服务端给的顺序，越小越先试 */
  order?: number
  /** 服务端可远程禁用 */
  enabled?: boolean
}

interface EntryState {
  entry: PoolEntry
  script: LxScript
  ok: number
  fail: number
  /** 连续失败次数，用来临时降权 */
  streak: number
  lastError?: string
}

export interface PoolResult {
  url: string
  /** 实际提供地址的音源脚本 id */
  by: string
  /** 该脚本自报支持的平台 */
  source: SourceId
}

/**
 * 音源池。
 *
 * 有意做成「懒加载」：只有真的要取流时才执行脚本。
 * 订阅里可能有 10 个源，但用户听一首歌只需要其中一个 ——
 * 提前把 10 个脚本全跑一遍既慢又浪费。
 */
export class SourcePool {
  private states = new Map<string, EntryState>()

  /** 用最新的订阅清单替换池内容（保留历史成功率） */
  sync(entries: PoolEntry[]): void {
    const keep = new Set<string>()
    for (const e of entries) {
      keep.add(e.id)
      const existing = this.states.get(e.id)
      if (existing && existing.entry.code === e.code) {
        // 脚本没变，只更新顺序与开关
        existing.entry.order = e.order
        existing.entry.enabled = e.enabled
      } else {
        // 新脚本或版本变了：旧实例作废
        this.states.set(e.id, {
          entry: e,
          script: new LxScript(e.id, e.code),
          ok: existing?.ok ?? 0,
          fail: existing?.fail ?? 0,
          streak: 0,
        })
      }
    }
    for (const id of [...this.states.keys()]) {
      if (!keep.has(id)) this.states.delete(id)
    }
  }

  /** 当前池里有哪些脚本（用于设置页展示，不执行代码） */
  list(): Array<{ id: string; name: string; order: number; enabled: boolean; ok: number; fail: number; lastError?: string }> {
    return [...this.states.values()]
      .map((s) => ({
        id: s.entry.id,
        name: s.entry.name,
        order: s.entry.order ?? 100,
        enabled: s.entry.enabled !== false,
        ok: s.ok,
        fail: s.fail,
        lastError: s.lastError,
      }))
      .sort((a, b) => a.order - b.order)
  }

  /**
   * 按优先级排出的候选。
   *
   * 排序依据：显式 order 为主，连续失败次数为辅。
   * 一个源刚刚连续失败 3 次，就算它 order 靠前也先让给别人 ——
   * 用户不该为「我们配置里的顺序」反复等待超时。
   */
  private ranked(source: SourceId): EntryState[] {
    return [...this.states.values()]
      .filter((s) => s.entry.enabled !== false)
      .sort((a, b) => {
        const oa = (a.entry.order ?? 100) + a.streak * 10
        const ob = (b.entry.order ?? 100) + b.streak * 10
        return oa - ob
      })
      .filter((s) => {
        // 没初始化过就先放行（load 时会判断 supports）
        return s.script.state === 'idle' || s.script.state === 'ready' || s.script.state === 'error'
      })
  }

  /**
   * 取流：依次问每个脚本，谁先给出可播地址就用谁。
   *
   * 全部失败时抛最后一个错误 —— 但把每个源失败的原因拼进去，
   * 这样线上排查时能看出是「脚本全挂」还是「这首歌真的没有」。
   */
  async getMusicUrl(
    source: SourceId,
    musicInfo: LxMusicInfo,
    quality: Quality,
    opts: { timeoutMs?: number } = {},
  ): Promise<PoolResult> {
    const candidates = this.ranked(source)
    if (!candidates.length) throw new Error('[lxmn/lx] 没有可用的音源脚本')

    const errors: string[] = []
    for (const st of candidates) {
      const ready = await st.script.load(opts.timeoutMs ?? 8000)
      if (!ready) {
        st.lastError = st.script.error ?? '初始化失败'
        errors.push(st.entry.name + ': ' + st.lastError)
        continue
      }
      if (!st.script.supports(source)) continue

      try {
        const url = await st.script.getMusicUrl(source, musicInfo, quality)
        st.ok += 1
        st.streak = 0
        st.lastError = undefined
        return { url, by: st.entry.id, source }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        st.fail += 1
        st.streak += 1
        st.lastError = msg
        errors.push(st.entry.name + ': ' + msg)
      }
    }
    throw new Error('[lxmn/lx] 所有音源脚本都无法提供该歌曲：' + errors.slice(0, 3).join(' | '))
  }
}

/** 全局单例：订阅变更时 sync 一次即可 */
export const sourcePool = new SourcePool()
