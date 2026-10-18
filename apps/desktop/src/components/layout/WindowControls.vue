<script setup lang="ts">
/**
 * 窗口控制按钮（最小化 / 最大化 / 关闭）。
 *
 * 窗口是无边框的（main.cjs 里 frame: false），所以页面必须自己提供这三个按钮，
 * 否则用户没法放大缩小关闭。按钮只在 Electron 里生效；浏览器里运行时不渲染。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'

const props = withDefaults(defineProps<{ tone?: 'light' | 'dark' }>(), { tone: 'light' })

const bridge = typeof window !== 'undefined' ? window.lxmnNative?.win : undefined
const available = Boolean(bridge)
const maximized = ref(false)
let off: (() => void) | null = null

onMounted(async () => {
  if (!bridge) return
  maximized.value = await bridge.isMaximized().catch(() => false)
  off = bridge.onMaximizeChange(v => { maximized.value = v })
})
onBeforeUnmount(() => { off?.() })

function minimize(): void { void bridge?.minimize() }
function toggleMax(): void { void bridge?.toggleMaximize().then(v => { maximized.value = v }) }
function close(): void { void bridge?.close() }

// 窗口按钮：命中区贴边、去掉系统默认焦点框（Electron 下是一条橙黄描边），
// 改用和全站一致的 accent 焦点环
const base = 'flex h-8 w-[46px] items-center justify-center transition-colors outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 [app-region:no-drag]'
const idle = props.tone === 'dark'
  ? 'text-white/60 hover:bg-white/10 hover:text-white'
  : 'text-ncm-faint hover:bg-black/5 hover:text-ncm-fg'
</script>

<template>
  <div v-if="available" class="hidden items-center sm:flex">
    <button type="button" :class="[base, idle]" aria-label="最小化" @click="minimize">
      <svg viewBox="0 0 12 12" class="size-3 stroke-current" stroke-width="1.2"><path d="M2 6h8" /></svg>
    </button>
    <button type="button" :class="[base, idle]" :aria-label="maximized ? '还原' : '最大化'" @click="toggleMax">
      <svg v-if="maximized" viewBox="0 0 12 12" class="size-3 stroke-current" fill="none" stroke-width="1.2">
        <rect x="2.5" y="3.5" width="6" height="6" />
        <path d="M4 3.5V2.5h5.5V8H9" />
      </svg>
      <svg v-else viewBox="0 0 12 12" class="size-3 stroke-current" fill="none" stroke-width="1.2">
        <rect x="2.5" y="2.5" width="7" height="7" />
      </svg>
    </button>
    <button
      type="button"
      :class="[base, props.tone === 'dark' ? 'text-white/60 hover:bg-[#c42b1c] hover:text-white' : 'text-ncm-faint hover:bg-[#c42b1c] hover:text-white']"
      aria-label="关闭"
      @click="close"
    >
      <svg viewBox="0 0 12 12" class="size-3 stroke-current" stroke-width="1.2"><path d="M3 3l6 6M9 3l-6 6" /></svg>
    </button>
  </div>
</template>
