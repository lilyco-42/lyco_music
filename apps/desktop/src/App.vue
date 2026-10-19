<script setup lang="ts">
/**
 * 网易云风格桌面端外壳
 * 布局坐标来自 DESIGN.md 实测：左栏 255px / 顶栏 94px / 底栏 102px
 */
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import Sidebar from './components/layout/Sidebar.vue'
import TopBar from './components/layout/TopBar.vue'
import PlayBar from './components/layout/PlayBar.vue'
import AudioHost from './components/AudioHost.vue'
import { toastText } from './lib/toast'

const route = useRoute()
/** 播放器模式为独立全屏界面（实测深色截图） */
const isPlayerMode = computed(() => route.name === 'player')
/**
 * 桌面歌词窗口：同一个前端包，但加载在独立的透明窗口里。
 * 它不能画侧栏/顶栏/底栏，也不能有不透明背景，否则就不是「浮在桌面上的歌词」。
 *
 * 判断里带了 hash 兜底：路由解析是异步的，首帧 route.name 还是 undefined，
 * 只看路由会让歌词窗口先渲染出一整套普通界面（用户看到的就是一块白面板）。
 */
const isLyricWindow = computed(() => route.name === 'lyric-window' || location.hash.includes('/lyric-window'))
</script>

<template>
  <!-- <audio> 宿主：全应用只应存在一个，放在最外层避免路由切换时被销毁 -->
  <AudioHost />

  <!-- 桌面歌词窗口：透明背景，只有歌词本体 -->
  <RouterView v-if="isLyricWindow" />

  <!-- 播放器模式：全屏，无左右栏 -->
  <RouterView v-else-if="isPlayerMode" />

  <!-- 常规界面 -->
  <div v-else class="flex h-full w-full flex-col overflow-hidden bg-ncm-bg">
    <div class="flex min-h-0 flex-1">
      <!-- 左栏：实测 255px -->
      <Sidebar class="w-sidebar shrink-0" />

      <div class="flex min-w-0 flex-1 flex-col">
        <!-- 顶栏：实测 94px -->
        <TopBar class="h-topbar shrink-0" />

        <!-- 主内容区：实测左内边距 49px -->
        <main class="min-h-0 flex-1 overflow-y-auto px-[49px] pb-6">
          <RouterView />
        </main>
      </div>
    </div>

    <!-- 底栏：实测 102px -->
    <PlayBar class="h-bottombar shrink-0" />
  </div>

  <!-- 全局轻提示：下载/导出的结果。放在最外层，播放器模式也能看到 -->
  <div
    v-if="toastText"
    class="pointer-events-none fixed inset-x-0 bottom-[124px] z-[100] flex justify-center"
  >
    <div class="rounded-full bg-black/80 px-4 py-2 text-[13px] text-white shadow-lg">{{ toastText }}</div>
  </div>
</template>
