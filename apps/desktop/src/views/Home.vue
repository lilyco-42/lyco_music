<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { coverFor } from '@/lib/covers'

/**
 * 首页「推荐」—— 实测规格：
 * 频道卡 7 张、207x266（比例 0.78）、间距 20px，整图背景 + 底部蒙层
 * 推荐歌单 1 行 9 列、封面 156x157、水平间距 19~20px、标题 2 行省略
 * 精选活动 4 张横幅、373x209、间距 24~25px
 * 区块纵向间距 38~47px
 */
/**
 * 频道卡：点进去就是一次真实搜索，不再是无处可去的色块。
 * 每个卡片带一个 keyword，点击后跳 /search?q=<keyword>。
 * tone 只用来区分视觉，不承载语义。
 */
const channels = [
  { title: '每日推荐', desc: '根据你的口味生成', tone: '#e57373', keyword: '热门' },
  { title: '私人漫游', desc: '无限漫游', tone: '#64b5f6', keyword: '华语流行' },
  { title: '私人雷达', desc: '为你精选', tone: '#9575cd', keyword: '轻音乐' },
  { title: '嘻哈/说唱日推', desc: '每日更新', tone: '#4db6ac', keyword: '说唱' },
  { title: '心情氛围歌单', desc: '此刻的心情', tone: '#ffb74d', keyword: '治愈' },
  { title: '欧美流行日推', desc: '每日更新', tone: '#7986cb', keyword: '欧美流行' },
  { title: '民谣日推', desc: '每日更新', tone: '#a1887f', keyword: '民谣' },
]

const router = useRouter()

/** 关键词 -> 真实封面 URL；取不到就留空，模板回退到内置占位图 */
const covers = reactive<Record<string, string>>({})
const loaded = ref(false)

onMounted(async () => {
  const keywords = [...channels.map(c => c.keyword), ...playlists.map(p => p.title)]
  const unique = [...new Set(keywords)]
  await Promise.all(
    unique.map(async k => {
      const url = await coverFor(k).catch(() => '')
      if (url) covers[k] = url
    }),
  )
  loaded.value = true
})

function picFor(keyword: string, fallback: string): string {
  return covers[keyword] || fallback
}

function openChannel(keyword: string): void {
  void router.push({ name: 'search', query: { q: keyword } })
}

/**
 * 推荐歌单：标题是固定的（网易云首页本来也是人工运营位），
 * 但点进去会真的搜出歌单名对应的歌，不再是死链接。
 */
const playlists = [
  '华语流行精选', '轻音乐助眠', '深夜电台', '电子舞曲', '摇滚经典',
  '民谣故事', '古典名曲', '爵士夜曲', '影视原声',
].map((title, i) => ({ id: i, title }))

/** 精选活动：同样接到搜索，点击有反馈 */
const activities = ['新歌抢先听', '会员福利社', '音乐人计划', '线下演出'].map((title, i) => ({
  id: i,
  title,
}))

function openPlaylist(title: string): void {
  void router.push({ name: 'search', query: { q: title } })
}
</script>

<template>
  <div class="pt-4">
    <!-- ============ 顶部精选频道：7 张，207x266 ============ -->
    <section class="relative">
      <div class="flex gap-5">
        <article
          v-for="ch in channels"
          :key="ch.title"
          class="group relative h-[266px] w-[207px] shrink-0 cursor-pointer overflow-hidden rounded-channel"
          :style="{ background: ch.tone }"
          @click="openChannel(ch.keyword)"
        >
          <!-- 真实封面打底；取不到图时保留色块，不会出现破图 -->
          <img
            v-if="covers[ch.keyword]"
            :src="covers[ch.keyword]"
            alt=""
            class="absolute inset-0 size-full object-cover"
            referrerpolicy="no-referrer"
            loading="lazy"
          />
          <!-- 质感滤镜：只贴在图片上，标题和渐变压在上面，字不会被网点弄脏 -->
          <span class="tex-img" aria-hidden="true" />
          <div class="absolute inset-0 bg-gradient-to-b from-black/10 to-black/55" />

          <!-- 标题距左 13px -->
          <h3 class="absolute left-[13px] top-[13px] text-[21px] font-bold leading-tight text-white drop-shadow">
            {{ ch.title }}
          </h3>

          <!-- 底部蒙层 + 说明文字 -->
          <div class="absolute inset-x-0 bottom-0 px-[13px] pb-[13px]">
            <p class="text-[14px] leading-[22px] text-white/90">{{ ch.desc }}</p>
          </div>

          <!-- 免费听 小标签 -->
          <!-- 悬停播放三角：始终存在，hover 才显形 -->
          <div
            class="absolute bottom-[13px] right-[13px] flex size-[34px] items-center justify-center rounded-full bg-white/90 opacity-0 transition-opacity group-hover:opacity-100"
          >
            <svg viewBox="0 0 24 24" class="size-4 fill-ncm-accent-play"><path d="M8 5v14l11-7z" /></svg>
          </div>
        </article>
      </div>

      <!-- 轮播箭头 -->
      <button type="button" class="absolute -left-4 top-1/2 -translate-y-1/2 text-[26px] text-[#b9bfca]" aria-label="上一组">‹</button>
      <button type="button" class="absolute -right-4 top-1/2 -translate-y-1/2 text-[26px] text-[#b9bfca]" aria-label="下一组">›</button>
    </section>

    <!-- ============ 推荐歌单：9 列，封面 156x157 ============ -->
    <section class="mt-[43px]">
      <div class="mb-[18px] flex items-center gap-2">
        <h2 class="text-[24px] font-bold leading-8 text-ncm-fg">推荐歌单</h2>
        <span class="text-[20px] leading-8 text-ncm-fainter">›</span>
        <div class="flex-1" />
        <button type="button" class="text-[15px] text-ncm-faint hover:text-ncm-accent" aria-label="刷新">↻</button>
      </div>

      <div class="flex gap-5">
        <article
          v-for="pl in playlists"
          :key="pl.id"
          class="group w-[157px] shrink-0 cursor-pointer"
          @click="openPlaylist(pl.title)"
        >
          <!-- 封面 156x157，圆角 7px；无封面数据时用生成的占位图 -->
          <div class="relative h-[157px] w-[156px] overflow-hidden rounded-cover bg-ncm-fainter/40">
            <img
              :src="picFor(pl.title, './art/playlist-default.jpg')"
              alt=""
              class="size-full object-cover"
              referrerpolicy="no-referrer"
              loading="lazy"
            />
            <span class="tex-img" aria-hidden="true" />
            <div class="absolute bottom-2 right-2 flex size-[30px] items-center justify-center rounded-full bg-white/90 opacity-0 transition-opacity group-hover:opacity-100">
              <svg viewBox="0 0 24 24" class="size-3.5 fill-ncm-accent-play"><path d="M8 5v14l11-7z" /></svg>
            </div>
          </div>

          <!-- 标题：最多 2 行，行高 22px -->
          <p class="mt-2 line-clamp-2 text-[15px] leading-[22px] text-ncm-fg">{{ pl.title }}</p>
        </article>
      </div>
    </section>

    <!-- ============ 精选活动：4 张，373x209 ============ -->
    <section class="mt-[43px]">
      <div class="mb-[18px] flex items-center gap-2">
        <h2 class="text-[24px] font-bold leading-8 text-ncm-fg">精选活动</h2>
        <span class="text-[20px] leading-8 text-ncm-fainter">›</span>
      </div>

      <div class="flex gap-[24px]">
        <article
          v-for="a in activities"
          :key="a.id"
          class="relative h-[209px] w-[373px] shrink-0 cursor-pointer overflow-hidden rounded-banner bg-gradient-to-br from-[#dbe3f5] to-[#f2dde6]"
          @click="openPlaylist(a.title)"
        >
          <h3 class="absolute left-[18px] top-[16px] text-[20px] font-semibold text-ncm-fg">{{ a.title }}</h3>
        </article>
      </div>
    </section>
  </div>
</template>
