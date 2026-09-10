<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import AppShell from "../app/AppShell.vue";
import { ApiError } from "../api/client";
import { trainingApi, type TrainingSession, type TrainingTemplate, type TrainingProgram, type TrainingSchedule } from "../api/training";
import RecordActionFields from "../features/training/RecordActionFields.vue";
import { actionFromPlan, actionSummary, blankAction, emptyRecord, recordFromActual, recordPayload, type RecordDraft } from "../features/training/record-draft";
import { submissionId } from "../support/submission-id";

const router = useRouter(), route = useRoute();
function today() { const d = new Date(); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-"); }
const date = ref(today()), sessions = ref<TrainingSession[]>([]), templates = ref<TrainingTemplate[]>([]), programs = ref<TrainingProgram[]>([]), schedules = ref<TrainingSchedule[]>([]);
const draft = ref<RecordDraft | null>(null), saving = ref(false), loading = ref(false), error = ref(""), notice = ref("");
const names = ref(""), selectedTemplate = ref(""), conflicting = ref(false), latest = ref<TrainingSession | null>(null), deletedConflict = ref(false);
const visibleRecords = computed(() => sessions.value.filter(s => s.localDate === date.value));
const previousRecord = computed(() => sessions.value.find(s => s.status !== "in_progress" && s.items.some(i => i.status === "completed")));
const todayPlans = computed(() => schedules.value.filter(s => s.status === "scheduled"));
function report(e: unknown) { error.value = e instanceof Error ? e.message : "暂时保存不了，输入已保留。"; }
function mayReplace() { return draft.value === null || window.confirm("当前还有未保存的训练内容。放弃这些输入并打开另一条记录吗？"); }
function clearConflict() { conflicting.value = false; latest.value = null; deletedConflict.value = false; }
function begin() { if (!mayReplace()) return; draft.value = emptyRecord(date.value); names.value = ""; error.value = ""; notice.value = ""; clearConflict(); }
function addNames() {
  if (!draft.value) return;
  const incoming = names.value.split(/[\n、,，]/).map(v => v.trim()).filter(Boolean);
  if (draft.value.items.length + incoming.length > 50) { error.value = "每条最多记录 50 个动作。"; return; }
  draft.value.items.push(...incoming.map(blankAction)); names.value = "";
}
function addAction() { if (draft.value && draft.value.items.length < 50) draft.value.items.push(blankAction()); }
function importTemplate() {
  const source = templates.value.find(t => t.id === selectedTemplate.value);
  if (!source || !draft.value) return;
  if (draft.value.items.length + source.items.length > 50) { error.value = "合并后超过 50 个动作，请先移除不需要的内容。"; return; }
  draft.value.items.push(...source.items.map(actionFromPlan));
  notice.value = "已复制计划目标，请删掉没做的动作，并核对实际数量；尚未保存为训练记录。";
  selectedTemplate.value = "";
}
function copyPrevious() {
  if (!previousRecord.value || !draft.value) return;
  const items = recordFromActual(previousRecord.value).items.map(item => ({ ...item, id: submissionId() }));
  if (draft.value.items.length + items.length > 50) { error.value = "合并后超过 50 个动作。"; return; }
  draft.value.items.push(...items);
  notice.value = "已复制上次实际内容。请删改为本次确实做过的动作和数量。";
}
async function edit(record: TrainingSession) {
  if (!mayReplace()) return;
  try { draft.value = recordFromActual(await trainingApi.getSession(record.id)); names.value = ""; clearConflict(); error.value = "";
    notice.value = record.status === "in_progress" ? "旧记录中已确认完成的动作已带入；待完成的计划没有当作实际记录。" : ""; }
  catch (e) { report(e); }
}
async function save() {
  if (!draft.value || saving.value || conflicting.value) return;
  saving.value = true; error.value = "";
  try {
    if (names.value.trim()) { addNames(); if (names.value.trim()) throw new Error("还有未加入的动作，请处理后再保存。"); }
    const input = recordPayload(draft.value);
    const saved = await trainingApi.saveRecord(draft.value.id, input);
    date.value = saved.localDate; draft.value = null; names.value = ""; notice.value = "这次训练已保存。"; clearConflict();
    await loadData();
  } catch (e) {
    report(e);
    if (e instanceof ApiError && (e.status === 409 || e.status === 404)) { conflicting.value = true; await inspectConflict(); }
  } finally { saving.value = false; }
}
async function inspectConflict() {
  if (!draft.value) return;
  try { latest.value = await trainingApi.getSession(draft.value.id); deletedConflict.value = false; }
  catch (e) { if (e instanceof ApiError && e.status === 404) { latest.value = null; deletedConflict.value = true; } else report(e); }
}
function useLatest() {
  if (!latest.value || !window.confirm("放弃当前输入，改用刚读取的最新记录？")) return;
  draft.value = recordFromActual(latest.value); clearConflict(); error.value = "";
}
function rebase() {
  if (!draft.value || !latest.value || !window.confirm("已核对下方最新记录？继续后，下次保存将用当前输入替换它；不会自动合并。")) return;
  draft.value.revision = latest.value.revision; clearConflict(); error.value = ""; notice.value = "已使用最新版本号，请再次检查并保存。";
}
function saveAsNew() {
  if (!draft.value || !window.confirm("原记录已删除。将这些输入作为一条新记录保留？")) return;
  draft.value.id = submissionId(); draft.value.revision = 0;
  draft.value.items.forEach(item => item.id = submissionId()); clearConflict(); error.value = "";
}
function discard() { if (window.confirm("放弃这次尚未保存的输入？已保存的记录不会删除。")) { draft.value = null; names.value = ""; clearConflict(); error.value = ""; } }
async function remove(record: Pick<TrainingSession, "id" | "revision" | "localDate">) {
  if (saving.value || !window.confirm("删除 " + record.localDate + " 的这条训练记录？它将不再计入今天和历史。")) return;
  saving.value = true; error.value = "";
  try { await trainingApi.deleteRecord(record.id, record.revision); if (draft.value?.id === record.id) draft.value = null; notice.value = "训练记录已删除。"; await loadData(); }
  catch (e) { report(e); if (e instanceof ApiError && e.status === 409) { error.value = "记录已被修改，请核对刷新后的内容，再决定是否删除。"; await loadData(); } }
  finally { saving.value = false; }
}
let loadSequence = 0;
async function loadData() {
  const sequence = ++loadSequence;
  loading.value = true;
  const results = await Promise.allSettled([trainingApi.listSessions(), trainingApi.listTemplates(), trainingApi.listPrograms(), trainingApi.listSchedules(date.value, date.value)] as const);
  if (sequence !== loadSequence) return;
  const [a,b,c,d] = results;
  if (a.status === "fulfilled") sessions.value = [...a.value].sort((a, b) => b.localDate.localeCompare(a.localDate) || (b.recordedTime ?? "").localeCompare(a.recordedTime ?? "") || b.createdAt.localeCompare(a.createdAt));
  if (b.status === "fulfilled") templates.value = b.value;
  if (c.status === "fulfilled") programs.value = c.value;
  if (d.status === "fulfilled") schedules.value = d.value;
  else schedules.value = [];
  const failed = results.find(r => r.status === "rejected");
  if (failed?.status === "rejected") report(failed.reason);
  loading.value = false;
}
let queryBusy = false;
async function handleQuery() {
  if (queryBusy || route.name !== "training" || !Object.keys(route.query).length) return;
  queryBusy = true;
  try {
    const query = { ...route.query };
    if (query.templateId) templates.value = await trainingApi.listTemplates();
    if (query.programId) programs.value = await trainingApi.listPrograms();
    if (query.edit) { const value = await trainingApi.getSession(String(query.edit)); await edit(value); }
    else if (query.templateId || query.programId || query.new) {
      if (mayReplace()) {
        draft.value = emptyRecord(date.value); names.value = ""; clearConflict();
        const items = query.templateId ? templates.value.find(t => t.id === query.templateId)?.items
          : programs.value.find(p => p.id === query.programId)?.units.find(u => u.id === query.unitId)?.items;
        if (items) { draft.value.items = items.map(actionFromPlan); notice.value = "计划只作为填写参考；请核对实际完成的动作和数量后保存。"; }
        else if (!query.new) error.value = "来源计划已不存在，可以直接填写本次实际内容。";
      }
    }
    await router.replace({ name: "training" });
  } catch(e) { report(e); }
  finally { queryBusy = false; }
}
function referenceSchedule(schedule: TrainingSchedule) {
  if (schedule.sourceTemplateId) void router.push({ name: "training", query: { templateId: schedule.sourceTemplateId } });
  else if (schedule.sourceProgramId) void router.push({ name: "training", query: { programId: schedule.sourceProgramId, unitId: schedule.sourceProgramUnitId ?? "" } });
}
function beforeUnload(e: BeforeUnloadEvent) { if (draft.value) { e.preventDefault(); e.returnValue = ""; } }
window.addEventListener("beforeunload", beforeUnload);
onBeforeUnmount(() => window.removeEventListener("beforeunload", beforeUnload));
onActivated(async () => { await loadData(); await handleQuery(); });
watch(() => route.fullPath, () => void handleQuery());
watch(date, () => { if (route.name === "training") void loadData(); });
</script>

<template>
  <AppShell page-class="training-page" rail-note="计划是参考，记录只写实际做过的内容。" show-footer>
    <header class="view-header"><div><h1>训练</h1><p>看计划，或一次记下练过的内容。</p></div><button class="action-button" @click="router.push('/training/plans')">查看／管理计划</button></header>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p><p v-if="notice" class="training-notice" role="status">{{ notice }}</p>
    <section v-if="draft" class="work-panel" aria-label="训练记录编辑">
      <form @submit.prevent="save">
        <fieldset :disabled="saving" class="record-fields">
          <div class="panel-heading"><h2>{{ draft.revision ? "修改训练记录" : "记录训练内容" }}</h2><span>尚未保存</span></div>
          <div class="record-meta">
            <label><span>训练日期</span><input v-model="draft.localDate" type="date" required /></label>
            <label><span>大致时间（可选）</span><input v-model="draft.time" type="time" /></label>
          </div>
          <p class="data-note">填写实际做过的内容，数量不清楚可以留空。切换页面会保留输入；刷新或关闭应用不会保存草稿。</p>
          <details><summary>参考计划或上次内容</summary><div class="record-source"><label><span>选择计划</span><select v-model="selectedTemplate"><option value="">请选择</option><option v-for="plan in templates" :key="plan.id" :value="plan.id">{{ plan.name }}</option></select></label><button type="button" class="action-button" :disabled="!selectedTemplate" @click="importTemplate">加入参考内容</button><button type="button" class="action-button" :disabled="!previousRecord" @click="copyPrevious">使用上次实际内容</button></div><p>参考内容不是本次完成量。请移除未做的动作并核对数量。</p></details>
          <RecordActionFields v-for="(item, index) in draft.items" :key="item.id" v-model="draft.items[index]!" @remove="draft.items.splice(index, 1)" />
          <button type="button" class="action-button" :disabled="draft.items.length >= 50" @click="addAction">添加动作</button>
          <details><summary>一次添加多个动作</summary><label><span>动作名称，每行一个</span><textarea v-model="names" rows="3" placeholder="深蹲&#10;俯卧撑&#10;跑步" /></label><button type="button" class="action-button" @click="addNames">加入这些动作</button></details>
          <label><span>本次备注（可选）</span><textarea v-model="draft.note" rows="2" maxlength="1000" /></label>
          <div class="form-actions"><button class="action-button action-button--primary" type="submit" :disabled="conflicting">{{ saving ? "保存中…" : "保存训练记录" }}</button><button class="text-action" type="button" @click="discard">放弃未保存内容</button></div>
          <button v-if="draft.revision > 0" type="button" class="text-action" @click="remove({ id: draft.id, revision: draft.revision, localDate: draft.localDate })">删除这条已存记录</button>
        </fieldset>
      </form>
      <section v-if="conflicting" class="record-conflict" aria-label="记录冲突">
        <h3>先核对最新记录</h3><p>你的输入仍保留，未覆盖其他修改。</p>
        <template v-if="latest"><p>{{ latest.localDate }} · {{ latest.recordedTime ?? '时间未记录' }} · {{ latest.note }}</p><ul><li v-for="item in latest.items.filter(i => i.status === 'completed')" :key="item.id">{{ item.performedExerciseName ?? item.exerciseName }}：{{ actionSummary(item) }}</li></ul><div class="form-actions"><button class="action-button" @click="useLatest">改用最新内容</button><button class="action-button" @click="rebase">已核对，用我的内容替换</button></div></template>
        <template v-else-if="deletedConflict"><p>原记录已被删除，不能覆盖或恢复原记录。</p><button class="action-button" @click="saveAsNew">作为新记录保留输入</button></template>
        <button v-else class="action-button" @click="inspectConflict">重试读取最新记录</button>
      </section>
    </section>
    <template v-else>
      <section class="work-panel"><div class="panel-heading"><h2>{{ date === today() ? "今天的训练" : "训练记录" }}</h2><label><span class="sr-only">查看日期</span><input v-model="date" type="date" aria-label="查看日期" /></label></div>
        <div v-if="todayPlans.length" class="record-plans"><article v-for="plan in todayPlans" :key="plan.id"><strong>{{ plan.title }}</strong><button class="text-action" @click="referenceSchedule(plan)">参考计划记录</button></article></div>
        <p v-if="!visibleRecords.length && !loading">这一天还没有训练记录。练完后，一次记下来就好。</p>
        <button class="action-button action-button--primary" @click="begin">记录训练内容</button>
      </section>
      <p v-if="loading" role="status">正在读取训练内容…</p>
      <article v-for="record in visibleRecords" :key="record.id" class="work-panel saved-training" aria-label="已存训练记录">
        <div class="panel-heading"><h2>{{ record.status === 'in_progress' ? '旧版未完成记录' : '已记录的训练' }}</h2><span>{{ record.recordedTime ?? '时间未记录' }}</span></div>
        <ul><li v-for="item in record.items.filter(i => i.status === 'completed')" :key="item.id"><strong>{{ item.performedExerciseName ?? item.exerciseName }}</strong><span>{{ actionSummary(item) }}</span><p v-if="item.actualNote">{{ item.actualNote }}</p></li></ul>
        <p v-if="!record.items.some(i => i.status === 'completed')">尚无已确认完成的动作。</p><p v-if="record.note">{{ record.note }}</p>
        <div class="form-actions"><button class="action-button" :disabled="saving" @click="edit(record)">修改整条记录</button><button class="text-action" :disabled="saving" @click="remove(record)">删除记录</button></div>
      </article>
    </template>
  </AppShell>
</template>
<style scoped>
.record-fields { border: 0; padding: 0; margin: 0; min-width: 0; display: grid; gap: var(--space-md); }
.record-meta, .record-source { display: flex; gap: var(--space-sm); flex-wrap: wrap; align-items: end; }
label { display: grid; gap: var(--space-xs); min-width: 0; } input, textarea, select { max-width: 100%; min-width: 0; } textarea { width: 100%; }
input, textarea, select { min-height: 2.75rem; padding: var(--space-xs) var(--space-sm); border: 1px solid var(--color-rule-strong); border-radius: var(--radius-sm); background: var(--color-paper); }
.record-source { margin-block: var(--space-md); } .record-source label { flex: 1; min-width: min(100%, 10rem); }
.saved-training { margin-top: var(--space-md); } .saved-training li { margin-block: var(--space-sm); overflow-wrap: anywhere; } .saved-training li span { display: block; }
.record-plans article { display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--space-sm); margin-block: var(--space-md); }
.record-conflict { border-top: 1px solid var(--color-rule); margin-top: var(--space-md); padding-top: var(--space-md); }
.panel-heading { flex-wrap: wrap; } summary { cursor: pointer; padding-block: var(--space-xs); }
</style>
