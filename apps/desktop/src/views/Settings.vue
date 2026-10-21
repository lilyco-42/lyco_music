<script setup lang="ts">
/**
 * 设置页 —— 外观与质感。
 *
 * 这里只放「看得见、改完立刻有反应」的东西：质感滤镜、皮肤、强调色。
 * 真正的「高级感」是默认值，不需要用户去调；设置页的意义是**能改回去** ——
 * 有人喜欢干净、有人屏幕是 1080p 带缩放（纹理在高 DPI 下会糊），
 * 所以每一档都必须能关掉。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { Check, FileCode2, Layers, Palette, Sparkles, ThumbsDown, Trash2 } from 'lucide-vue-next'
import { useTexture, type TextureId } from '@/lib/texture'
import { useTheme, SKINS, type SkinId } from '@/lib/theme'
import { useSync } from '@/lib/sync'
import { toast } from '@/lib/toast'
import { useUserSources } from '@/lib/user-sources'
import { sourcePool, syncScriptSources } from '@/lib/source-pool'

const tex = useTexture()
const theme = useTheme()

/* ---------------- 不喜欢（屏蔽规则） ---------------- */

const { dislikes, setDislikeRules, clearDislikes } = useSync()

/**
 * 文本框的草稿。
 *
 * 内核里存的就是规则行数组，这里只做「文本 ↔ 数组」的转换。
 * dirty 是为了避免：用户正在输入时，别的入口（播放页的「不喜欢」按钮）
 * 改了规则，watch 把用户没保存的草稿覆盖掉。
 */
const dislikeDraft = ref(dislikes.value.join('\n'))
const dislikeDirty = ref(false)

watch(dislikes, v => {
  if (!dislikeDirty.value) dislikeDraft.value = v.join('\n')
})

async function saveDislikes(): Promise<void> {
  await setDislikeRules(dislikeDraft.value)
  dislikeDirty.value = false
  dislikeDraft.value = dislikes.value.join('\n')
  toast(`已保存 ${dislikes.value.length} 条屏蔽规则`)
}

async function wipeDislikes(): Promise<void> {
  await clearDislikes()
  dislikeDirty.value = false
  dislikeDraft.value = ''
  toast('已清空屏蔽规则')
}

/* ---------------- 自定义音源（lx 脚本） ---------------- */

const userSources = useUserSources()
const sourceUrl = ref('')
const sourceBusy = ref(false)
const sourceMsg = ref('')
const sourceErr = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

/**
 * 音源池的真实状态（成功/失败次数、上次错误）。
 *
 * 只显示「已导入 N 个」是不够的：脚本可能语法错误、初始化就失败，
 * 用户看到「启用了」却取不到流，会以为是播放器的问题。
 */
const poolInfo = ref<ReturnType<typeof sourcePool.list>>([])

/** 池子内容变了要重新 sync，否则新脚本要等下次重启才生效 */
async function refreshPool(): Promise<void> {
  await syncScriptSources().catch(() => 0)
  poolInfo.value = sourcePool.list()
}

onMounted(() => { void refreshPool() })

/** 某个音源在池子里的运行状态（没有运行记录时返回 undefined） */
function poolState(id: string) {
  return poolInfo.value.find(p => p.id === id)
}

async function importSourceUrl(): Promise<void> {
  if (sourceBusy.value) return
  sourceBusy.value = true
  sourceMsg.value = ''
  sourceErr.value = ''
  try {
    const s = await userSources.addFromUrl(sourceUrl.value)
    sourceUrl.value = ''
    await refreshPool()
    sourceMsg.value = `已导入「${s.name}」`
  } catch (e) {
    sourceErr.value = e instanceof Error ? e.message : String(e)
  } finally {
    sourceBusy.value = false
  }
}

async function importSourceFile(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  sourceBusy.value = true
  sourceMsg.value = ''
  sourceErr.value = ''
  try {
    const s = await userSources.addFromFile(file)
    await refreshPool()
    sourceMsg.value = `已导入「${s.name}」`
  } catch (err) {
    sourceErr.value = err instanceof Error ? err.message : String(err)
  } finally {
    sourceBusy.value = false
    input.value = ''
  }
}

async function toggleSource(id: string): Promise<void> {
  userSources.toggle(id)
  await refreshPool()
}

async function removeSource(id: string): Promise<void> {
  userSources.remove(id)
  await refreshPool()
  sourceMsg.value = '已删除，音源池已更新'
}

const activeTexture = computed(() => tex.textures.find(t => t.id === tex.textureId.value) ?? tex.textures[0]!)

/**
 * 预览块的透明度。
 *
 * 用「当前强度」而不是各档自己的推荐值，这样拖滑块时预览会跟着变；
 * 但下限夹在 0.25，否则强度拉到 0 时整排卡片全变白，用户以为坏了。
 */
function previewOpacity(id: TextureId): number {
  const base = id === tex.textureId.value ? tex.strength.value / 100 : (tex.textures.find(t => t.id === id)?.strength ?? 0) / 100
  return Math.min(1, Math.max(0.25, base))
}

function pickSkin(id: SkinId): void {
  theme.setTheme('skin:' + id)
}

const SKIN_DESC: Record<SkinId, string> = {
  classic: '实色面板，对比最稳，老机器最省',
  glass: '半透明 + 背景模糊，Apple Liquid Glass 的做法',
}
</script>

<template>
  <section class="mx-auto max-w-[880px] py-8">
    <div class="mb-7 flex items-center gap-3">
      <Sparkles :size="29" class="text-ncm-accent" />
      <div>
        <h1 class="text-[28px] font-bold text-ncm-fg">设置</h1>
        <p class="text-sm text-ncm-faint">外观与质感。默认就是我们认为最好看的那一档，改坏了随时能改回来。</p>
      </div>
    </div>

    <!-- ============ 质感滤镜 ============ -->
    <div class="rounded-2xl border border-ncm-divider bg-white p-7">
      <div class="flex items-center gap-2">
        <Layers :size="19" class="text-ncm-accent" />
        <h2 class="text-lg font-semibold text-ncm-fg">封面质感</h2>
        <span class="ml-auto rounded-full bg-ncm-accent/10 px-2.5 py-1 text-[11px] text-ncm-accent">默认：半调网点</span>
      </div>
      <p class="mt-2 text-sm text-ncm-faint">
        只作用在<b class="text-ncm-muted">带封面的组件</b>上（专辑图、歌单封面、频道大图）。纯色面板和文字一律不碰 ——
        整屏铺满会显脏，网点压在字上边缘会毛。
      </p>

      <div class="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <button
          v-for="t in tex.textures"
          :key="t.id"
          type="button"
          class="group rounded-xl border p-2 text-left transition-all"
          :class="tex.textureId.value === t.id
            ? 'border-ncm-accent bg-ncm-accent/5 ring-1 ring-ncm-accent/40'
            : 'border-ncm-divider hover:border-ncm-faint/50 hover:bg-ncm-bg'"
          :title="t.desc"
          @click="tex.setTexture(t.id)"
        >
          <div class="tex-preview h-[54px] w-full" :data-texture="t.id">
            <span class="tex-img" :style="{ opacity: previewOpacity(t.id) }" />
          </div>
          <div class="mt-2 flex items-center gap-1">
            <span class="text-[13px] font-medium text-ncm-fg">{{ t.name }}</span>
            <Check v-if="tex.textureId.value === t.id" :size="13" class="ml-auto text-ncm-accent" />
          </div>
          <p class="mt-0.5 line-clamp-2 text-[11px] leading-[15px] text-ncm-faint">{{ t.desc }}</p>
        </button>
      </div>

      <!-- 强度：同一张网点，4% 是高级，15% 就是脏 -->
      <div class="mt-6 flex items-center gap-3">
        <span class="w-[64px] shrink-0 text-[13px] text-ncm-muted">强度</span>
        <input
          type="range"
          min="0"
          max="100"
          :value="tex.strength.value"
          :disabled="tex.textureId.value === 'none'"
          class="h-1 flex-1 accent-[var(--color-ncm-accent)] disabled:opacity-40"
          aria-label="质感强度"
          @input="tex.setStrength(Number(($event.target as HTMLInputElement).value))"
        />
        <span class="w-[42px] shrink-0 text-right text-[13px] tabular-nums text-ncm-fg">{{ tex.strength.value }}%</span>
        <button
          type="button"
          class="shrink-0 rounded-full border border-ncm-divider px-3 py-1 text-[12px] text-ncm-muted hover:bg-ncm-bg disabled:opacity-40"
          :disabled="tex.textureId.value === 'none'"
          @click="tex.setStrength(activeTexture.strength)"
        >
          恢复推荐
        </button>
      </div>
      <p class="mt-2 text-[12px] text-ncm-faint">
        建议 35%～70%。图片本身有明暗，比纯色面板更吃得住纹理；低于 20% 基本看不出来。
      </p>
    </div>

    <!-- ============ 皮肤 ============ -->
    <div class="mt-5 rounded-2xl border border-ncm-divider bg-white p-7">
      <div class="flex items-center gap-2">
        <Layers :size="19" class="text-ncm-accent" />
        <h2 class="text-lg font-semibold text-ncm-fg">皮肤</h2>
      </div>
      <p class="mt-2 text-sm text-ncm-faint">皮肤换的是材质（面板是否半透明、有没有毛玻璃），和下面的强调色互不影响。</p>
      <div class="mt-4 grid grid-cols-2 gap-3">
        <button
          v-for="s in SKINS"
          :key="s.id"
          type="button"
          class="rounded-xl border p-4 text-left transition-all"
          :class="theme.skinId.value === s.id
            ? 'border-ncm-accent bg-ncm-accent/5 ring-1 ring-ncm-accent/40'
            : 'border-ncm-divider hover:border-ncm-faint/50 hover:bg-ncm-bg'"
          @click="pickSkin(s.id)"
        >
          <div class="flex items-center gap-1.5">
            <span class="text-[14px] font-medium text-ncm-fg">{{ s.name }}</span>
            <Check v-if="theme.skinId.value === s.id" :size="14" class="ml-auto text-ncm-accent" />
          </div>
          <p class="mt-1 text-[12px] leading-[17px] text-ncm-faint">{{ SKIN_DESC[s.id] }}</p>
        </button>
      </div>
    </div>

    <!-- ============ 强调色 ============ -->
    <div class="mt-5 rounded-2xl border border-ncm-divider bg-white p-7">
      <div class="flex items-center gap-2">
        <Palette :size="19" class="text-ncm-accent" />
        <h2 class="text-lg font-semibold text-ncm-fg">强调色</h2>
      </div>
      <p class="mt-2 text-sm text-ncm-faint">只换选中态/进度条这类强调色，结构色不动，所以任何配色下对比度都是可预期的。</p>
      <div class="mt-4 flex flex-wrap items-center gap-3">
        <button
          v-for="p in theme.presets"
          :key="p.id"
          type="button"
          class="flex items-center gap-2 rounded-full border px-3 py-1.5 transition-colors"
          :class="theme.currentId.value === p.id ? 'border-ncm-fg/30 bg-ncm-bg' : 'border-ncm-divider hover:bg-ncm-bg'"
          @click="theme.setTheme(p.id)"
        >
          <span class="size-4 rounded-full" :style="{ background: p.accent }" />
          <span class="text-[13px] text-ncm-muted">{{ p.name }}</span>
          <Check v-if="theme.currentId.value === p.id" :size="13" class="text-ncm-accent" />
        </button>
      </div>
    </div>

    <!-- ============ 不喜欢的歌曲 ============ -->
    <div class="mt-5 rounded-2xl border border-ncm-divider bg-white p-7">
      <div class="flex items-center gap-2">
        <ThumbsDown :size="19" class="text-ncm-accent" aria-hidden="true" />
        <h2 class="text-lg font-semibold text-ncm-fg">不喜欢的歌曲</h2>
        <span class="ml-1 text-[12px] text-ncm-faint">{{ dislikes.length }} 条规则</span>
      </div>
      <p class="mt-2 text-sm text-ncm-faint">
        命中的歌在随机/顺序播放时会被自动跳过，也不参与推荐。规则与 lx-music 完全兼容，可以从它那儿直接粘过来。
      </p>
      <ul class="mt-3 space-y-1 text-[12px] text-ncm-muted">
        <li><code class="rounded bg-ncm-bg px-1.5 py-0.5">歌名@艺术家</code> 只屏蔽这一首；歌名里本来有 @ 就写 #</li>
        <li><code class="rounded bg-ncm-bg px-1.5 py-0.5">歌名</code> 屏蔽所有同名的歌（翻唱也会中）</li>
        <li><code class="rounded bg-ncm-bg px-1.5 py-0.5">@艺术家</code> 屏蔽这个人的全部作品（合唱不匹配，见下方说明）</li>
      </ul>
      <textarea
        v-model="dislikeDraft"
        rows="6"
        spellcheck="false"
        placeholder="例如：&#10;晴天@周杰伦&#10;@某位不想再听到的歌手"
        class="mt-4 w-full resize-y rounded-xl border border-ncm-divider bg-ncm-bg px-3 py-2.5 font-mono text-[13px] leading-[21px] text-ncm-fg outline-none focus:border-ncm-accent"
        @input="dislikeDirty = true"
      />
      <div class="mt-3 flex items-center gap-2">
        <button
          type="button"
          class="rounded-full bg-ncm-accent px-4 py-1.5 text-[13px] text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          :disabled="!dislikeDirty"
          @click="saveDislikes"
        >保存规则</button>
        <button
          type="button"
          class="rounded-full border border-ncm-divider px-4 py-1.5 text-[13px] text-ncm-muted hover:bg-ncm-bg disabled:opacity-40"
          :disabled="!dislikes.length && !dislikeDraft.trim()"
          @click="wipeDislikes"
        >清空</button>
        <span v-if="dislikeDirty" class="text-[12px] text-ncm-faint">有未保存的修改</span>
      </div>
      <p class="mt-3 text-[12px] leading-[18px] text-ncm-faint">
        整串比对，不做分词：singer 是「周杰伦/费玉清」时，规则写「千里之外@周杰伦」不会命中，要写「千里之外」或「@费玉清」。
      </p>
    </div>

    <!-- ============ 自定义音源 ============ -->
    <div class="mt-5 rounded-2xl border border-ncm-divider bg-white p-7">
      <div class="flex items-center gap-2">
        <FileCode2 :size="19" class="text-ncm-accent" aria-hidden="true" />
        <h2 class="text-lg font-semibold text-ncm-fg">自定义音源</h2>
        <span class="ml-1 text-[12px] text-ncm-faint">
          已导入 {{ userSources.list.value.length }} 个 · 启用 {{ userSources.enabledCount.value }} 个
        </span>
      </div>
      <p class="mt-2 text-sm text-ncm-faint">
        支持 lx-music 的音源脚本（.js）。导入后与内置源、会员订阅源一起参与串源，取不到流时自动换下一个。
      </p>
      <p class="mt-1 text-[12px] leading-[18px] text-ncm-faint">
        脚本会在沙箱里执行 —— 导入第三方脚本相当于信任作者，请只导入你信得过的来源。
      </p>

      <div class="mt-4 flex flex-wrap items-center gap-2">
        <input
          v-model="sourceUrl"
          type="url"
          spellcheck="false"
          placeholder="脚本地址，https://…/xxx.js"
          class="min-w-[280px] flex-1 rounded-[8px] border border-ncm-divider bg-ncm-bg px-3 py-1.5 text-[13px] text-ncm-fg outline-none placeholder:text-ncm-fainter focus:border-ncm-accent"
          @keydown.enter.prevent="importSourceUrl"
        />
        <button
          type="button"
          class="rounded-full bg-ncm-accent px-4 py-1.5 text-[13px] text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          :disabled="sourceBusy || !sourceUrl.trim()"
          @click="importSourceUrl"
        >{{ sourceBusy ? '导入中…' : '从链接导入' }}</button>
        <button
          type="button"
          class="rounded-full border border-ncm-divider px-4 py-1.5 text-[13px] text-ncm-muted hover:bg-ncm-bg disabled:opacity-40"
          :disabled="sourceBusy"
          @click="fileInput?.click()"
        >导入本地文件</button>
        <input ref="fileInput" type="file" accept=".js,text/javascript" class="hidden" @change="importSourceFile" />
      </div>

      <p v-if="sourceMsg" class="mt-2 text-[12px] text-emerald-600">{{ sourceMsg }}</p>
      <p v-if="sourceErr" class="mt-2 text-[12px] text-red-500">{{ sourceErr }}</p>

      <ul v-if="userSources.list.value.length" class="mt-4 divide-y divide-ncm-divider rounded-xl border border-ncm-divider">
        <li
          v-for="s in userSources.list.value"
          :key="s.id"
          class="flex items-center gap-3 px-3 py-2.5"
        >
          <span
            class="size-[8px] shrink-0 rounded-full"
            :class="s.enabled ? 'bg-emerald-500' : 'bg-ncm-fainter'"
            :title="s.enabled ? '已启用' : '已停用'"
          />
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="truncate text-[13px] text-ncm-fg">{{ s.name }}</span>
              <span v-if="s.version" class="shrink-0 rounded-[3px] border border-ncm-divider px-1 text-[11px] text-ncm-faint">v{{ s.version }}</span>
            </div>
            <p class="mt-0.5 truncate text-[11px] text-ncm-fainter" :title="s.origin">{{ s.origin || '本地导入' }}</p>
            <p v-if="poolState(s.id)" class="mt-0.5 text-[11px]" :class="poolState(s.id)!.lastError ? 'text-red-500' : 'text-ncm-fainter'">
              {{ poolState(s.id)!.lastError ? '取流失败：' + poolState(s.id)!.lastError : `成功 ${poolState(s.id)!.ok} · 失败 ${poolState(s.id)!.fail}` }}
            </p>
          </div>
          <button
            type="button"
            class="shrink-0 rounded-full border border-ncm-divider px-3 py-1 text-[12px] text-ncm-muted hover:bg-ncm-bg"
            @click="toggleSource(s.id)"
          >{{ s.enabled ? '停用' : '启用' }}</button>
          <button
            type="button"
            class="shrink-0 rounded-full p-1.5 text-ncm-faint transition-colors hover:bg-black/5 hover:text-red-500"
            title="删除这个音源"
            @click="removeSource(s.id)"
          ><Trash2 :size="15" aria-hidden="true" /></button>
        </li>
      </ul>
      <p v-else class="mt-4 rounded-xl border border-dashed border-ncm-divider px-4 py-6 text-center text-[13px] text-ncm-fainter">
        还没有导入音源。lx-music 的脚本可以直接粘链接或用文件导入。
      </p>
    </div>

    <p class="mt-6 text-center text-[12px] text-ncm-faint">
      桌面歌词的字号/颜色/显示层在歌词窗口里右键调整；显示层也可以直接在悬停工具条上点「原 / 罗 / 译」。
    </p>
  </section>
</template>
