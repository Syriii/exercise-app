<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";

import { ApiError } from "../api/client";
import { useSessionStore } from "../stores/session";

const router = useRouter();
const session = useSessionStore();
const currentPassword = ref("");
const newPassword = ref("");
const confirmation = ref("");
const errorMessage = ref("");
const submitting = ref(false);

async function submit() {
  errorMessage.value = "";
  if (newPassword.value !== confirmation.value) {
    errorMessage.value = "两次输入的新密码不一致。";
    return;
  }
  submitting.value = true;
  try {
    await session.changePassword(currentPassword.value, newPassword.value);
    await router.push("/today");
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : "暂时无法修改密码。";
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <main class="access-page">
    <section class="access-card" aria-labelledby="password-title">
      <div class="access-copy"><p class="date-line">账号安全</p><h1 id="password-title">修改密码</h1><p>修改成功后，之前的登录状态都会失效，这台设备会自动换用新会话。</p></div>
      <form class="access-form" @submit.prevent="submit">
        <label><span>当前密码</span><input v-model="currentPassword" type="password" autocomplete="current-password" required /></label>
        <label><span>新密码</span><input v-model="newPassword" type="password" autocomplete="new-password" minlength="8" maxlength="128" required /></label>
        <label><span>再输入一次</span><input v-model="confirmation" type="password" autocomplete="new-password" minlength="8" maxlength="128" required /></label>
        <p v-if="errorMessage" class="form-error" role="alert">{{ errorMessage }}</p>
        <button class="action-button action-button--primary" type="submit" :disabled="submitting">{{ submitting ? "正在保存…" : "保存新密码" }}</button>
      </form>
    </section>
  </main>
</template>
