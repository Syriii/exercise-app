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
type RuntimeStatus = "healthy" | "stale" | "unavailable" | "unknown";
interface ComponentHealth {
  readonly status: RuntimeStatus;
  readonly lastSeenAt: string | null;
}
interface OperationsHealth {
  readonly checkedAt: string;
  readonly api: ComponentHealth;
  readonly database: ComponentHealth;
  readonly worker: ComponentHealth;
}
interface OperationsSummary { checkedAt: string; model: { configured: boolean; model: string | null }; tasks: Record<"pending" | "running" | "succeeded" | "failed" | "cancelled", number>; media: Record<"available" | "deletion_pending" | "deleted" | "missing", number> & { expiredAvailable: number }; disk: { availableBytes: number | null }; backup: { lastSucceededAt: string | null; lastFailedAt: string | null }; restoreVerification: { lastSucceededAt: string | null; lastFailedAt: string | null }; }
const operationsHealth = ref<OperationsHealth | null>(null);
const operationsSummary = ref<OperationsSummary | null>(null);
const loading = ref(true);
const errorMessage = ref("");
const passwordResetTargetId = ref<string | null>(null);
const temporaryPassword = ref("");
const passwordResetSaving = ref(false);
const notice = ref("");

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
    try {
      [operationsHealth.value, operationsSummary.value] = await Promise.all([
        apiRequest<OperationsHealth>("/api/v1/admin/operations/health"),
        apiRequest<OperationsSummary>("/api/v1/admin/operations/summary"),
      ]);
    } catch {
      operationsHealth.value = null;
      errorMessage.value = "账号信息已读取，但暂时无法取得运行状态。";
    }
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : "暂时无法读取管理信息。";
  } finally {
    loading.value = false;
  }
}

const statusLabels: Readonly<Record<RuntimeStatus, string>> = {
  healthy: "正常",
  stale: "心跳过期",
  unavailable: "不可用",
  unknown: "尚未确认",
};

function formatLastSeen(value: string | null): string {
  return value === null ? "没有可用记录" : `最近信号 ${new Date(value).toLocaleString("zh-CN")}`;
}

function formatBytes(value: number | null): string { if (value === null) return "无法读取"; const gib = value / (1024 ** 3); return `${gib.toFixed(gib < 10 ? 1 : 0)} GiB 可用`; }
function formatEvent(value: string | null): string { return value === null ? "尚无记录" : new Date(value).toLocaleString("zh-CN"); }

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

function beginPasswordReset(account: Account) {
  passwordResetTargetId.value = account.id;
  temporaryPassword.value = "";
  notice.value = "";
  errorMessage.value = "";
}

function cancelPasswordReset() {
  passwordResetTargetId.value = null;
  temporaryPassword.value = "";
}

async function resetPassword(account: Account) {
  passwordResetSaving.value = true;
  errorMessage.value = "";
  notice.value = "";
  try {
    const updated = await apiRequest<Account>(`/api/v1/admin/accounts/${account.id}/password`, {
      method: "PUT",
      body: JSON.stringify({ temporaryPassword: temporaryPassword.value }),
    });
    accounts.value = accounts.value.map((item) => (item.id === updated.id ? updated : item));
    notice.value = `${account.username} 的临时密码已设置；旧会话已退出，下次登录必须改密。`;
    cancelPasswordReset();
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : "临时密码没有设置成功。";
  } finally {
    passwordResetSaving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <main class="admin-page">
    <header class="admin-heading"><div><p class="date-line">仅管理员可见</p><h1>账号管理</h1><p>管理注册、账号状态和基础服务运行情况。</p></div><button class="text-action" type="button" @click="router.push('/settings')">返回设置 →</button></header>
    <p v-if="errorMessage" class="form-error" role="alert">{{ errorMessage }}</p>
    <p v-if="notice" class="training-notice" role="status">{{ notice }}</p>
    <section class="admin-accounts operations-health" aria-labelledby="operations-title">
      <div class="panel-heading"><div><h2 id="operations-title">运行状态</h2><p>这里显示真实探测结果，不代表业务任务一定成功。</p></div><button class="text-action" type="button" :disabled="loading" @click="load">刷新</button></div>
      <p v-if="loading">正在检查…</p>
      <div v-else-if="operationsHealth" class="health-grid">
        <article v-for="component in ([['API', operationsHealth.api], ['PostgreSQL', operationsHealth.database], ['后台任务', operationsHealth.worker]] as const)" :key="component[0]" class="health-item">
          <div><strong>{{ component[0] }}</strong><p>{{ formatLastSeen(component[1].lastSeenAt) }}</p></div>
          <span class="status-chip" :data-status="component[1].status">{{ statusLabels[component[1].status] }}</span>
        </article>
      </div>
      <div v-if="operationsSummary" class="operations-summary-grid">
        <article class="health-item"><div><strong>视觉模型</strong><p>{{ operationsSummary.model.configured ? operationsSummary.model.model : '未配置，手工记餐仍可用' }}</p></div><span class="status-chip">{{ operationsSummary.model.configured ? '已配置' : '未配置' }}</span></article>
        <article class="health-item"><div><strong>后台任务</strong><p>等待 {{ operationsSummary.tasks.pending }} · 执行中 {{ operationsSummary.tasks.running }} · 失败 {{ operationsSummary.tasks.failed }}</p></div><span class="status-chip" :data-tone="operationsSummary.tasks.failed > 0 ? 'danger' : undefined">{{ operationsSummary.tasks.failed > 0 ? '需检查' : '无失败' }}</span></article>
        <article class="health-item"><div><strong>临时媒体</strong><p>可用 {{ operationsSummary.media.available }} · 待删除 {{ operationsSummary.media.deletion_pending }} · 缺失 {{ operationsSummary.media.missing }}</p></div><span class="status-chip" :data-tone="operationsSummary.media.expiredAvailable > 0 ? 'danger' : undefined">过期未删 {{ operationsSummary.media.expiredAvailable }}</span></article>
        <article class="health-item"><div><strong>临时媒体磁盘</strong><p>{{ formatBytes(operationsSummary.disk.availableBytes) }}</p></div><span class="status-chip">主机实际值</span></article>
        <article class="health-item"><div><strong>最近备份</strong><p>成功：{{ formatEvent(operationsSummary.backup.lastSucceededAt) }}<br />失败：{{ formatEvent(operationsSummary.backup.lastFailedAt) }}</p></div><span class="status-chip">不含临时原图</span></article>
        <article class="health-item"><div><strong>恢复验证</strong><p>成功：{{ formatEvent(operationsSummary.restoreVerification.lastSucceededAt) }}<br />失败：{{ formatEvent(operationsSummary.restoreVerification.lastFailedAt) }}</p></div><span class="status-chip">还需异机演练</span></article>
      </div>
    </section>
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
          <button class="text-action" type="button" @click="beginPasswordReset(account)">设置临时密码</button>
          <button class="text-action" type="button" @click="toggleAccount(account)">{{ account.status === "active" ? "停用" : "恢复" }}</button>
        </div>
        <span v-else class="status-chip">当前账号</span>
        <form v-if="passwordResetTargetId === account.id" class="admin-password-reset" @submit.prevent="resetPassword(account)">
          <label><span>一次性临时密码</span><input v-model="temporaryPassword" type="password" minlength="12" maxlength="128" autocomplete="new-password" :aria-label="`为 ${account.username} 设置临时密码`" required /><small>请通过安全渠道交给对方；提交后页面不会保存或再次显示。</small></label>
          <div class="form-actions"><button class="action-button action-button--primary" type="submit" :disabled="passwordResetSaving">{{ passwordResetSaving ? '正在设置…' : '确认设置并退出旧会话' }}</button><button class="text-action" type="button" @click="cancelPasswordReset">取消</button></div>
        </form>
      </article>
    </section>
  </main>
</template>
