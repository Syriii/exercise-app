<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";

import { ApiError, apiRequest } from "../api/client";
import { useSessionStore } from "../stores/session";

const route = useRoute();
const router = useRouter();
const session = useSessionStore();
const username = ref("");
const password = ref("");
const submitting = ref(false);
const registrationOpen = ref(true);
const errorMessage = ref("");
const mode = computed<"login" | "register">(() =>
  route.name === "register" ? "register" : "login",
);

watch(mode, () => {
  errorMessage.value = "";
});

onMounted(async () => {
  try {
    registrationOpen.value = (
      await apiRequest<{ open: boolean }>("/api/v1/auth/registration")
    ).open;
  } catch {
    errorMessage.value = "暂时连不上服务端，请稍后再试。";
  }
});

async function submit() {
  submitting.value = true;
  errorMessage.value = "";
  try {
    await session.authenticate(mode.value, username.value, password.value);
    const requested = typeof route.query.redirect === "string" ? route.query.redirect : "/today";
    const redirect = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/today";
    await router.push(session.account?.passwordChangeRequired ? "/account/password" : redirect);
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : "暂时无法完成操作，请稍后再试。";
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <main class="access-page">
    <section class="access-card" aria-labelledby="access-title">
      <header class="access-brand"><span class="brand-mark">EA</span><strong>Exercise App</strong></header>
      <div class="access-copy">
        <p class="date-line">训练和饮食，按实际记录</p>
        <h1 id="access-title">{{ mode === "login" ? "登录" : "创建账号" }}</h1>
        <p>{{ mode === "login" ? "回到今天的安排。" : "账号只用于保存你自己的训练和饮食记录。" }}</p>
      </div>

      <p v-if="mode === 'login' && route.query.accountDeletion === 'requested'" class="form-notice" role="status">账号删除请求已提交。所有设备已退出，后台会继续清理该账号的数据和临时照片。</p>

      <form class="access-form" @submit.prevent="submit">
        <label><span>用户名</span><input v-model="username" name="username" autocomplete="username" minlength="3" maxlength="32" required /></label>
        <label><span>密码</span><input v-model="password" name="password" :autocomplete="mode === 'login' ? 'current-password' : 'new-password'" type="password" :minlength="mode === 'register' ? 8 : 1" maxlength="128" required /></label>
        <p v-if="mode === 'register'" class="field-note">至少 8 个字符。密码不会以明文保存。</p>
        <p v-if="errorMessage" class="form-error" role="alert">{{ errorMessage }}</p>
        <button class="action-button action-button--primary" type="submit" :disabled="submitting || (mode === 'register' && !registrationOpen)">
          {{ submitting ? "正在处理…" : mode === "login" ? "登录" : registrationOpen ? "注册" : "注册暂未开放" }}
        </button>
      </form>

      <p class="access-switch">
        <template v-if="mode === 'login'">还没有账号？ <RouterLink to="/register">去注册</RouterLink></template>
        <template v-else>已经有账号？ <RouterLink to="/login">去登录</RouterLink></template>
      </p>
    </section>
  </main>
</template>
