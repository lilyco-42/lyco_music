<script setup lang="ts">
/**
 * 下载管理（桌面端）
 *
 * 队列逻辑在 `@lxmn/core` 的 DownloadManager 里，落盘在 Electron 主进程，
 * 这个页面只负责显示与操作。
 *
 * 为什么进度条不用 <progress>：它的样式在各平台差异太大，而且没法
 * 做「已完成变绿、失败变红」的语义色。用两个 div 反而更可控。
 */
import { computed } from 'vue'
import {
  AlertCircle, CheckCircle2, Clock, FolderOpen, Loader2, Pause, Play, Trash2,
} from 'lucide-vue-next'
import { NAME_FORMATS, type DownloadTask } from '@lxmn/core'
import { useDownloads } from '@/lib/downloads'

const {
  tasks, settings, activeCount, waitingCount, completedCount,
  pause, resume, remove, pauseAll, resumeAll, clearCompleted,
  saveSettings, pickDir, openDir,
} = useDownloads()

const formats = NAME_FORMATS

function statusText(task: DownloadTask): string {
  switch (task.status) {
    case 'waiting': return '等待中'
    case 'running': return task.speed ? `下载中 ${task.speed}` : '下载中'
    case 'paused': return '已暂停'
    case 'completed': return '已完成'
    case 'error': return task.error || '下载失败'
  }
}

function statusColor(task: DownloadTask): string {
  switch (task.status) {
    case 'completed': return 'text-emerald-600'
    case 'error': return 'text-red-500'
    case 'paused': return 'text-ncm-faint'
    default: return 'text-ncm-muted'
  }
}

function barColor(task: DownloadTask): string {
  if (task.status === 'completed') return 'bg-emerald-500'
  if (task.status === 'error') return 'bg-red-400'
  if (task.status === 'paused') return 'bg-ncm-fainter'
  return 'bg-ncm-accent'
}

function sizeText(task: DownloadTask): string {
  if (!task.total) return ''
  const mb = (n: number) => (n / 1024 / 1024).toFixed(n > 1024 * 1024 * 100 ? 0 : 1)
  return `${mb(task.downloaded)} / ${mb(task.total)} MB`
}

/** 同名文件可能已被用户改名或删掉，这里只显示文件名不猜路径 */
const dirLabel = computed(() => settings.value.dir || '未设置')

async function onFormatChange(e: Event): Promise<void> {
  await saveSettings({ nameFormat: (e.target as HTMLSelectElement).value })
}

async function onConcurrencyChange(e: Event): Promise<void> {
  await saveSettings({ concurrency: Number((e.target as HTMLSelectElement).value) || 2 })
}

async function onSubdirChange(e: Event): Promise<void> {
  await saveSettings({ subdirPerList: (e.target as HTMLInputElement).checked })
}

async function onSkipExistingChange(e: Event): Promise<void> {
  await saveSettings({ skipExisting: (e.target as HTMLInputElement).checked })
}
</script>

<template>
  <div class="mx-auto w-full max-w-[980px] px-8 pb-16 pt-6">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-[26px] font-bold text-ncm-fg">下载管理</h1>
        <p class="mt-1 text-[13px] text-ncm-faint">
          共 {{ tasks.length }} 首 · 进行中 {{ activeCount }} · 等待 {{ waitingCount }} · 已完成 {{ completedCount }}
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="rounded-pill border border-ncm-divider px-4 py-1.5 text-[13px] text-ncm-muted transition-colors hover:bg-black/5 disabled:opacity-40"
          :disabled="!activeCount && !waitingCount"
          @click="pauseAll"
        >全部暂停</button>
        <button
          type="button"
          class="rounded-pill border border-ncm-divider px-4 py-1.5 text-[13px] text-ncm-muted transition-colors hover:bg-black/5 disabled:opacity-40"
          :disabled="!tasks.some(t => t.status === 'paused' || t.status === 'error')"
          @click="resumeAll"
        >全部继续</button>
        <button
          type="button"
          class="rounded-pill border border-ncm-divider px-4 py-1.5 text-[13px] text-ncm-muted transition-colors hover:bg-black/5 disabled:opacity-40"
          :disabled="!completedCount"
          @click="clearCompleted"
        >清空已完成</button>
      </div>
    </div>

    <!-- 下载设置 -->
    <div class="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-nav bg-ncm-surface p-4">
      <div class="flex min-w-0 flex-1 items-center gap-2">
        <FolderOpen :size="17" :stroke-width="1.9" class="shrink-0 text-ncm-accent" aria-hidden="true" />
        <span class="shrink-0 text-[13px] text-ncm-faint">保存到</span>
        <span class="min-w-0 flex-1 truncate text-[13px] text-ncm-fg" :title="dirLabel">{{ dirLabel }}</span>
        <button
          type="button"
          class="shrink-0 rounded-pill border border-ncm-divider px-3 py-1 text-[12px] text-ncm-muted hover:bg-black/5"
          @click="pickDir"
        >更改</button>
        <button
          type="button"
          class="shrink-0 rounded-pill border border-ncm-divider px-3 py-1 text-[12px] text-ncm-muted hover:bg-black/5 disabled:opacity-40"
          :disabled="!settings.dir"
          @click="openDir"
        >打开</button>
      </div>

      <label class="flex items-center gap-2">
        <span class="shrink-0 text-[13px] text-ncm-faint">命名</span>
        <select
          :value="settings.nameFormat"
          class="rounded-[6px] border border-ncm-divider bg-white px-2 py-1 text-[13px] text-ncm-fg outline-none focus:border-ncm-accent"
          @change="onFormatChange"
        >
          <option v-for="f in formats" :key="f.id" :value="f.id">{{ f.label }}</option>
        </select>
      </label>

      <label class="flex cursor-pointer items-center gap-2" title="从歌单批量下载时，文件落到「歌单名」子目录里">
        <input
          type="checkbox"
          class="size-[14px] accent-ncm-accent"
          :checked="settings.subdirPerList"
          @change="onSubdirChange"
        />
        <span class="shrink-0 text-[13px] text-ncm-faint">按歌单分目录</span>
      </label>

      <label class="flex cursor-pointer items-center gap-2" title="目标文件已存在时不覆盖，直接当作已完成">
        <input
          type="checkbox"
          class="size-[14px] accent-ncm-accent"
          :checked="settings.skipExisting"
          @change="onSkipExistingChange"
        />
        <span class="shrink-0 text-[13px] text-ncm-faint">同名跳过</span>
      </label>

      <label class="flex items-center gap-2">
        <span class="shrink-0 text-[13px] text-ncm-faint">同时下载</span>
        <select
          :value="settings.concurrency"
          class="rounded-[6px] border border-ncm-divider bg-white px-2 py-1 text-[13px] text-ncm-fg outline-none focus:border-ncm-accent"
          @change="onConcurrencyChange"
        >
          <option v-for="n in 6" :key="n" :value="n">{{ n }}</option>
        </select>
      </label>
    </div>

    <!-- 空态 -->
    <div v-if="!tasks.length" class="mt-10 flex flex-col items-center rounded-nav bg-ncm-surface p-12">
      <Clock :size="42" :stroke-width="1.4" class="text-ncm-fainter" aria-hidden="true" />
      <p class="mt-4 text-[15px] text-ncm-fg">还没有下载任务</p>
      <p class="mt-2 text-[13px] text-ncm-faint">在歌曲右键菜单里选「下载」，或到歌单页点「下载全部」</p>
    </div>

    <!-- 任务列表 -->
    <ul v-else class="mt-6 flex flex-col gap-1">
      <li
        v-for="task in tasks"
        :key="task.id"
        class="group flex items-center gap-4 rounded-[8px] px-3 py-2.5 transition-colors hover:bg-black/[0.03]"
      >
        <img
          v-if="task.item.picUrl"
          :src="task.item.picUrl"
          alt=""
          loading="lazy"
          class="h-[46px] w-[46px] shrink-0 rounded-[6px] object-cover"
        />
        <div v-else class="h-[46px] w-[46px] shrink-0 rounded-[6px] bg-ncm-divider" />

        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class="truncate text-[14px] text-ncm-fg">{{ task.item.name }}</span>
            <span class="shrink-0 text-[12px] text-ncm-fainter">{{ task.ext.toUpperCase() }}</span>
          </div>
          <div class="mt-0.5 flex items-center gap-2 text-[12px]">
            <span class="truncate text-ncm-faint">{{ task.item.singer }}</span>
            <span class="shrink-0" :class="statusColor(task)">
              <span class="inline-flex items-center gap-1">
                <Loader2 v-if="task.status === 'running'" :size="11" class="animate-spin" aria-hidden="true" />
                <CheckCircle2 v-else-if="task.status === 'completed'" :size="11" aria-hidden="true" />
                <AlertCircle v-else-if="task.status === 'error'" :size="11" aria-hidden="true" />
                <span class="max-w-[380px] truncate">{{ statusText(task) }}</span>
              </span>
            </span>
            <span v-if="task.total" class="shrink-0 text-ncm-fainter">{{ sizeText(task) }}</span>
          </div>

          <!-- 进度条 -->
          <div class="mt-1.5 h-[3px] w-full overflow-hidden rounded-full bg-ncm-divider">
            <div
              class="h-full rounded-full transition-[width] duration-300"
              :class="barColor(task)"
              :style="{ width: `${Math.max(task.status === 'completed' ? 100 : task.progress, 0)}%` }"
            />
          </div>
        </div>

        <div class="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            v-if="task.status === 'running' || task.status === 'waiting'"
            type="button"
            class="rounded-full p-1.5 text-ncm-muted hover:bg-black/5 hover:text-ncm-fg"
            title="暂停"
            @click="pause(task.id)"
          ><Pause :size="15" aria-hidden="true" /></button>
          <button
            v-else-if="task.status === 'paused' || task.status === 'error'"
            type="button"
            class="rounded-full p-1.5 text-ncm-muted hover:bg-black/5 hover:text-ncm-fg"
            title="继续"
            @click="resume(task.id)"
          ><Play :size="15" aria-hidden="true" /></button>
          <button
            type="button"
            class="rounded-full p-1.5 text-ncm-muted hover:bg-black/5 hover:text-red-500"
            :title="task.status === 'completed' ? '从列表移除' : '删除任务和未完成的文件'"
            @click="remove(task.id)"
          ><Trash2 :size="15" aria-hidden="true" /></button>
        </div>
      </li>
    </ul>
  </div>
</template>
