<script setup lang="ts">
import { ref } from 'vue';
import AppIcon from '../../components/AppIcon.vue';
import ExerciseNameField from '../../components/ExerciseNameField.vue';
import PlanTargetFields from './PlanTargetFields.vue';
const props = defineProps<{ item: {
  exerciseName: string; note: string; targetSets: string | number; targetRepsMin: string | number;
  targetRepsMax: string | number; targetWeightKg: string; targetDurationSeconds: string | number; targetDistanceMeters: string;
}; index: number; count: number }>();
defineEmits<{ remove: []; move: [offset: number] }>();
const editingName = ref(!props.item.exerciseName);
</script>
<template>
  <article class="plan-action-editor">
    <div class="compact-action-heading">
      <span class="section-symbol"><AppIcon name="train" /></span>
      <strong v-if="item.exerciseName && !editingName">{{ item.exerciseName }}</strong>
      <ExerciseNameField v-else v-model="item.exerciseName" label="动作名称" required />
      <button type="button" class="text-action icon-action" aria-label="移除动作" @click="$emit('remove')"><AppIcon name="close" /></button>
    </div>
    <PlanTargetFields :item="item" />
    <details class="action-options"><summary><AppIcon name="more" />动作选项<span v-if="item.note"> · 有备注</span></summary>
      <button type="button" class="text-action" @click="editingName = !editingName">修改动作名称</button>
      <div class="form-actions"><button type="button" class="text-action" :disabled="index === 0" @click="$emit('move', -1)">上移</button><button type="button" class="text-action" :disabled="index === count - 1" @click="$emit('move', 1)">下移</button></div>
      <label>动作备注<input v-model="item.note" maxlength="500" /></label>
    </details>
  </article>
</template>
