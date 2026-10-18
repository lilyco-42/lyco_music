<script setup lang="ts">
import { TabsList, type TabsListProps } from 'reka-ui'
import { computed } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<TabsListProps & { class?: string }>()

// reka-ui 的 props 不含 class，先剥离再透传，避免类型冲突
const delegated = computed(() => {
  const { class: _class, ...rest } = props
  return rest
})
</script>

<template>
  <TabsList v-bind="delegated" :class="cn('inline-flex h-[42px] w-auto min-w-[222px] items-center gap-0.5 rounded-tab bg-ncmd-surface p-0.5', props.class)">
    <slot />
  </TabsList>
</template>
