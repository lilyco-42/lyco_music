<script setup lang="ts">
/**
 * 图标按钮 —— 全局统一的「只有图标」按钮。
 *
 * 之前每个页面各写一个 <button> + 内联 SVG，于是同一排图标尺寸/粗细/热区都不一样，
 * 点了也看不出反馈。这里把规格收敛到一处：
 *   - 命中区固定（默认 36px，大号 44px），图标本身按 token 取尺寸
 *   - 统一 hover / active / disabled / focus-visible 表现
 *   - 强制 aria-label：纯图标按钮没有文字，缺标签对读屏就是「按钮」
 */
withDefaults(defineProps<{
  label: string
  /** md: 18px 图标；lg: 20px；xl: 22px；2xl: 26px（上一首/下一首） */
  size?: 'md' | 'lg' | 'xl' | '2xl'
  /** 命中区尺寸，默认标准 36px */
  hit?: 'md' | 'lg'
  disabled?: boolean
  /** 深色底（播放器模式）用深色变体 */
  tone?: 'light' | 'dark'
}>(), { size: 'lg', hit: 'md', disabled: false, tone: 'light' })

/**
 * 必须显式声明 emits。
 *
 * 不声明时 Vue 会把父组件的 @click 当成原生监听器挂到根 <button> 上，
 * 而组件内部又 $emit('click') 一次 —— 结果一次点击触发两次处理
 * （实测表现是播放模式一次跳两档）。
 */
const emit = defineEmits<{ click: [MouseEvent] }>()

const ICON_PX: Record<string, number> = { md: 18, lg: 20, xl: 22, '2xl': 26 }
</script>

<template>
  <button
    type="button"
    :disabled="disabled"
    :aria-label="label"
    :title="label"
    class="inline-flex shrink-0 items-center justify-center rounded-lg transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
    :class="[
      hit === 'lg' ? 'size-[44px]' : 'size-[36px]',
      tone === 'dark'
        ? 'text-ncmd-muted hover:bg-white/10 hover:text-ncmd-fg focus-visible:outline-white/40'
        : 'text-ncm-faint hover:bg-black/5 hover:text-ncm-fg focus-visible:outline-ncm-accent',
    ]"
    @click="emit('click', $event)"
  >
    <slot :size="ICON_PX[size]" :stroke="1.8" />
  </button>
</template>
