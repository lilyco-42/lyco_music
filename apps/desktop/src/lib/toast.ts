/**
 * 一句话提示（toast）
 *
 * 下载、导出这类操作的结果必须给反馈：用户点完没有任何反应，
 * 他会以为功能坏了，然后再点三次。
 *
 * 用模块级 ref 而不是 provide/inject，是因为这些提示都发生在
 * 「离根组件很远」的地方（底栏菜单、播放页），跨层级传 prop 反而更绕。
 */
import { ref } from 'vue'

export const toastText = ref('')

let timer: ReturnType<typeof setTimeout> | undefined

export function toast(message: string, ms = 2800): void {
  toastText.value = message
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    toastText.value = ''
    timer = undefined
  }, ms)
}
