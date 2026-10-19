<script setup lang="ts">
/**
 * 设置页 —— 外观与质感。
 *
 * 这里只放「看得见、改完立刻有反应」的东西：质感滤镜、皮肤、强调色。
 * 真正的「高级感」是默认值，不需要用户去调；设置页的意义是**能改回去** ——
 * 有人喜欢干净、有人屏幕是 1080p 带缩放（纹理在高 DPI 下会糊），
 * 所以每一档都必须能关掉。
 */
import { computed } from 'vue'
import { Check, Layers, Palette, Sparkles } from 'lucide-vue-next'
import { useTexture, type TextureId } from '@/lib/texture'
import { useTheme, SKINS, type SkinId } from '@/lib/theme'

const tex = useTexture()
const theme = useTheme()

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

    <p class="mt-6 text-center text-[12px] text-ncm-faint">
      桌面歌词的字号/颜色/显示层在歌词窗口里右键调整；显示层也可以直接在悬停工具条上点「原 / 罗 / 译」。
    </p>
  </section>
</template>
