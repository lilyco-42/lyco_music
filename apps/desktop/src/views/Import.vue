<script setup lang="ts">
import { useI18n } from '@/lib/i18n'

const { t } = useI18n()
/**
 * 导入本地音乐（从网易云下载目录一键同步）
 *
 * 这个页面的存在理由：用户已经有一批在网易云里下好的歌，重新在搜索页
 * 一首首找回来是不现实的。而下载目录就在他本机，扫一遍就全有了。
 *
 * 刻意不做的两件事：
 *   1. **不解析网易云的缓存数据库、不读登录 cookie。** 那既不稳定（版本一变就废），
 *      也需要用户交出账号凭据。扫目录拿到的是「用户自己下载的文件」，不需要授权。
 *   2. **不解密 .ncm。** 那是 DRM，网易云官方也写明拷到其他播放器放不了。
 *      这里如实统计并说明，而不是假装能导。
 */
import { computed, onMounted, ref } from 'vue'
import { FolderOpen, Import, Loader2, Music4, TriangleAlert } from 'lucide-vue-next'
import { useLocalImport, type ImportGroup } from '@/lib/local-import'

const imp = useLocalImport()

const picked = ref<Set<string>>(new Set())
const hint = ref('')

function toggle(dir: string): void {
  const next = new Set(picked.value)
  if (next.has(dir)) next.delete(dir)
  else next.add(dir)
  picked.value = next
}

const selected = computed<ImportGroup[]>(() =>
  imp.groups.value.filter(g => picked.value.has(g.dir)),
)
const selectedTracks = computed(() => selected.value.reduce((n, g) => n + g.tracks.length, 0))

async function scanDir(dir: string): Promise<void> {
  hint.value = ''
  picked.value = new Set()
  const list = await imp.scan(dir)
  // 默认全选有歌的分组：用户点「导入」时不用再勾一遍
  picked.value = new Set(list.filter(g => g.tracks.length).map(g => g.dir))
}

async function pickAndScan(): Promise<void> {
  const dir = await imp.pickDir()
  if (!dir) return
  if (!imp.foundDirs.value.includes(dir)) imp.foundDirs.value = [...imp.foundDirs.value, dir]
  await scanDir(dir)
}

async function runImport(): Promise<void> {
  const r = await imp.importGroups(selected.value)
  if (r.tracks) {
    hint.value = `已导入 ${r.tracks} 首到 ${r.playlists || '已有'} 个歌单。去「我的音乐 → 我的歌单」里看。`
  } else if (!imp.error.value) {
    hint.value = '这些歌都已经在歌单里了。'
  }
}

onMounted(() => { void imp.detect() })
</script>

<template>
  <div class="pt-2">
    <h1 class="text-[30px] font-bold leading-10 text-ncm-fg">{{ t('page.import', '导入本地音乐') }}</h1>
    <p class="mt-1.5 text-[13.5px] text-ncm-faint">
      直接读本机网易云的下载目录 —— 不需要登录，也不会动你的账号。
    </p>

    <!-- 自动找到的目录 -->
    <section class="mt-6">
      <div class="flex items-center gap-3">
        <h2 class="text-[16px] font-semibold text-ncm-fg">找到的网易云目录</h2>
        <span v-if="imp.detecting.value" class="flex items-center gap-1.5 text-[13px] text-ncm-faint">
          <Loader2 :size="13" class="animate-spin" aria-hidden="true" />探测中…
        </span>
        <button
          type="button"
          class="ml-auto flex items-center gap-1.5 rounded-pill border border-ncm-divider px-3.5 py-1.5 text-[13px] text-ncm-muted transition-colors hover:border-ncm-accent hover:text-ncm-accent"
          @click="pickAndScan"
        >
          <FolderOpen :size="14" :stroke-width="2" aria-hidden="true" />
          <span>选择其他目录…</span>
        </button>
      </div>

      <div v-if="!imp.detecting.value && !imp.foundDirs.value.length" class="mt-3 rounded-nav border border-ncm-divider p-4">
        <p class="text-[14px] text-ncm-muted">没有自动找到网易云的下载目录。</p>
        <p class="mt-1 text-[13px] text-ncm-fainter">
          点右上角「选择其他目录…」手动指定（通常是「下载设置」里那个路径，例如 D:\CloudMusic）。
        </p>
      </div>

      <ul v-else class="mt-3 flex flex-col gap-2">
        <li v-for="dir in imp.foundDirs.value" :key="dir">
          <button
            type="button"
            class="flex w-full items-center gap-3 rounded-nav border px-4 py-3 text-left transition-colors"
            :class="imp.currentDir.value === dir
              ? 'border-ncm-accent bg-ncm-accent/5'
              : 'border-ncm-divider hover:border-ncm-accent/60'"
            @click="scanDir(dir)"
          >
            <FolderOpen :size="18" :stroke-width="1.8" class="shrink-0 text-ncm-accent" aria-hidden="true" />
            <span class="min-w-0 flex-1 truncate text-[14px] text-ncm-fg">{{ dir }}</span>
            <span class="shrink-0 text-[12.5px] text-ncm-fainter">
              {{ imp.currentDir.value === dir ? '已扫描' : '点击扫描' }}
            </span>
          </button>
        </li>
      </ul>

      <p v-if="imp.clientDirs.value.length" class="mt-2 text-[12.5px] text-ncm-fainter">
        另找到客户端数据目录 {{ imp.clientDirs.value.join('、') }}（只提示，不解析 —— 里面是缓存数据库，不是你的歌）。
      </p>
    </section>

    <!-- 扫描结果 -->
    <section v-if="imp.scanning.value" class="mt-8 flex items-center gap-2 text-[14px] text-ncm-faint">
      <Loader2 :size="15" class="animate-spin" aria-hidden="true" />正在扫描…
    </section>

    <section v-else-if="imp.groups.value.length" class="mt-8">
      <div class="flex items-baseline gap-3">
        <h2 class="text-[16px] font-semibold text-ncm-fg">扫描结果</h2>
        <span class="text-[13px] text-ncm-faint">
          可导入 {{ imp.totalTracks.value }} 首
          <template v-if="imp.totalEncrypted.value">· 跳过 {{ imp.totalEncrypted.value }} 个加密文件</template>
        </span>
      </div>

      <p v-if="imp.truncated.value" class="mt-2 flex items-start gap-2 rounded-nav bg-amber-50 p-3 text-[13px] text-amber-800">
        <TriangleAlert :size="15" class="mt-0.5 shrink-0" aria-hidden="true" />
        <span>目录里的文件太多，只扫描了前一部分。建议把目录选得更具体一些。</span>
      </p>

      <!-- 加密文件的说明：不给解释的话，用户会以为我们漏了 -->
      <div v-if="imp.totalEncrypted.value" class="mt-3 rounded-nav border border-ncm-divider p-4">
        <p class="flex items-center gap-2 text-[13.5px] font-medium text-ncm-fg">
          <TriangleAlert :size="15" class="text-amber-600" aria-hidden="true" />
          有 {{ imp.totalEncrypted.value }} 首是加密格式，无法导入
        </p>
        <p class="mt-1.5 text-[13px] leading-5 text-ncm-muted">
          <template v-for="(n, ext) in imp.lastSummary.value.encryptedByExt" :key="ext">
            <code class="rounded bg-black/5 px-1 py-0.5 text-[12px]">.{{ ext }}</code> {{ n }} 个&nbsp;
          </template>
          —— 这是平台方的 DRM 封装（网易云的 .ncm 等），官方说明写明「拷贝至其他播放器可能无法正常播放」。
          要拿到可播放的版本，只能在该平台单曲购买后重新下载；我们不做解密。
        </p>
      </div>

      <ul class="mt-4 flex flex-col gap-2">
        <li
          v-for="g in imp.groups.value"
          :key="g.dir"
          class="flex items-center gap-3 rounded-nav border border-ncm-divider px-4 py-3"
        >
          <input
            :id="'g-' + g.dir"
            type="checkbox"
            class="size-4 shrink-0 accent-ncm-accent"
            :checked="picked.has(g.dir)"
            :disabled="!g.tracks.length"
            @change="toggle(g.dir)"
          />
          <label :for="'g-' + g.dir" class="min-w-0 flex-1 cursor-pointer">
            <span class="block truncate text-[14px] text-ncm-fg">{{ g.name }}</span>
            <span class="block truncate text-[12.5px] text-ncm-fainter">{{ g.dir }}</span>
          </label>
          <span class="flex shrink-0 items-center gap-1 text-[13px] text-ncm-muted">
            <Music4 :size="13" :stroke-width="2" aria-hidden="true" />{{ g.tracks.length }}
          </span>
          <span v-if="g.encrypted" class="shrink-0 text-[12.5px] text-ncm-fainter">+{{ g.encrypted }} 加密</span>
        </li>
      </ul>

      <div class="mt-5 flex items-center gap-3">
        <button
          type="button"
          class="flex items-center gap-1.5 rounded-pill bg-ncm-accent px-5 py-2 text-[14px] text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          :disabled="!selectedTracks || imp.importing.value"
          @click="runImport"
        >
          <Loader2 v-if="imp.importing.value" :size="15" class="animate-spin" aria-hidden="true" />
          <Import v-else :size="15" :stroke-width="2.2" aria-hidden="true" />
          <span>{{ imp.importing.value ? '导入中…' : `导入选中（${selectedTracks} 首）` }}</span>
        </button>
        <span v-if="hint" class="text-[13.5px] text-ncm-muted">{{ hint }}</span>
      </div>
    </section>

    <p v-if="imp.error.value" class="mt-4 text-[13.5px] text-red-500">{{ imp.error.value }}</p>
  </div>
</template>
