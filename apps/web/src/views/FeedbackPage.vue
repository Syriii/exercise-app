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
const reportFailed = ref(false);

async function generateProblemReport() {
  generating.value = true;
  notice.value = "";
  reportFailed.value = false;
  try {
    problemReport.value = await buildProblemReport(problemDescription.value);
    notice.value = "报告已生成，请先检查内容。";
  } catch {
    reportFailed.value = true;
    notice.value = "暂时生成不了报告，你填写的描述仍保留，请稍后重试。";
  } finally {
    generating.value = false;
  }
}

async function copyProblemReport() {
  if (problemReport.value.length === 0) return;
  notice.value = await copyText(problemReport.value)
    ? "报告已复制。请通过你与应用维护者已有的联系方式粘贴发送。"
    : "浏览器没有允许自动复制，请在报告框中全选并复制。";
}

function downloadCurrentProblemReport() {
  if (problemReport.value.length === 0) return;
  downloadProblemReport(problemReport.value);
  notice.value = "报告已下载，尚未发送。检查文件后，可作为附件发给应用维护者。";
}

function clearProblemDiagnostics() {
  clearDiagnosticEvents();
  problemReport.value = "";
  reportFailed.value = false;
  notice.value = "本机近期错误记录已清除，训练、饮食和身体记录没有改变。";
}
</script>

<template>
  <AppShell page-class="feedback-page" rail-note="遇到问题时，从这里生成报告。">
    <header class="view-header">
      <div><h1>帮助与反馈</h1><p>写下问题，检查报告后再分享给应用维护者。</p></div>
      <button class="action-button" type="button" @click="router.push({ name: 'settings' })">返回设置</button>
    </header>

    <section class="work-panel problem-report-panel" aria-labelledby="problem-report-title">
      <div class="panel-heading"><div><h2 id="problem-report-title">发生了什么</h2><p>说明刚才的操作、看到的结果和你原本的预期。</p></div><span class="status-chip">不会自动上传</span></div>
      <label class="problem-description"><span>问题描述（可选）</span><textarea v-model="problemDescription" rows="5" maxlength="2000" placeholder="例如：保存体重后页面提示服务器暂时无法处理。不要填写密码、Key 或其他敏感信息。" /></label>
      <div class="form-actions">
        <button class="action-button action-button--primary" type="button" :disabled="generating" @click="generateProblemReport">{{ generating ? '正在生成…' : '生成问题报告' }}</button>
        <button v-if="problemReport" class="action-button" type="button" @click="copyProblemReport">复制报告</button>
        <button v-if="problemReport" class="action-button" type="button" @click="downloadCurrentProblemReport">下载报告</button>
      </div>
      <p v-if="notice" :class="reportFailed ? 'form-error' : 'data-note'" :role="reportFailed ? 'alert' : 'status'">{{ notice }}</p>
      <label v-if="problemReport" class="problem-report-preview"><span>报告预览</span><textarea :value="problemReport" rows="16" readonly spellcheck="false" @focus="($event.target as HTMLTextAreaElement).select()" /></label>
      <p class="data-note">本页不会自动提交反馈。复制或下载后，请通过你与应用维护者已有的联系方式发送。</p>
      <details class="feedback-privacy"><summary>报告包含什么</summary><p>自动附加的信息仅包含当前页面、浏览器环境、服务状态和近期错误，不读取密码、照片或训练饮食明细。你填写的问题描述也会加入报告，分享前请检查是否包含个人信息。</p><button class="text-action" type="button" @click="clearProblemDiagnostics">清除本机错误记录</button></details>
    </section>
  </AppShell>
</template>
