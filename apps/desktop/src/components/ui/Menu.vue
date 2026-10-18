<script setup lang="ts">
/**
 * 下拉菜单（单选）。
 *
 * 为什么不用原生 <select>：需要图标、副标题、选中态勾选，而且要和深色播放页共用。
 * 为什么自己写而不是拉一个库：这里只有「单选菜单」一种形态，行为可枚举（点击外部关闭 /
 * Esc 关闭 / 上下键移动 / Enter 选中），自己实现反而比适配库 API 更可控。
 *
 * 无障碍：trigger 带 aria-haspopup/aria-expanded，列表 role="menu"，项 role="menuitemradio"。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { MenuItem } from './menu'

const props = withDefaults(defineProps<{
  items: MenuItem[]
  modelValue?: string
  /** 打开时对齐触发器的哪一侧 */
  align?: 'left' | 'right'
  /**
   * 展开方向。
   *
   * 顶栏在窗口最上沿，向上展开会被窗口边界裁掉（实测：主题色菜单只剩一条白边）。
   * 所以放在顶栏的菜单必须向下展开，放在底栏的向上展开。
   */
  placement?: 'top' | 'bottom'
  tone?: 'light' | 'dark'
  width?: string
}>(), { align: 'right', placement: 'top', tone: 'light', width: '180px' })

const emit = defineEmits<{ 'update:modelValue': [string] }>()

const open = ref(false)
const activeIndex = ref(-1)
const root = ref<HTMLElement | null>(null)

const currentIndex = computed(() => props.items.findIndex(i => i.value === props.modelValue))

function toggle(): void {
  open.value = !open.value
  if (open.value) activeIndex.value = currentIndex.value >= 0 ? currentIndex.value : 0
}

function close(): void {
  open.value = false
}

function choose(item: MenuItem): void {
  if (item.disabled) return
  emit('update:modelValue', item.value)
  close()
}

function move(step: number): void {
  const n = props.items.length
  if (!n) return
  let i = activeIndex.value
  for (let k = 0; k < n; k++) {
    i = (i + step + n) % n
    if (!props.items[i]?.disabled) break
  }
  activeIndex.value = i
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') { close(); return }
  if (!open.value) {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); toggle() }
    return
  }
  if (e.key === 'ArrowDown') { e.preventDefault(); move(1) }
  else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
  else if (e.key === 'Enter') {
    e.preventDefault()
    const item = props.items[activeIndex.value]
    if (item) choose(item)
  }
}

function onDocDown(e: MouseEvent): void {
  if (!open.value) return
  if (root.value && !root.value.contains(e.target as Node)) close()
}

watch(open, v => {
  if (v) document.addEventListener('mousedown', onDocDown)
  else document.removeEventListener('mousedown', onDocDown)
})
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocDown))
</script>

<template>
  <div ref="root" class="relative" @keydown="onKey">
    <slot name="trigger" :open="open" :toggle="toggle" :label="modelValue">
      <button
        type="button"
        class="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-[13px] transition-colors"
        :class="tone === 'dark' ? 'text-ncmd-muted hover:bg-white/10 hover:text-ncmd-fg' : 'text-ncm-faint hover:bg-black/5 hover:text-ncm-fg'"
        aria-haspopup="menu"
        :aria-expanded="open"
        @click="toggle"
      >
        <slot name="value">{{ items.find(i => i.value === modelValue)?.label }}</slot>
      </button>
    </slot>

    <div
      v-if="open"
      role="menu"
      class="absolute z-50 overflow-hidden rounded-xl border py-1 shadow-[0_12px_32px_rgba(0,0,0,.18)]"
      :class="[
        placement === 'bottom' ? 'top-full mt-2' : 'bottom-full mb-2',
        align === 'right' ? 'right-0' : 'left-0',
        tone === 'dark' ? 'border-ncmd-elevated bg-[#2a2a2a] text-ncmd-fg' : 'border-ncm-divider bg-white text-ncm-fg',
      ]"
      :style="{ width }"
    >
      <button
        v-for="(item, i) in items"
        :key="item.value"
        type="button"
        role="menuitemradio"
        :aria-checked="item.value === modelValue"
        :disabled="item.disabled"
        class="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-40"
        :class="[
          i === activeIndex ? (tone === 'dark' ? 'bg-white/10' : 'bg-black/5') : '',
          item.value === modelValue ? (tone === 'dark' ? 'text-white' : 'text-ncm-accent') : '',
        ]"
        @mouseenter="activeIndex = i"
        @click="choose(item)"
      >
        <span class="flex min-w-0 flex-col">
          <span class="truncate">{{ item.label }}</span>
          <span v-if="item.hint" class="truncate text-[11px] opacity-60">{{ item.hint }}</span>
        </span>
        <svg v-if="item.value === modelValue" viewBox="0 0 24 24" class="size-4 shrink-0 stroke-current" fill="none" stroke-width="2">
          <path d="M20 6L9 17l-5-5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
    </div>
  </div>
</template>
