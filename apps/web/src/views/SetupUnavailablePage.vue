<script setup lang="ts">
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import AppShell from "../app/AppShell.vue";
import AppIcon from "../components/AppIcon.vue";

const route = useRoute();
const router = useRouter();
const retrying = ref(false);
const retryFailed = ref(false);

function destination(): string {
  const value = route.query.redirect;
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/today";
  const target = router.resolve(value);
  if (target.name === "setup-unavailable" || target.meta.public || target.matched.some(record => record.redirect)) return "/today";
  return value;
}

async function retry() {
  if (retrying.value) return;
  retrying.value = true;
  retryFailed.value = false;
  try {
    // Re-enter the guard: only a successful read can decide whether setup is needed.
    await router.replace(destination());
    retryFailed.value = router.currentRoute.value.name === "setup-unavailable";
  } catch {
    retryFailed.value = true;
  } finally { retrying.value = false; }
}
</script>

<template>
  <AppShell page-class="setup-unavailable-page" rail-note="连接恢复后继续使用。">
    <section class="work-panel setup-load-error" aria-labelledby="setup-unavailable-title" :aria-busy="retrying">
      <AppIcon name="info" />
      <h1 id="setup-unavailable-title">暂时无法读取设置</h1>
      <p>请检查网络后重试，无需重新填写资料。</p>
      <p v-if="retryFailed" class="form-error" role="alert">仍未能读取设置，请稍后再试。</p>
      <button class="action-button action-button--primary" type="button" :disabled="retrying" @click="retry">{{ retrying ? '正在重试…' : '重试' }}</button>
    </section>
  </AppShell>
</template>
