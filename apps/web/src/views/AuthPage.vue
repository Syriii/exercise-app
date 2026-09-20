<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";

import { ApiError, apiRequest } from "../api/client";
import { useSessionStore } from "../stores/session";
import { nutritionApi } from "../api/nutrition";
import AppIcon from "../components/AppIcon.vue";

const route = useRoute();
const router = useRouter();
const session = useSessionStore();
const username = ref("");
const password = ref("");
const submitting = ref(false);
const registrationOpen = ref(true);
const errorMessage = ref("");
const automaticPhoto = ref(false), photoConsent = ref(false), authenticated = ref(false);
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
  if (submitting.value) return;
  submitting.value = true;
  errorMessage.value = "";
  try {
    if (!authenticated.value) {
      await session.authenticate(mode.value, username.value, password.value);
      authenticated.value = true;
      password.value = "";
    }
    if (mode.value === "register" && automaticPhoto.value) {
      if (!photoConsent.value) { errorMessage.value = "请确认照片发送范围，或关闭自动识别后继续。"; return; }
      try {
        const settings = await nutritionApi.photoSettings();
        await nutritionApi.savePhotoSettings({ revision: settings.revision, automatic: true, consent: true });
      } catch {
        errorMessage.value = "账号已创建，但识别设置尚未保存。可以重试，或关闭自动识别后继续；不会重复注册。";
        return;
      }
    }
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
      <header class="access-brand"><span class="brand-mark"><AppIcon name="leaf" /></span><strong>Exercise App</strong></header>
      <div class="access-copy">
        <h1 id="access-title">{{ mode === "login" ? "登录" : "创建账号" }}</h1>
        <p v-if="mode === 'register'">保存你的训练和饮食记录。</p>
      </div>

      <p v-if="mode === 'login' && route.query.accountDeletion === 'requested'" class="form-notice" role="status">账号删除请求已提交。所有设备已退出，后台会继续清理该账号的数据和临时照片。</p>

      <form class="access-form" @submit.prevent="submit">
        <label><span>用户名</span><input v-model="username" name="username" autocomplete="username" minlength="3" maxlength="32" required :disabled="authenticated || submitting" /></label>
        <label v-if="!authenticated"><span>密码</span><input v-model="password" name="password" :autocomplete="mode === 'login' ? 'current-password' : 'new-password'" type="password" :minlength="mode === 'register' ? 8 : 1" maxlength="128" required :disabled="submitting" /></label>
        <p v-if="mode === 'register'" class="field-note">密码至少 8 个字符</p>
        <fieldset v-if="mode === 'register'" class="registration-photo-options" :disabled="submitting">
          <label class="checkbox-row"><input v-model="automaticPhoto" type="checkbox" />拍照后自动识别（可选）</label>
          <template v-if="automaticPhoto">
            <p class="field-help">所选照片会发送给配置的模型服务估算食物和营养，不发送其他餐食或账号资料。上传照片、识别结果和修改过程保留到你主动删除，用于回看和后续优化；不会自动对外分享或训练。</p>
            <label class="checkbox-row"><input v-model="photoConsent" type="checkbox" required />我了解并同意上述照片发送范围</label>
          </template>
          <p class="field-help">之后可在应用设置中开启。</p>
        </fieldset>
        <p v-if="errorMessage" class="form-error" role="alert">{{ errorMessage }}</p>
        <button class="action-button action-button--primary" type="submit" :disabled="submitting || (mode === 'register' && !registrationOpen)">
          {{ submitting ? "正在处理…" : authenticated ? "继续进入" : mode === "login" ? "登录" : registrationOpen ? "注册" : "注册暂未开放" }}
        </button>
      </form>

      <p class="access-switch">
        <template v-if="mode === 'login'">还没有账号？ <RouterLink to="/register">去注册</RouterLink></template>
        <template v-else>已经有账号？ <RouterLink to="/login">去登录</RouterLink></template>
      </p>
    </section>
  </main>
</template>
