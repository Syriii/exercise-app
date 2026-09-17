<script setup lang="ts">
import { ref } from "vue";
import { nutritionApi, type MealImageAnalysis } from "../../api/nutrition";
import { ApiError } from "../../api/client";

const props = defineProps<{ analysis: MealImageAnalysis }>();
const emit = defineEmits<{ deleted: [] }>();
const opened = ref(false);
const saving = ref(false);
const error = ref("");
async function remove() {
  if (!window.confirm("永久删除这张已上传照片？同一照片的所有识别记录都将无法再查看或重新识别原图；识别结果、修改过程和食物记录仍保留。")) return;
  saving.value = true; error.value = "";
  try { await nutritionApi.deleteOriginal(props.analysis.id); opened.value = false; emit("deleted"); }
  catch (cause) { error.value = cause instanceof ApiError ? cause.message : "删除未完成，请重试"; }
  finally { saving.value = false; }
}
</script>

<template>
  <details v-if="analysis.imageAvailable" @toggle="opened = ($event.target as HTMLDetailsElement).open">
    <summary>查看已保存照片</summary>
    <template v-if="opened">
      <img class="retained-photo" :src="`/api/v1/image-analyses/${analysis.id}/original`" alt="本次识别使用的餐食照片" />
      <p class="field-help">照片、识别结果和修改过程会保留，供后续回看和改进。这里保存的是实际上传的版本，可能经过上传前压缩。</p>
      <div class="row-actions">
        <a :href="`/api/v1/image-analyses/${analysis.id}/original`" download="meal-photo">下载照片</a>
        <button class="text-action" type="button" :disabled="saving" @click="remove">{{ saving ? '正在删除…' : '删除这张照片' }}</button>
      </div>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    </template>
  </details>
</template>

<style scoped>
.retained-photo { display: block; max-width: 100%; max-height: 24rem; margin-block: .75rem; object-fit: contain; }
</style>
