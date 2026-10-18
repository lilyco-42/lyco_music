<script setup lang="ts">
/**
 * 音质选择器。
 *
 * 以前底栏那个「极高 +」是个盲切按钮：点一下换下一档，用户看不到有哪些档、
 * 也不知道当前是第几档。这里改成下拉，列出当前音源真正支持的全部音质。
 */
import { computed } from 'vue'
import Menu from '@/components/ui/Menu.vue'
import type { MenuItem } from '@/components/ui/menu'
import { usePlayer } from '@/lib/player'
import type { Quality } from '@lxmn/core'

withDefaults(defineProps<{ tone?: 'light' | 'dark' }>(), { tone: 'light' })

const player = usePlayer()

const LABELS: Record<string, string> = {
  '128k': '标准',
  '320k': '极高',
  flac: '无损',
  flac24bit: 'Hi-Res',
  hires: 'Hi-Res',
  atmos: '沉浸环绕',
  master: '超清母带',
}
const HINTS: Record<string, string> = {
  '128k': '128 kbps',
  '320k': '320 kbps',
  flac: 'FLAC',
  flac24bit: 'FLAC 24bit',
  hires: 'Hi-Res Lossless',
  atmos: 'Dolby Atmos',
  master: 'Master Quality',
}

const items = computed<MenuItem[]>(() =>
  player.qualityOrder.map(q => ({
    value: q,
    label: LABELS[q] ?? q,
    hint: HINTS[q] ?? '',
  })))

const current = computed(() => LABELS[player.state.quality] ?? player.state.quality)

async function select(value: string): Promise<void> {
  await player.setQuality(value as Quality)
}
</script>

<template>
  <Menu
    :items="items"
    :model-value="player.state.quality"
    :tone="tone"
    align="right"
    width="200px"
    @update:model-value="select"
  >
    <template #trigger="{ open, toggle }">
      <button
        type="button"
        class="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[13px] transition-colors"
        :class="tone === 'dark'
          ? 'text-ncmd-muted hover:bg-white/10 hover:text-ncmd-fg'
          : 'text-ncm-faint hover:bg-black/5 hover:text-ncm-fg'"
        :aria-label="'音质：' + current"
        aria-haspopup="menu"
        :aria-expanded="open"
        @click="toggle"
      >
        {{ current }}
        <svg viewBox="0 0 24 24" class="size-3.5 stroke-current" fill="none" stroke-width="2" aria-hidden="true">
          <path d="M6 15l6-6 6 6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
    </template>
  </Menu>
</template>
