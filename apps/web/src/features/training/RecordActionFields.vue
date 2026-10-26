<script setup lang="ts">
import { ref, watch } from "vue";
import AppIcon from '../../components/AppIcon.vue';
import ExerciseNameField from "../../components/ExerciseNameField.vue";
import ExerciseGuidanceCard from "../../components/ExerciseGuidanceCard.vue";
import { trainingApi, type ExerciseGuidance } from "../../api/training";
import { blankSet, expandSets, type ActionDraft, type SetDraft } from "./record-draft";
import { minutesToSeconds, shiftActivityDecimal } from "./activity-units";
const item = defineModel<ActionDraft>({ required: true });
defineEmits<{ remove: [] }>();
const error = ref("");
const guidanceOpen = ref(false), guidance = ref<ExerciseGuidance | null>(null);
const editingName = ref(!item.value.name);
const durationUnit = ref<"minutes" | "seconds">(item.value.sets.some(set => set.durationSeconds && Number(set.durationSeconds) % 60 !== 0) ? "seconds" : "minutes");
const distanceUnit = ref<"kilometers" | "meters">("kilometers");
function durationValue(value: string) { return durationUnit.value === "seconds" || !value.trim() ? value : String(Number(value) / 60); }
function distanceValue(value: string) { return distanceUnit.value === "meters" ? value : shiftActivityDecimal(value, -3) ?? value; }
function updateDuration(event: Event, set: SetDraft) {
  const input = event.target as HTMLInputElement;
  const value = durationUnit.value === "minutes" ? minutesToSeconds(input.value) : input.value;
  set.durationSeconds = value ?? input.value;
  input.setCustomValidity(value !== null && (!value || (Number.isInteger(Number(value)) && Number(value) >= 0)) ? "" : "请填写可换算为整秒的时长，也可以切换为秒输入。");
}
function updateDistance(event: Event, set: SetDraft) {
  const input = event.target as HTMLInputElement;
  const value = distanceUnit.value === "kilometers" ? shiftActivityDecimal(input.value, 3) : input.value;
  set.distanceMeters = value ?? input.value;
  input.setCustomValidity(value !== null ? "" : "请填写有效的距离。");
}
let guidanceRequest = 0;
watch(() => item.value.name, () => { guidanceRequest++; guidanceOpen.value = false; guidance.value = null; });
async function preview() {
  if (guidanceOpen.value) { guidanceOpen.value = false; guidanceRequest++; return; }
  const request = ++guidanceRequest;
  try { const value = await trainingApi.getGuidance(item.value.name); if (request === guidanceRequest) { guidance.value = value; guidanceOpen.value = true; } }
  catch { if (request === guidanceRequest) error.value = "暂时读不到动作指导，输入没有改变。"; }
}
function expand() { try { expandSets(item.value); error.value = ""; } catch (e) { error.value = (e as Error).message; } }
</script>
<template>
  <section class="record-action" aria-label="动作填写">
    <div class="action-name-heading">
      <label v-if="item.included !== undefined" class="action-included"><input v-model="item.included" type="checkbox" :aria-label="`记录已做：${item.name}`" /><span>{{ item.name }}</span></label>
      <strong v-else-if="!editingName" class="action-title" tabindex="-1">{{ item.name }}</strong>
      <ExerciseNameField v-if="editingName" v-model="item.name" label="动作名称" required />
      <button class="text-action icon-action" aria-label="移除动作" type="button" @click="$emit('remove')"><AppIcon name="close" /></button>
    </div>
    <template v-if="item.included !== false">
    <details class="action-options"><summary><AppIcon name="more" />动作选项</summary>
      <button v-if="!editingName" class="text-action" type="button" @click="editingName = true">修改动作名称</button>
      <button class="text-action" type="button" :disabled="!item.name.trim()" @click="preview">{{ guidanceOpen ? '收起预览' : '动作预览' }}</button>
      <label><span>记录方式</span><select v-model="item.measurement"><option value="sets">按组记录（力量／自重）</option><option value="activity">时长／距离</option><option value="count">只记次数（组数未知）</option><option value="unknown">只记动作（数量未知）</option><option value="mixed">其他／完整字段</option></select></label>
      <label><span>动作备注（可选）</span><input v-model="item.note" maxlength="1000" placeholder="例如辅助量、负重或体感" /></label>
      <button v-if="item.measurement === 'sets' && !item.expanded" class="text-action" type="button" @click="expand">各组不同，展开调整</button>
    </details>
    <ExerciseGuidanceCard v-if="guidanceOpen" :exercise-name="item.name" :guidance="guidance" />
    <div v-if="item.measurement === 'sets' && !item.expanded" class="record-quantities">
      <label><span>组数</span><input v-model="item.count" type="text" inputmode="numeric" min="1" max="100" placeholder="未记录" /></label>
      <label><span>每组次数</span><input v-model="item.sets[0]!.reps" type="text" inputmode="numeric" min="0" placeholder="未记录" /></label>
      <label><span>重量 kg<span class="sr-only">（可选）</span></span><input v-model="item.sets[0]!.weightKg" inputmode="decimal" placeholder="未记录" /></label>
    </div>
    <div v-if="item.measurement !== 'unknown' && (item.measurement !== 'sets' || item.expanded)">
      <div v-for="(set, index) in item.sets" :key="index" class="record-quantities" :class="{ 'record-quantities--activity': item.measurement === 'activity' }">
        <strong v-if="item.measurement === 'sets'">第 {{ index + 1 }} 组</strong>
        <label v-if="item.measurement !== 'activity'"><span>次数</span><input v-model="set.reps" type="text" inputmode="numeric" min="0" placeholder="未记录" /></label>
        <label v-if="item.measurement !== 'activity'"><span>重量 kg<span class="sr-only">（可选）</span></span><input v-model="set.weightKg" inputmode="decimal" placeholder="未记录" /></label>
        <div v-if="['activity', 'mixed'].includes(item.measurement)" class="activity-quantity">
          <label><span>时长单位</span><select v-model="durationUnit" aria-label="时长单位"><option value="minutes">分钟</option><option value="seconds">秒</option></select></label>
          <label><span class="sr-only">{{ durationUnit === 'minutes' ? '时长（分钟）' : '时长（秒）' }}</span><input :value="durationValue(set.durationSeconds)" type="number" inputmode="decimal" min="0" :step="durationUnit === 'seconds' ? '1' : 'any'" placeholder="未记录" @input="updateDuration($event, set)" /></label>
        </div>
        <div v-if="['activity', 'mixed'].includes(item.measurement)" class="activity-quantity">
          <label><span>距离单位</span><select v-model="distanceUnit" aria-label="距离单位"><option value="kilometers">公里</option><option value="meters">米</option></select></label>
          <label><span class="sr-only">{{ distanceUnit === 'kilometers' ? '距离（公里）' : '距离（米）' }}</span><input :value="distanceValue(set.distanceMeters)" type="number" inputmode="decimal" min="0" step="any" placeholder="未记录" @input="updateDistance($event, set)" /></label>
        </div>
        <details v-if="item.expanded || set.note" class="set-note"><summary>备注{{ set.note ? ' · 已填' : '' }}</summary><label><span>本项备注</span><input v-model="set.note" maxlength="500" /></label></details>
        <button v-if="item.sets.length > 1" class="text-action" type="button" @click="item.sets.splice(index, 1)">移除此项</button>
      </div>
      <button v-if="item.expanded || item.measurement === 'mixed'" class="text-action" type="button" :disabled="item.sets.length >= 100" @click="item.sets.push(blankSet())">添加一项</button>
    </div>
    <p v-if="error" role="alert" class="form-error">{{ error }}</p>
    </template>
  </section>
</template>
<style scoped>
.record-action { display: grid; gap: var(--space-xs); padding-block: var(--space-sm); border-bottom: 1px solid var(--color-rule); min-width: 0; }
.record-quantities { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-xs); margin-block: var(--space-xs); }
.record-quantities--activity { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.activity-quantity { display: grid; gap: var(--space-2xs); min-width: 0; align-content: start; }
.activity-quantity > label:first-child { display: flex; flex-wrap: wrap; gap: var(--space-2xs); align-items: center; }
.activity-quantity > label:first-child > span { font-size: var(--text-sm); }
.activity-quantity select { flex: 1; width: auto; min-width: 0; padding-inline: var(--space-xs); }
.record-quantities > strong, .set-note { grid-column: 1 / -1; }
.record-quantities label span { font-size: var(--text-sm); }
.record-quantities input { padding-inline: var(--space-xs); }
.action-included { display: flex; align-items: center; gap: var(--space-xs); min-height: 44px; }
.action-included input { width: 20px; min-height: 20px; }
.action-title { font-weight: 700; color: var(--color-ink); white-space: normal; text-align: start; }
.action-title span { font-size: var(--text-sm); font-weight: 400; color: var(--color-muted); }
.action-options { order: 2; } .action-options[open] { display: grid; gap: var(--space-sm); }
label { display: grid; gap: var(--space-xs); min-width: 0; } input, select { width: 100%; min-width: 0; min-height: 2.75rem; padding: var(--space-xs) var(--space-sm); border: 1px solid var(--color-rule-strong); border-radius: var(--radius-sm); background: var(--color-paper); }
.action-name-heading { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-xs); } .action-name-heading > :first-child { flex: 1; min-width: 0; } .action-name-heading > div { display: grid; }
.text-action { white-space: nowrap; justify-self: start; }
</style>
