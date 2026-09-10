<script setup lang="ts">
import { ref, watch } from "vue";
import ExerciseNameField from "../../components/ExerciseNameField.vue";
import ExerciseGuidanceCard from "../../components/ExerciseGuidanceCard.vue";
import { trainingApi, type ExerciseGuidance } from "../../api/training";
import { blankSet, expandSets, type ActionDraft } from "./record-draft";
const item = defineModel<ActionDraft>({ required: true });
defineEmits<{ remove: [] }>();
const error = ref("");
const guidanceOpen = ref(false), guidance = ref<ExerciseGuidance | null>(null);
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
    <div class="action-name-heading"><ExerciseNameField v-model="item.name" label="动作名称" required /><button class="text-action" type="button" @click="$emit('remove')">移除动作</button></div>
    <button class="text-action" type="button" :disabled="!item.name.trim()" @click="preview">{{ guidanceOpen ? '收起预览' : '动作预览' }}</button>
    <ExerciseGuidanceCard v-if="guidanceOpen" :exercise-name="item.name" :guidance="guidance" />
    <label><span>记录方式</span><select v-model="item.measurement"><option value="sets">按组记录（力量／自重）</option><option value="activity">时长／距离</option><option value="count">只记次数（组数未知）</option><option value="unknown">只记动作（数量未知）</option><option value="mixed">其他／完整字段</option></select></label>
    <div v-if="item.measurement === 'sets' && !item.expanded" class="record-quantities">
      <label><span>组数</span><input v-model="item.count" type="text" inputmode="numeric" min="1" max="100" placeholder="未记录" /></label>
      <label><span>每组次数</span><input v-model="item.sets[0]!.reps" type="text" inputmode="numeric" min="0" placeholder="未记录" /></label>
      <label><span>重量 kg（可选）</span><input v-model="item.sets[0]!.weightKg" inputmode="decimal" placeholder="未记录" /></label>
    </div>
    <button v-if="item.measurement === 'sets' && !item.expanded" class="text-action" type="button" @click="expand">各组不同，展开调整</button>
    <div v-if="item.measurement !== 'unknown' && (item.measurement !== 'sets' || item.expanded)">
      <div v-for="(set, index) in item.sets" :key="index" class="record-quantities">
        <strong v-if="item.measurement === 'sets'">第 {{ index + 1 }} 组</strong>
        <label v-if="item.measurement !== 'activity'"><span>次数</span><input v-model="set.reps" type="text" inputmode="numeric" min="0" placeholder="未记录" /></label>
        <label v-if="item.measurement !== 'activity'"><span>重量 kg（可选）</span><input v-model="set.weightKg" inputmode="decimal" placeholder="未记录" /></label>
        <label v-if="['activity', 'mixed'].includes(item.measurement)"><span>时长（秒）</span><input v-model="set.durationSeconds" type="text" inputmode="numeric" min="0" placeholder="未记录" /></label>
        <label v-if="['activity', 'mixed'].includes(item.measurement)"><span>距离（米）</span><input v-model="set.distanceMeters" inputmode="decimal" placeholder="未记录" /></label>
        <label v-if="item.expanded || set.note"><span>本项备注</span><input v-model="set.note" maxlength="500" /></label>
        <button v-if="item.sets.length > 1" class="text-action" type="button" @click="item.sets.splice(index, 1)">移除此项</button>
      </div>
      <button v-if="item.expanded || item.measurement === 'mixed'" class="text-action" type="button" :disabled="item.sets.length >= 100" @click="item.sets.push(blankSet())">添加一项</button>
    </div>
    <p v-if="error" role="alert" class="form-error">{{ error }}</p>
    <label><span>动作备注（可选）</span><input v-model="item.note" maxlength="1000" placeholder="例如辅助量、负重或体感" /></label>
  </section>
</template>
<style scoped>
.record-action { display: grid; gap: var(--space-sm); padding-block: var(--space-md); border-bottom: 1px solid var(--color-rule); min-width: 0; }
.record-quantities { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 8rem), 1fr)); gap: var(--space-sm); margin-block: var(--space-sm); }
label { display: grid; gap: var(--space-xs); min-width: 0; } input, select { width: 100%; min-width: 0; min-height: 2.75rem; padding: var(--space-xs) var(--space-sm); border: 1px solid var(--color-rule-strong); border-radius: var(--radius-sm); background: var(--color-paper); }
.action-name-heading { display: flex; align-items: end; flex-wrap: wrap; gap: var(--space-sm); } .action-name-heading > div { flex: 1; min-width: min(100%, 10rem); display: grid; }
.text-action { white-space: nowrap; justify-self: start; }
</style>
