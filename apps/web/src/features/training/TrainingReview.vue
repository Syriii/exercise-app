<script setup lang="ts">
import { ref } from "vue";
import { trainingApi, type TrainingSession, type TrainingSessionRevision, type TrainingSessionItemRevision, type TrainingExpenditureActivity, type TrainingExpenditureActivityCode } from "../../api/training";
const props = defineProps<{ record: TrainingSession }>();
const emit = defineEmits<{ saved: [] }>();
const activities = ref<TrainingExpenditureActivity[]>([]), revisions = ref<TrainingSessionRevision[]>([]), itemRevisions = ref<TrainingSessionItemRevision[]>([]);
const opened = ref(false), loaded = ref(false), saving = ref(false), error = ref("");
const activity = ref<TrainingExpenditureActivityCode | "">(props.record.expenditureAssessment?.inputSnapshot.activityCode ?? "");
const duration = ref<number | null>(props.record.expenditureAssessment?.inputSnapshot.durationMinutes ?? null);
async function load() {
  error.value = "";
  try { [activities.value, revisions.value, itemRevisions.value] = await Promise.all([trainingApi.listExpenditureActivities(), trainingApi.listSessionRevisions(props.record.id), trainingApi.listItemRevisions(props.record.id)]); loaded.value = true; }
  catch (e) { error.value = e instanceof Error ? e.message : "读取失败，请重试"; }
}
async function toggle(event: Event) { opened.value = (event.target as HTMLDetailsElement).open; if (opened.value && !loaded.value) await load(); }
async function estimate() {
  saving.value = true; error.value = "";
  try { await trainingApi.assessSessionExpenditure(props.record.id, props.record.revision, activity.value || null, activity.value ? duration.value : null); emit("saved"); await load(); }
  catch (e) { error.value = e instanceof Error ? e.message : "估算失败，请核对后重试"; }
  finally { saving.value = false; }
}
</script>
<template>
  <details @toggle="toggle"><summary>消耗估算与修订记录</summary>
    <div v-if="opened">
      <p v-if="error" role="alert">{{ error }} <button class="text-action" @click="load">重试读取</button></p>
      <p v-if="record.expenditureAssessment">{{ record.expenditureAssessment.status === 'estimated' ? `总消耗约 ${record.expenditureAssessment.grossEnergyKcal} kcal，净活动消耗约 ${record.expenditureAssessment.netEnergyKcal} kcal` : '当前条件无法估算' }}</p>
      <details v-if="record.expenditureAssessment"><summary>计算依据与限制</summary><p>{{ record.expenditureAssessment.formula }}</p><p>采用 {{ record.expenditureAssessment.inputSnapshot.weightMeasurement?.localDate ?? '未知日期' }} 的 {{ record.expenditureAssessment.inputSnapshot.weightMeasurement?.weightKg ?? '未知' }} kg；{{ record.expenditureAssessment.evidenceIds.join('、') }}</p><p v-for="message in [...record.expenditureAssessment.messages, ...record.expenditureAssessment.limitations]" :key="message">{{ message }}</p></details>
      <form v-if="loaded && record.status !== 'in_progress'" class="planning-form" @submit.prevent="estimate"><label>与本次训练完全相符的官方活动模式<select v-model="activity"><option value="">没有完全相符的模式</option><option v-for="item in activities" :key="item.code" :value="item.code">{{ item.label }} · {{ item.description }}</option></select></label><label v-if="activity">有效训练时长（分钟）<input v-model.number="duration" type="number" min="1" max="720" required /></label><p>仅用于训练回顾，不增加饮食额度。只填写实际有效时长。</p><button class="action-button" type="submit" :disabled="saving">保存估算</button></form>
      <details v-if="revisions.length"><summary>查看整条记录的之前版本</summary><ul><li v-for="revision in revisions" :key="revision.id">{{ revision.localDate }} · {{ revision.note ?? '无备注' }} · 版本 {{ revision.sessionRevision }}</li></ul></details>
      <details v-if="itemRevisions.length"><summary>查看动作的之前版本</summary><ul><li v-for="revision in itemRevisions" :key="revision.id">{{ revision.performedExerciseName ?? '未确认的动作' }} · {{ revision.status }} · {{ revision.sets.length ? revision.sets.length + ' 项数量记录' : '数量未记录' }}</li></ul></details>
    </div>
  </details>
</template>
