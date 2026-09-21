<script setup lang="ts">
import { ref, watch } from 'vue';
import type { Measurement } from './record-draft';
const props = withDefaults(defineProps<{ item: {
  targetSets: string | number; targetRepsMin: string | number; targetRepsMax: string | number;
  targetWeightKg: string; targetDurationSeconds: string | number; targetDistanceMeters: string;
}; measurement?: Measurement; minimumLabel?: string; maximumLabel?: string; weightLabel?: string }>(), {
  minimumLabel: '最低次数', maximumLabel: '最高次数', weightLabel: '目标重量 kg',
});
const hasStrength = () => !!(props.item.targetSets || props.item.targetRepsMin || props.item.targetRepsMax || props.item.targetWeightKg);
const hasActivity = () => !!(props.item.targetDurationSeconds || props.item.targetDistanceMeters);
const activity = ref(!hasStrength() && (hasActivity() || props.measurement === 'activity'));
const extra = ref(hasStrength() && hasActivity());
const typeChosen = ref(false);
const moreInitiallyOpen = !!props.item.targetRepsMax;
// A picker hint affects only empty, untouched forms, never quantities already entered.
watch(() => props.measurement, value => {
  if (!typeChosen.value && !hasStrength() && !hasActivity()) activity.value = value === 'activity';
});
</script>
<template>
  <div class="plan-target-fields">
    <label class="target-type"><span class="sr-only">目标类型</span><select v-model="activity" @change="typeChosen = true"><option :value="false">组数 / 次数</option><option :value="true">时长 / 距离</option></select></label>
    <div class="target-quantities" :class="{ 'target-quantities--activity': activity && !extra }">
      <template v-if="!activity || extra">
        <label>组数<input v-model="item.targetSets" aria-label="目标组数" inputmode="numeric" type="number" min="1" placeholder="—" /></label>
        <label>{{ item.targetRepsMax ? '最少次数' : '次数' }}<input v-model="item.targetRepsMin" :aria-label="minimumLabel" inputmode="numeric" type="number" min="1" placeholder="—" /></label>
        <label>重量 kg<input v-model="item.targetWeightKg" :aria-label="weightLabel" inputmode="decimal" placeholder="—" /></label>
      </template>
      <template v-if="activity || extra">
        <label>时长（秒）<input v-model="item.targetDurationSeconds" aria-label="目标时长（秒）" type="number" inputmode="numeric" min="1" placeholder="—" /></label>
        <label>距离（米）<input v-model="item.targetDistanceMeters" aria-label="目标距离（米）" inputmode="decimal" placeholder="—" /></label>
      </template>
    </div>
    <details :open="moreInitiallyOpen"><summary>更多目标{{ item.targetRepsMax ? ' · 次数范围' : '' }}</summary><label>最多次数<input v-model="item.targetRepsMax" :aria-label="maximumLabel" inputmode="numeric" type="number" min="1" placeholder="—" /></label><button class="text-action" type="button" :aria-pressed="extra" @click="extra = !extra">其他量</button><p class="field-help">未知可留空；次数只填下限时不假定上限。收起字段保留已填值。</p></details>
    <small v-if="!extra && (activity ? !!(item.targetSets || item.targetRepsMin || item.targetRepsMax || item.targetWeightKg) : !!(item.targetDurationSeconds || item.targetDistanceMeters))">其他量已有填写，切换类型不会清空。</small>
  </div>
</template>
<style scoped>
.plan-target-fields { grid-column: 1 / -1; display:grid; gap:var(--space-sm); min-width:0; }
.measurement-chips { display:flex; flex-wrap:wrap; gap:var(--space-xs); }
.target-quantities { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:var(--space-xs); }
.target-quantities--activity { grid-template-columns:repeat(2,minmax(0,1fr)); }
.target-type { justify-self:start; } .target-type select { min-height:44px; max-width:100%; }
label { display:grid; gap:var(--space-xs); min-width:0; font-size:var(--text-sm); }
input { width:100%; min-width:0; min-height:44px; padding:var(--space-xs); border:1px solid var(--color-rule-strong); border-radius:var(--radius-sm); background:var(--color-paper); color:var(--color-ink); }
</style>
