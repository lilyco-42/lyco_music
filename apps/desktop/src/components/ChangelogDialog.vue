<script setup lang="ts">
/**
 * 升级后弹一次的更新日志（PARITY 6.10）。
 *
 * 三条克制：
 *   1. **只在版本变了之后弹一次**，靠 localStorage 里记的版本判断，
 *      不是每次启动都弹 —— 每次启动都弹的「更新日志」用户只会条件反射点掉。
 *   2. **首次安装不弹**：新用户不需要知道「本次更新了什么」。
 *   3. **拿不到 notes 也弹**：只显示版本号 + 去发布页。静默不弹的话，
 *      用户永远不知道这版改了什么，等于没做这个功能。
 *
 * 正文按纯文本渲染（`white-space: pre-wrap`），不做 Markdown 解析：
 * release notes 是外部内容，渲染 HTML 等于给注入开口子。
 */
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { ExternalLink, Sparkles } from 'lucide-vue-next'
import { useUpdater } from '@/lib/update'

const updater = useUpdater()

const open = computed(() => Boolean(updater.pendingChangelog.value))

/** release notes 里「## 新功能」这类标题行，给一点粗体感 */
function isHeading(line: string): boolean {
  return /^#{1,6}\s/.test(line.trim())
}

function cleanLine(line: string): string {
  return line.replace(/^#{1,6}\s*/, '').replace(/^\s*[-*]\s+/, '· ')
}

const lines = computed(() => {
  const notes = updater.pendingChangelog.value?.notes ?? ''
  // 去掉 HTML 注释与折叠标记（GitHub 自动生成的 changelog 里常有）
  return notes
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .slice(0, 60)
    .map(cleanLine)
})

function close(): void {
  updater.dismissChangelog()
}

function onKey(e: KeyboardEvent): void {
  if (!open.value) return
  if (e.key === 'Escape') close()
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 px-6"
    role="dialog"
    aria-modal="true"
    aria-label="更新日志"
    @click.self="close"
  >
    <div class="w-full max-w-[560px] overflow-hidden rounded-2xl bg-white shadow-2xl">
      <div class="flex items-center gap-2.5 border-b border-ncm-divider px-6 py-4">
        <Sparkles :size="20" class="text-ncm-accent" aria-hidden="true" />
        <div class="min-w-0 flex-1">
          <h2 class="text-[17px] font-semibold text-ncm-fg">更新到 v{{ updater.pendingChangelog.value?.version }}</h2>
          <p class="mt-0.5 text-[12px] text-ncm-faint">这是本版的主要改动</p>
        </div>
      </div>

      <div class="max-h-[46vh] overflow-y-auto px-6 py-4">
        <template v-if="lines.length">
          <p
            v-for="(line, i) in lines"
            :key="i"
            class="whitespace-pre-wrap text-[13px] leading-[22px]"
            :class="isHeading(line) ? 'mt-2 font-semibold text-ncm-fg' : 'text-ncm-muted'"
          >{{ line }}</p>
        </template>
        <p v-else class="text-[13px] leading-[22px] text-ncm-muted">
          这一版没有附带说明（或者取不到发布页）。点下面的按钮去发布页看完整记录。
        </p>
      </div>

      <div class="flex items-center gap-2 border-t border-ncm-divider px-6 py-3.5">
        <button
          type="button"
          class="flex items-center gap-1.5 rounded-full border border-ncm-divider px-4 py-1.5 text-[13px] text-ncm-muted hover:bg-ncm-bg"
          @click="updater.openDownload()"
        >
          <ExternalLink :size="14" aria-hidden="true" />发布页
        </button>
        <button
          type="button"
          class="ml-auto rounded-full bg-ncm-accent px-5 py-1.5 text-[13px] text-white transition-opacity hover:opacity-90"
          @click="close"
        >知道了</button>
      </div>
    </div>
  </div>
</template>
