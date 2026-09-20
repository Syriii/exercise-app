<script setup lang="ts">
import { computed, ref } from "vue";
import AppIcon from "../../components/AppIcon.vue";
import type { Measurement } from "./record-draft";
const props = withDefaults(defineProps<{ recent?: string[]; disabled?: boolean }>(), { recent: () => [], disabled: false });
const emit = defineEmits<{ select: [name: string, measurement: Measurement] }>();
// Names are selection shortcuts, not an exercise prescription or assumed completed amount.
const basics = [
  { name: '深蹲', type: 'sets' }, { name: '俯卧撑', type: 'sets' }, { name: '卧推', type: 'sets' },
  { name: '划船', type: 'sets' }, { name: '硬拉', type: 'sets' }, { name: '推举', type: 'sets' },
  { name: '跑步', type: 'activity' }, { name: '步行', type: 'activity' }, { name: '骑行', type: 'activity' },
  { name: '游泳', type: 'activity' }, { name: '平板支撑', type: 'activity' }, { name: '拉伸', type: 'unknown' },
] as const;
const query = ref('');
const choices = computed(() => [...new Set([...props.recent, ...basics.map(item => item.name)])]
  .filter(name => name.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())).slice(0, 24));
function choose(name: string) {
  if (props.disabled || !name.trim()) return;
  emit('select', name.trim(), basics.find(item => item.name === name)?.type ?? 'sets');
  query.value = '';
}
</script>
<template>
  <section class="exercise-picker" aria-label="选择动作">
    <label><span class="sr-only">搜索或输入动作</span><input v-model="query" maxlength="100" placeholder="搜索或输入动作" :disabled="disabled" @keydown.enter.prevent="choose(query)" /></label>
    <div class="exercise-choices">
      <button v-for="name in choices" :key="name" class="action-button" type="button" :disabled="disabled" :aria-label="`添加动作：${name}`" @click="choose(name)"><AppIcon name="plus" />{{ name }}</button>
      <button v-if="query.trim() && !choices.includes(query.trim())" class="action-button" type="button" :disabled="disabled" @click="choose(query)">添加自定义动作</button>
    </div>
  </section>
</template>
<style scoped>
.exercise-picker { display: grid; gap: var(--space-sm); min-width: 0; }
.exercise-picker input { width: 100%; min-width: 0; }
.exercise-choices { display: flex; flex-wrap: wrap; gap: var(--space-xs); }
.exercise-choices button { max-width: 100%; overflow-wrap: anywhere; }
</style>
