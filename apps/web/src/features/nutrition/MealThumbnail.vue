<script setup lang="ts">
import { ref, watch } from "vue";
import FoodArt from "../../components/FoodArt.vue";
const props = defineProps<{ analysisId?: string }>();
const failed = ref(false);
watch(() => props.analysisId, () => { failed.value = false; });
</script>
<template>
  <img v-if="analysisId && !failed" :src="`/api/v1/image-analyses/${analysisId}/original`" alt="这顿餐食的已上传照片" class="meal-thumbnail" loading="lazy" @error="failed = true" />
  <FoodArt v-else kind="rice" />
</template>
