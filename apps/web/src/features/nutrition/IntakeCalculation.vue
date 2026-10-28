<script setup lang="ts">
import type { IntakeEvidence } from "../../api/nutrition";
defineProps<{ evidence: IntakeEvidence }>();
const sourceLabels = { measured: "称重", merchant: "商家标示", user_estimate: "数量或用户估计", photo_estimate: "照片估计" };
const display = (value: number | null, unit: string) => value === null ? "未知" : `${Number(value.toFixed(unit === "kcal" ? 1 : 3))} ${unit}`;
</script>
<template>
  <div class="intake-calculation">
    <p class="intake-calculation__total"><strong>{{ display(evidence.amount, evidence.unit) }}</strong><span>实际吃入 · {{ sourceLabels[evidence.quantitySource] }}</span></p>
    <dl class="intake-nutrients">
      <div><dt>能量</dt><dd>{{ display(evidence.nutrients.energyKcal, 'kcal') }}</dd></div>
      <div><dt>蛋白质</dt><dd>{{ display(evidence.nutrients.proteinGrams, 'g') }}</dd></div>
      <div><dt>碳水</dt><dd>{{ display(evidence.nutrients.carbohydrateGrams, 'g') }}</dd></div>
      <div><dt>脂肪</dt><dd>{{ display(evidence.nutrients.fatGrams, 'g') }}</dd></div>
    </dl>
    <details>
      <summary>怎么算的</summary>
      <p class="field-help">营养基准：{{ evidence.basis.amount }} {{ evidence.basis.unit }} · {{ evidence.basis.source }}</p>
      <ol class="intake-equations"><li v-for="(equation, index) in evidence.equations" :key="index"><span>{{ equation.label }}</span><strong>{{ equation.expression }} = {{ display(equation.result, equation.unit) }}</strong></li></ol>
      <p v-if="evidence.input.quantity.note" class="field-help">补充说明：{{ evidence.input.quantity.note }}</p>
      <p v-if="'reference' in evidence.input.quantity" class="field-help">参照依据：{{ evidence.input.quantity.reference }}</p>
      <ul v-if="evidence.warnings.length" class="intake-warnings"><li v-for="warning in evidence.warnings" :key="warning">{{ warning }}</li></ul>
    </details>
  </div>
</template>
<style scoped>
/* Hallmark · component: calculation · genre: modern-minimal · theme: existing-app */
.intake-calculation { display: grid; gap: .75rem; min-width: 0; }
.intake-calculation__total { display: flex; flex-wrap: wrap; gap: .35rem .75rem; align-items: baseline; margin: 0; }
.intake-calculation__total strong { font-size: 1.35rem; }
.intake-calculation__total span { color: var(--color-muted); font-size: .85rem; }
.intake-nutrients { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .5rem; margin: 0; }
.intake-nutrients dt { color: var(--color-muted); font-size: .85rem; }
.intake-nutrients dd { margin: 0; overflow-wrap: anywhere; }
.intake-equations { padding-left: 1.2rem; display: grid; gap: .6rem; }
.intake-equations li { min-width: 0; }
.intake-equations span, .intake-equations strong { display: block; overflow-wrap: anywhere; }
.intake-equations strong { font-size: .9rem; font-weight: 500; }
.intake-warnings { padding-left: 1.2rem; color: var(--color-muted); font-size: .85rem; }
</style>
