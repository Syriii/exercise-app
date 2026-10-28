<script setup lang="ts">
import { computed, ref } from "vue";
import type { Meal, MealImageAnalysis } from "../../api/nutrition";
import MealPhotoPicker from "./MealPhotoPicker.vue";
import { prepareMealImage } from "./image-compression";
import { analyzePhotoEvidence, clearPhotoEvidenceDraft, photoRoleLabels, uploadPhotoEvidence, type PhotoEvidenceDraft } from "./photo-evidence-api";

const props = defineProps<{ meal: Meal; analyses: readonly MealImageAnalysis[]; draft: PhotoEvidenceDraft; disabled?: boolean }>();
const emit = defineEmits<{ saved: [] }>();
const busy = computed({ get: () => props.draft.busy, set: (value: boolean) => { props.draft.busy = value; } });
const progress = ref(0), error = ref(""), message = ref("");
const locked = computed(() => Boolean(props.disabled || busy.value));
const available = computed(() => {
  const selected = new Set([props.draft.primaryId, ...props.draft.referenceIds]);
  const seen = new Set<string>();
  return [...props.analyses].filter(value => value.imageAvailable)
    .sort((a, b) => Number(selected.has(b.id)) - Number(selected.has(a.id)))
    .filter(value => { const key = value.photoId ?? value.id; if (seen.has(key)) return false; seen.add(key); return true; });
});
const primary = computed(() => available.value.find(value => value.id === props.draft.primaryId));
const references = computed(() => available.value.filter(value => value.id !== props.draft.primaryId));
const runnable = computed(() => primary.value && ["waiting", "failed", "cancelled", "succeeded"].includes(primary.value.status));
function selected(event: Event) { const file = (event.target as HTMLInputElement).files?.[0]; if (file) { props.draft.file = file; error.value = ""; } }
async function upload() {
  if (locked.value || !props.draft.file) return;
  busy.value = true; error.value = ""; message.value = ""; progress.value = 0;
  try {
    const prepared = await prepareMealImage(props.draft.file);
    await uploadPhotoEvidence(props.meal.id, prepared.file, props.draft.role, props.draft.note, value => { progress.value = value; });
    clearPhotoEvidenceDraft(props.draft); message.value = "依据照片已保存，尚未调用模型，也未增加吃入记录。"; emit("saved");
  } catch (value) { error.value = value instanceof Error ? value.message : "照片未能保存，请重试"; }
  finally { busy.value = false; }
}
async function analyze() {
  if (locked.value || !runnable.value || !primary.value || !props.draft.consent) return;
  busy.value = true; error.value = ""; message.value = "";
  try {
    await analyzePhotoEvidence(primary.value, props.draft);
    clearPhotoEvidenceDraft(props.draft); message.value = "已提交这一组照片，请在识别结果中核对后采用。"; emit("saved");
  } catch (value) { error.value = value instanceof Error ? value.message : "分析未能提交，请重试"; }
  finally { busy.value = false; }
}
</script>

<template>
  <details class="photo-evidence">
    <summary>补充餐前后、标签或细节照片</summary>
    <div class="photo-evidence-body">
      <p class="field-help">先把同一餐的依据存下来。实测净重、容器皮重、餐前后差值或明确尺寸可以写在说明里。</p>
      <label>照片用途<select v-model="draft.role" :disabled="locked"><option value="before">餐前</option><option value="after">餐后剩余</option><option value="label">包装标签</option><option value="detail">食物细节</option></select></label>
      <label>这一餐的说明<textarea v-model="draft.note" maxlength="500" rows="3" :disabled="locked" placeholder="例如：同一餐盒，餐前含盒重 520g，餐后 180g；骨头留在盒中。" /></label>
      <MealPhotoPicker purpose="evidence" :file="draft.file" :disabled="locked" @change="selected" />
      <button class="action-button" type="button" :disabled="locked || !draft.file" @click="upload">{{ busy && draft.file ? `保存照片 ${progress}%` : "保存依据照片" }}</button>
      <p class="field-help">保存照片不调用模型。照片会保留到你主动删除。</p>
      <fieldset v-if="available.length" :disabled="locked">
        <legend>结合这一餐的照片分析</legend>
        <label>主图<select v-model="draft.primaryId" @change="draft.referenceIds = draft.referenceIds.filter(id => id !== draft.primaryId); draft.consent = false"><option value="">选择一张主图</option><option v-for="(photo, index) in available" :key="photo.id" :value="photo.id">{{ photoRoleLabels[photo.inputContext?.role ?? 'meal'] }} · 照片 {{ index + 1 }}{{ ['pending','running'].includes(photo.status) ? '（处理中）' : '' }}</option></select></label>
        <div v-if="primary" class="reference-choices">
          <p class="field-help">参考图最多选 8 张，仅限这一餐。重复拍摄不会作为多吃一份。</p>
          <label v-for="(photo, index) in references" :key="photo.id" class="photo-check"><input v-model="draft.referenceIds" type="checkbox" :value="photo.id" :disabled="!draft.referenceIds.includes(photo.id) && draft.referenceIds.length >= 8" @change="draft.consent = false" />{{ photoRoleLabels[photo.inputContext?.role ?? 'meal'] }} · 参考图 {{ index + 1 }}</label>
        </div>
        <p v-if="primary?.inputContext?.note" class="field-help">原说明：{{ primary.inputContext.note }}。本次只发送上方当前填写的说明。</p>
        <label class="photo-check"><input v-model="draft.consent" type="checkbox" />确认把主图、所选参考图和当前说明发给识别服务；可能产生费用。再次提交可能再次计费。</label>
        <button class="action-button" type="button" :disabled="locked || !runnable || !draft.consent || Boolean(draft.file)" @click="analyze">结合所选依据分析</button>
        <p class="field-help">新结果需核对后采用；已有人工修正不会自动覆盖。未保存的照片请先保存。</p>
      </fieldset>
      <p v-if="error" class="error-message" role="alert">{{ error }}</p>
      <p v-if="message" role="status">{{ message }}</p>
      <button type="button" class="text-button" :disabled="locked" @click="clearPhotoEvidenceDraft(draft); error = ''; message = ''">放弃这份依据草稿</button>
    </div>
  </details>
</template>

<style scoped>
.photo-evidence { border-top: var(--rule-thin) solid var(--color-rule); padding-top: 12px; min-width: 0; }
summary { cursor: pointer; font-weight: 600; min-height: 44px; align-content: center; }
.photo-evidence-body, fieldset, label, .reference-choices { display: grid; gap: 10px; min-width: 0; }
.photo-evidence-body { padding-top: 8px; }
fieldset { border: var(--rule-thin) solid var(--color-rule); border-radius: var(--radius-sm); padding: 12px; }
legend { padding-inline: 4px; }
select, textarea { width: 100%; min-width: 0; max-width: 100%; box-sizing: border-box; font: inherit; padding: 10px; border: var(--rule-thin) solid var(--color-rule); border-radius: var(--radius-sm); background: var(--color-paper); color: var(--color-ink); }
.photo-check { display: flex; align-items: flex-start; gap: 8px; line-height: 1.5; }
.photo-check input { flex: 0 0 auto; margin-top: 5px; width: 18px; height: 18px; }
</style>
