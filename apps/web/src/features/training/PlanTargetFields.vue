<script setup lang="ts">
import { ref } from 'vue';
const props = withDefaults(defineProps<{ item: {
  targetSets: string | number; targetRepsMin: string | number; targetRepsMax: string | number;
  targetWeightKg: string; targetDurationSeconds: string | number; targetDistanceMeters: string;
}; minimumLabel?: string; maximumLabel?: string; weightLabel?: string }>(), {
  minimumLabel: '最低次数', maximumLabel: '最高次数', weightLabel: '目标重量 kg',
});
const activity = ref(!props.item.targetSets && !!(props.item.targetDurationSeconds || props.item.targetDistanceMeters));
const extra = ref(!!props.item.targetSets && !!(props.item.targetDurationSeconds || props.item.targetDistanceMeters));
</script>
<template>
  <div class="plan-target-fields">
    <div class="measurement-chips" role="group" aria-label="目标类型">
      <button class="category-chip" type="button" :aria-pressed="!activity" @click="activity = false">按组目标</button>
      <button class="category-chip" type="button" :aria-pressed="activity" @click="activity = true">时长／距离目标</button>
      <button class="text-action" type="button" :aria-expanded="extra" @click="extra = !extra">{{ extra ? '收起其他量' : '其他量' }}</button>
    </div>
    <div class="target-quantities">
      <template v-if="!activity || extra">
        <label>目标组数<input v-model="item.targetSets" inputmode="numeric" type="number" min="1" placeholder="可不填" /></label>
        <label>{{ weightLabel }}<input v-model="item.targetWeightKg" inputmode="decimal" placeholder="可不填" /></label>
        <label>{{ minimumLabel }}<input v-model="item.targetRepsMin" inputmode="numeric" type="number" min="1" placeholder="可不填" /></label>
        <label>{{ maximumLabel }}<input v-model="item.targetRepsMax" inputmode="numeric" type="number" min="1" placeholder="可不填" /></label>
      </template>
      <template v-if="activity || extra">
        <label>目标时长（秒）<input v-model="item.targetDurationSeconds" type="number" inputmode="numeric" min="1" placeholder="可不填" /></label>
        <label>目标距离（米）<input v-model="item.targetDistanceMeters" inputmode="decimal" placeholder="可不填" /></label>
      </template>
    </div>
    <small v-if="!extra && (activity ? !!(item.targetSets || item.targetRepsMin || item.targetRepsMax || item.targetWeightKg) : !!(item.targetDurationSeconds || item.targetDistanceMeters))">其他量已有填写，切换类型不会清空。</small>
  </div>
</template>
<style scoped>
.plan-target-fields { grid-column: 1 / -1; display:grid; gap:var(--space-sm); min-width:0; }
.measurement-chips { display:flex; flex-wrap:wrap; gap:var(--space-xs); }
.target-quantities { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:var(--space-sm); }
label { display:grid; gap:var(--space-xs); min-width:0; font-size:var(--text-sm); }
input { width:100%; min-width:0; min-height:44px; padding:var(--space-xs); border:1px solid var(--color-rule-strong); border-radius:var(--radius-sm); background:var(--color-paper); color:var(--color-ink); }
@media(min-width:40rem) { .target-quantities { grid-template-columns:repeat(4,minmax(0,1fr)); } }
</style>
