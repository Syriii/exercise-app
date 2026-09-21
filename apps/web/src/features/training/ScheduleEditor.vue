<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import { trainingApi, type TrainingSchedule, type TrainingProgressUnit } from "../../api/training";
import { submissionId } from "../../support/submission-id";
import PlanTargetFields from './PlanTargetFields.vue';
import ExercisePicker from './ExercisePicker.vue';
import AppIcon from '../../components/AppIcon.vue';
import type { Measurement } from './record-draft';
const props = defineProps<{ schedule: TrainingSchedule }>();
const emit = defineEmits<{ saved: [TrainingSchedule]; close: [] }>();
const title = ref(props.schedule.title), date = ref(props.schedule.localDate), note = ref(props.schedule.note ?? "");
const fields = ["targetSets", "targetRepsMin", "targetRepsMax", "targetWeightKg", "targetDurationSeconds", "targetDistanceMeters"] as const;
type Field = typeof fields[number];
interface Item { key: string; id?: string; nameInitiallyOpen: boolean; measurement?: Measurement; exerciseName: string; note: string; progressUnit: TrainingProgressUnit; values: Record<Field, string> }
const items = ref<Item[]>((props.schedule.items ?? []).map(item => ({ key: item.id, id: item.id,
  nameInitiallyOpen: false, exerciseName: item.exerciseName, note: item.note ?? "", progressUnit: item.progressUnit,
  values: Object.fromEntries(fields.map(key => [key, item[key]?.toString() ?? ""])) as Record<Field, string> })));
const busy = ref(false), error = ref("");
function add() { if (items.value.length < 50) items.value.push({ key: submissionId(), nameInitiallyOpen: true, exerciseName: "", note: "", progressUnit: "none", values: Object.fromEntries(fields.map(key => [key, ""])) as Record<Field, string> }); }
function pick(name: string, measurement: Measurement) { if (items.value.length >= 50) return; add(); const item = items.value[items.value.length - 1]!; item.exerciseName = name; item.measurement = measurement; item.nameInitiallyOpen = false; }
function move(index: number, offset: number) { const other = index + offset; if (other < 0 || other >= items.value.length) return; const [item] = items.value.splice(index, 1); items.value.splice(other, 0, item!); }
async function save() {
  if (busy.value) return; busy.value = true; error.value = "";
  try {
    const saved = await trainingApi.updateSchedule(props.schedule.id, props.schedule.revision, {
      localDate: date.value, timeZone: props.schedule.timeZone, title: title.value, note: note.value.trim() || null,
      sourceTemplateId: props.schedule.items ? props.schedule.sourceTemplateId : null,
      sourceProgramId: props.schedule.items ? props.schedule.sourceProgramId : null,
      sourceProgramUnitId: props.schedule.items ? props.schedule.sourceProgramUnitId : null,
      items: items.value.map(item => ({ ...(item.id ? { id: item.id } : {}), exerciseName: item.exerciseName,
        note: item.note.trim() || null, progressUnit: item.progressUnit,
        targetSets: number(item.values.targetSets), targetRepsMin: number(item.values.targetRepsMin), targetRepsMax: number(item.values.targetRepsMax),
        targetWeightKg: item.values.targetWeightKg.trim() || null, targetDurationSeconds: number(item.values.targetDurationSeconds),
        targetDistanceMeters: item.values.targetDistanceMeters.trim() || null })),
    }); emit("saved", saved);
  } catch (e) { error.value = e instanceof Error ? e.message : "保存失败，输入已保留。"; }
  finally { busy.value = false; }
}
function number(value: string | number) { if (!String(value).trim()) return null; const n = Number(value); if (!Number.isSafeInteger(n) || n <= 0) throw new Error("数量请填写正整数，未知可留空。"); return n; }
function close() { if (window.confirm("放弃这次尚未保存的日期计划修改？")) emit("close"); }
function unload(e: BeforeUnloadEvent) { e.preventDefault(); e.returnValue = ""; }
window.addEventListener("beforeunload", unload); onBeforeUnmount(() => window.removeEventListener("beforeunload", unload));
</script>
<template>
  <section class="work-panel" aria-label="修改当天计划">
    <h2>修改当天计划</h2>
    <details><summary>修改范围</summary><p>只修改这份日期安排，不改变“我的计划”或其他日期。已有实际记录不变，进度会按新目标重新比较；改期不移动实际记录。</p></details>
    <p v-if="!schedule.items" class="data-note">这是旧版安排，没有可靠的独立内容。请补充并确认当天动作；不会把来源计划的新内容冒充原安排。</p>
    <p v-if="error" role="alert" class="form-error">{{ error }} 若版本已冲突，请先保留所需输入，再关闭并重新打开最新计划核对。</p>
    <form @submit.prevent="save"><fieldset :disabled="busy">
      <details class="compact-metadata"><summary>{{ date }} · {{ title }} · 修改信息</summary><div class="fields"><label>安排日期<input v-model="date" type="date" required /></label><label>计划名称<input v-model="title" required maxlength="80" /></label><label>计划备注<textarea v-model="note" maxlength="1000" /></label></div></details>
      <article v-for="(item,index) in items" :key="item.key" class="plan-item">
        <div class="compact-action-heading"><span class="section-symbol"><AppIcon name="train" /></span><strong>{{ item.exerciseName || '自定义动作' }}</strong><button type="button" class="text-action icon-action" aria-label="移除动作" @click="items.splice(index,1)"><AppIcon name="close" /></button></div>
        <details :open="item.nameInitiallyOpen"><summary>修改名称</summary><label>动作名称<input v-model="item.exerciseName" required maxlength="100" /></label></details>
        <PlanTargetFields :item="item.values" :measurement="item.measurement" minimum-label="每组最少次数" maximum-label="每组最多次数" weight-label="目标重量（kg）" />
        <details><summary>进度与备注{{ item.note ? ' · 已填' : '' }}</summary>
        <label>进度依据<select v-model="item.progressUnit"><option value="none">只展示内容</option><option value="sets">组数</option><option value="seconds">时长（秒）</option><option value="meters">距离（米）</option></select></label>
        <label>动作备注<input v-model="item.note" maxlength="500" /></label>
        <div class="form-actions"><button type="button" class="text-action" :disabled="index === 0" @click="move(index,-1)">上移</button><button type="button" class="text-action" :disabled="index === items.length-1" @click="move(index,1)">下移</button></div>
        </details>
      </article>
      <details :open="!items.length"><summary>添加计划动作</summary><ExercisePicker :disabled="busy || items.length >= 50" @select="pick" /><button type="button" class="text-action" :disabled="items.length >= 50" @click="add">填写自定义动作</button></details>
      <div class="form-actions selection-save-bar"><button type="submit" class="action-button action-button--primary">{{ busy ? '保存中…' : '保存当天计划' }}</button><button type="button" class="text-action" @click="close">关闭修改</button></div>
    </fieldset></form>
  </section>
</template>
<style scoped>
fieldset { border:0; margin:0; padding:0; min-width:0; display:grid; gap:1rem; }
label { display:grid; gap:.4rem; min-width:0; } input,select,textarea { min-height:2.75rem; min-width:0; width:100%; padding:.5rem; border:1px solid var(--color-rule-strong); background:var(--color-paper); border-radius:var(--radius-sm); }
.fields { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,10rem),1fr)); gap:.75rem; }
.plan-item { display:grid; gap:.75rem; border-block-start:1px solid var(--color-rule); padding-block:1rem; }
</style>
