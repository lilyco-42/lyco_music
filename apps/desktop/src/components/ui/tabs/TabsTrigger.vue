<script setup lang="ts">
import { TabsTrigger, type TabsTriggerProps } from 'reka-ui'
import { computed } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<TabsTriggerProps & { class?: string }>()

// reka-ui 的 props 不含 class，先剥离再透传，避免类型冲突
const delegated = computed(() => {
  const { class: _class, ...rest } = props
  return rest
})
</script>

<template>
  <TabsTrigger
    v-bind="delegated"
    :class="cn(
      'inline-flex h-full items-center justify-center whitespace-nowrap rounded-tab px-4 text-[15px] text-ncmd-muted transition-colors',
      'data-[state=active]:bg-ncmd-elevated data-[state=active]:font-semibold data-[state=active]:text-ncmd-fg',
      props.class,
    )"
  >
    <slot />
  </TabsTrigger>
</template>
