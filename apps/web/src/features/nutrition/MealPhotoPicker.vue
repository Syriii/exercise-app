<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import AppIcon from "../../components/AppIcon.vue";

// Web adapter: Android can replace this boundary with native camera/photo picker.
// Keep selection user-initiated and never request broad album permissions.
const props = defineProps<{ file?: File; disabled?: boolean }>();
const emit = defineEmits<{ change: [event: Event] }>();
const camera = ref<HTMLInputElement | null>(null), gallery = ref<HTMLInputElement | null>(null);
const preview = ref("");
watch(() => props.file, file => {
  if (preview.value) URL.revokeObjectURL(preview.value);
  preview.value = file ? URL.createObjectURL(file) : "";
}, { immediate: true });
onBeforeUnmount(() => { if (preview.value) URL.revokeObjectURL(preview.value); });
function selected(event: Event) {
  const input = event.target as HTMLInputElement;
  if (!input.files?.length) return; // Cancelling a picker preserves the previous draft.
  emit("change", event);
  input.value = ""; // Allows selecting the same photo again after removal/failure.
}
</script>
<template>
  <div class="meal-photo-picker">
    <img v-if="preview" :src="preview" alt="待上传的餐食照片" class="photo-selection-preview" />
    <p v-if="file" class="field-help">{{ file.name }}</p>
    <div class="photo-source-actions">
      <button type="button" class="action-button" :disabled="disabled" @click="camera?.click()"><AppIcon name="camera" />拍摄照片</button>
      <button type="button" class="action-button" :disabled="disabled" @click="gallery?.click()"><AppIcon name="image" />从相册选择</button>
    </div>
    <input ref="camera" class="photo-source-input" type="file" aria-label="拍摄餐食照片" accept="image/jpeg,image/png,image/gif,image/webp" capture="environment" :disabled="disabled" @change="selected" />
    <input ref="gallery" class="photo-source-input" type="file" aria-label="从相册选择餐食照片" accept="image/jpeg,image/png,image/gif,image/webp" :disabled="disabled" @change="selected" />
    <p class="field-help">支持 JPG、PNG、GIF、WebP。其他格式请先转换；照片会保留到你主动删除。</p>
  </div>
</template>
<style scoped>
.meal-photo-picker { display: grid; gap: 12px; min-width: 0; width: 100%; }
.photo-source-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.photo-selection-preview { width: 100%; max-height: 240px; object-fit: contain; border-radius: 16px; background: var(--color-paper-2); }
.photo-source-input { display: none; }
</style>
