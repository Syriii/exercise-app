<script setup lang="ts">
import { computed } from "vue";
const props = defineProps<{ measurements: Array<{ id: string; localDate: string; weightKg: number }> }>();
const rows = computed(() => [...props.measurements].sort((a, b) => a.localDate.localeCompare(b.localDate)));
const extent = computed(() => {
  const values = rows.value.map(row => row.weightKg);
  return { min: Math.min(...values) - 1, max: Math.max(...values) + 1 };
});
const points = computed(() => {
  const first = Date.parse(rows.value[0]?.localDate ?? ""), last = Date.parse(rows.value.at(-1)?.localDate ?? "");
  return rows.value.map(row => ({ ...row,
    x: last === first ? 170 : 42 + (Date.parse(row.localDate) - first) / (last - first) * 276,
    y: 130 - (row.weightKg - extent.value.min) / (extent.value.max - extent.value.min) * 108,
  }));
});
</script>
<template>
  <figure v-if="rows.length" class="body-trend-chart">
    <figcaption>体重 · kg</figcaption>
    <svg viewBox="0 0 340 160" role="img" :aria-label="`${rows[0]?.localDate}至${rows.at(-1)?.localDate}，${rows.length}次实际体重测量，明细见下方`">
      <path d="M42 22H318M42 76H318M42 130H318" class="chart-grid" />
      <text x="0" y="26">{{ extent.max.toFixed(1) }}</text><text x="0" y="134">{{ extent.min.toFixed(1) }}</text>
      <polyline v-if="points.length > 1" :points="points.map(p => `${p.x},${p.y}`).join(' ')" class="chart-line" />
      <circle v-for="p in points" :key="p.id" :cx="p.x" :cy="p.y" r="4"><title>{{ p.localDate }}：{{ p.weightKg }} kg</title></circle>
      <text x="42" y="155">{{ rows[0]?.localDate }}</text><text v-if="rows.at(-1)?.localDate !== rows[0]?.localDate" x="318" y="155" text-anchor="end">{{ rows.at(-1)?.localDate }}</text>
    </svg>
    <p class="field-help">圆点是实际测量，连线只帮助观察变化，不补算中间日期。</p>
  </figure>
</template>
<style scoped>
figure { margin: 0; padding: 16px 0; }
figcaption { font-size: 14px; color: var(--color-muted); margin-bottom: 12px; }
svg { width: 100%; max-height: 240px; overflow: visible; }
text { font-size: 11px; fill: var(--color-muted); }
circle { fill: var(--color-accent); }
.chart-grid { stroke: var(--color-rule); fill: none; }
.chart-line { fill: none; stroke: var(--color-accent); stroke-width: 2; }
</style>
