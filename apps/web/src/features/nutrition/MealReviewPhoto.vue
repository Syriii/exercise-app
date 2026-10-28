<script setup lang="ts">
import { ref, watch } from "vue";
import type { MealImageAnalysis } from "../../api/nutrition";
const props = defineProps<{ analysis: MealImageAnalysis }>();
const failed = ref(false);
watch(() => props.analysis.id, () => { failed.value = false; });
</script>
<template>
  <figure v-if="analysis.imageAvailable" class="meal-review-photo">
    <img v-if="!failed" :src="`/api/v1/image-analyses/${analysis.id}/original`" alt="当前餐食的已保存照片" @error="failed = true" />
    <figcaption v-if="failed">
      <p class="field-help" role="status">照片暂时未能载入，食物记录仍可查看和修改。</p>
      <button class="text-action" type="button" @click="failed = false">重新加载照片</button>
    </figcaption>
  </figure>
</template>
<style scoped>
.meal-review-photo { margin: 0; min-width: 0; }
.meal-review-photo img { display: block; width: 100%; max-height: 15rem; object-fit: contain; border-radius: var(--radius-md); background: var(--color-paper-2); }
.meal-review-photo figcaption { display: grid; justify-items: start; gap: .25rem; }
.meal-review-photo figcaption p { margin: 0; }
</style>
