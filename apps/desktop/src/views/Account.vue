<script setup lang="ts">
import { onMounted } from 'vue'
import { UserRound, ExternalLink, LogOut, ShieldCheck, Globe } from 'lucide-vue-next'
import { useAccount } from '@/lib/auth'

const account = useAccount()
onMounted(() => void account.restore())
</script>

<template>
  <section class="mx-auto max-w-[650px] py-8">
    <div class="mb-7 flex items-center gap-3">
      <UserRound :size="29" class="text-ncm-accent" />
      <div>
        <h1 class="text-[28px] font-bold text-ncm-fg">我的账户</h1>
        <p class="text-sm text-ncm-faint">使用 lain42.top 账号登录，同步识别真实购买权益。</p>
      </div>
    </div>

    <div v-if="account.signedIn.value && account.profile.value" class="rounded-2xl border border-ncm-divider bg-white p-7">
      <div class="flex items-center gap-3">
        <div class="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-ncm-accent/10">
          <img
            v-if="account.profile.value.avatar"
            :src="account.profile.value.avatar"
            alt=""
            class="size-full object-cover"
            referrerpolicy="no-referrer"
          />
          <UserRound v-else :size="24" class="text-ncm-accent" />
        </div>
        <div>
          <div class="text-lg font-semibold">{{ account.profile.value.username }}</div>
          <p class="text-sm text-ncm-faint">账户 ID：{{ account.profile.value.account_id }}</p>
        </div>
        <span v-if="account.vip.value" class="ml-auto rounded-full bg-ncm-accent px-3 py-1 text-xs text-white">音乐会员有效</span>
      </div>
      <p class="mt-6 text-sm text-ncm-muted">当前权益：{{ account.profile.value.entitlements?.length ?? 0 }} 项</p>
      <p class="mt-2 text-sm text-ncm-faint">{{ account.rememberOnDevice.value ? '授权凭证已通过系统密钥库加密保存，下次启动自动验证。' : '本机无法加密保存凭证；关闭软件后需重新授权。' }}</p>
      <p class="mt-2 text-sm text-ncm-faint">网站账号不等于音源订阅；已购买音乐会员可前往「音乐会员」页面激活订阅。</p>
      <button type="button" class="mt-6 flex items-center gap-2 rounded-full border border-ncm-divider px-5 py-2.5 text-ncm-muted hover:bg-ncm-bg" @click="account.signOut()">
        <LogOut :size="17" /> 退出登录
      </button>
    </div>

    <div v-else class="rounded-2xl border border-ncm-divider bg-white p-7 shadow-sm">
      <h2 class="text-xl font-semibold">用 lain42.top 账号登录</h2>
      <p class="mt-2 text-sm text-ncm-faint">
        点击下方按钮后会在系统浏览器里打开 lain42.top 的授权页，登录并确认后自动回到这里。
      </p>
      <ul class="mt-5 space-y-2 text-sm text-ncm-muted">
        <li class="flex items-start gap-2">
          <ShieldCheck :size="17" class="mt-0.5 shrink-0 text-ncm-accent" />
          <span>密码只输入在 lain42.top 的页面上，本应用不会接触你的密码。</span>
        </li>
        <li class="flex items-start gap-2">
          <Globe :size="17" class="mt-0.5 shrink-0 text-ncm-accent" />
          <span>应用拿到的是有期限、可随时撤销的授权凭证。</span>
        </li>
      </ul>
      <p v-if="account.error.value" role="alert" class="mt-4 text-sm text-ncm-accent">{{ account.error.value }}</p>
      <button type="button" :disabled="account.busy.value" @click="account.signIn()"
              class="mt-6 w-full rounded-full bg-ncm-accent py-3 font-semibold text-white disabled:opacity-60">
        {{ account.busy.value ? '等待浏览器授权…' : '打开授权页面' }}
      </button>
      <button type="button" class="mt-4 flex items-center gap-2 text-sm text-ncm-muted hover:text-ncm-accent" @click="account.openRegistration()">
        <ExternalLink :size="16" /> 没有账号？去官网注册或找回密码
      </button>
    </div>
  </section>
</template>
