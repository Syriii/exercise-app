<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import { ApiError, apiRequest } from "../api/client";
import type { Account } from "../stores/session";
import { useSessionStore } from "../stores/session";

const router = useRouter();
const session = useSessionStore();
const accounts = ref<readonly Account[]>([]);
const registrationOpen = ref(false);
const loading = ref(true);
const errorMessage = ref("");

async function load() {
  loading.value = true;
  errorMessage.value = "";
  try {
    const [registration, accountList] = await Promise.all([
      apiRequest<{ open: boolean }>("/api/v1/auth/registration"),
      apiRequest<readonly Account[]>("/api/v1/admin/accounts"),
    ]);
    registrationOpen.value = registration.open;
    accounts.value = accountList;
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : "暂时无法读取管理信息。";
  } finally {
    loading.value = false;
  }
}

async function setRegistration(open: boolean) {
  try {
    const result = await apiRequest<{ open: boolean }>("/api/v1/admin/settings/registration", {
      method: "PUT",
      body: JSON.stringify({ open }),
    });
    registrationOpen.value = result.open;
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : "注册设置没有保存成功。";
  }
}

async function toggleAccount(account: Account) {
  const status = account.status === "active" ? "disabled" : "active";
  try {
    const updated = await apiRequest<Account>(`/api/v1/admin/accounts/${account.id}/status`, {
      method: "PUT",
      body: JSON.stringify({ status }),
    });
    accounts.value = accounts.value.map((item) => (item.id === updated.id ? updated : item));
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : "账号状态没有保存成功。";
  }
}

async function revokeSessions(account: Account) {
  try {
    await apiRequest<void>(`/api/v1/admin/accounts/${account.id}/revoke-sessions`, {
      method: "POST",
    });
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : "会话没有撤销成功。";
  }
}

onMounted(load);
</script>

<template>
  <main class="admin-page">
    <header class="admin-heading"><div><p class="date-line">仅管理员可见</p><h1>账号管理</h1><p>这里只保留当前确实需要的注册和账号状态控制。</p></div><button class="text-action" type="button" @click="router.push('/settings')">返回设置 →</button></header>
    <p v-if="errorMessage" class="form-error" role="alert">{{ errorMessage }}</p>
    <section class="settings-list" aria-labelledby="registration-title">
      <article><div><strong id="registration-title">开放注册</strong><p>关闭后，已有账号仍可正常登录。</p></div><label class="switch-row"><input :checked="registrationOpen" type="checkbox" @change="setRegistration(($event.target as HTMLInputElement).checked)" /><span>{{ registrationOpen ? "已开启" : "已关闭" }}</span></label></article>
    </section>
    <section class="admin-accounts" aria-labelledby="accounts-title">
      <div class="panel-heading"><h2 id="accounts-title">账号</h2><span class="status-chip">{{ accounts.length }} 个</span></div>
      <p v-if="loading">正在读取…</p>
      <article v-for="account in accounts" v-else :key="account.id" class="account-row">
        <div><strong>{{ account.username }}</strong><p>{{ account.role === "admin" ? "管理员" : "普通用户" }} · {{ account.status === "active" ? "正常" : "已停用" }}</p></div>
        <div v-if="account.id !== session.account?.id" class="account-actions">
          <button class="text-action" type="button" @click="revokeSessions(account)">退出所有设备</button>
          <button class="text-action" type="button" @click="toggleAccount(account)">{{ account.status === "active" ? "停用" : "恢复" }}</button>
        </div>
        <span v-else class="status-chip">当前账号</span>
      </article>
    </section>
  </main>
</template>
