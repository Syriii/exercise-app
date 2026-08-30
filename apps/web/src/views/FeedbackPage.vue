<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";

import AppShell from "../app/AppShell.vue";
import {
  buildProblemReport,
  clearDiagnosticEvents,
  copyText,
  downloadProblemReport,
} from "../support/diagnostics";

const router = useRouter();
const problemDescription = ref("");
const problemReport = ref("");
const generating = ref(false);
const notice = ref("");

async function generateProblemReport() {
  generating.value = true;
  notice.value = "";
  try {
    problemReport.value = await buildProblemReport(problemDescription.value);
    notice.value = "报告已生成，请先检查内容。";
  } finally {
    generating.value = false;
  }
}

async function copyProblemReport() {
  if (problemReport.value.length === 0) return;
  notice.value = await copyText(problemReport.value)
    ? "报告已复制，可以直接粘贴到问答中。"
    : "浏览器没有允许自动复制，请在报告框中全选并复制。";
}

function downloadCurrentProblemReport() {
  if (problemReport.value.length === 0) return;
  downloadProblemReport(problemReport.value);
  notice.value = "报告已下载。";
}

function clearProblemDiagnostics() {
  clearDiagnosticEvents();
  problemReport.value = "";
  notice.value = "近期前端日志已清空。";
}
</script>

<template>
  <AppShell page-class="feedback-page" rail-note="遇到问题时，从这里生成报告。">
    <header class="view-header">
      <div><p class="date-line">设置</p><h1>Bug 反馈</h1><p>写下问题，生成一份可以直接复制的报告。</p></div>
      <button class="action-button" type="button" @click="router.push({ name: 'settings' })">返回设置</button>
    </header>

    <section class="work-panel problem-report-panel" aria-labelledby="problem-report-title">
      <div class="panel-heading"><div><h2 id="problem-report-title">发生了什么</h2><p>说明刚才的操作、看到的结果和你原本的预期。</p></div><span class="status-chip">不会自动上传</span></div>
      <label class="problem-description"><span>问题描述（可选）</span><textarea v-model="problemDescription" rows="5" maxlength="2000" placeholder="例如：保存体重后页面提示服务器暂时无法处理。不要填写密码、Key 或其他敏感信息。" /></label>
      <div class="form-actions">
        <button class="action-button action-button--primary" type="button" :disabled="generating" @click="generateProblemReport">{{ generating ? '正在生成…' : '生成问题报告' }}</button>
        <button v-if="problemReport" class="action-button" type="button" @click="copyProblemReport">复制报告</button>
        <button v-if="problemReport" class="action-button" type="button" @click="downloadCurrentProblemReport">下载 .txt</button>
        <button class="text-action" type="button" @click="clearProblemDiagnostics">清空近期日志</button>
      </div>
      <p v-if="notice" class="data-note" role="status">{{ notice }}</p>
      <label v-if="problemReport" class="problem-report-preview"><span>报告预览</span><textarea :value="problemReport" rows="16" readonly spellcheck="false" @focus="($event.target as HTMLTextAreaElement).select()" /></label>
      <p class="data-note">报告只包含当前页面、浏览器环境、服务状态和近期错误，不收集密码、Cookie、API Key、照片或训练饮食明细。分享前请先预览。</p>
    </section>
  </AppShell>
</template>
