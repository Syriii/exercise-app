<script setup lang="ts">
import { onMounted, ref } from "vue";
import { nutritionApi, type PhotoAnalysisSettings } from "../../api/nutrition";
import { ApiError } from "../../api/client";
const emit = defineEmits<{ changed: [automatic: boolean] }>();
const settings = ref<PhotoAnalysisSettings | null>(null);
const automatic = ref(false);
const consent = ref(false);
const saving = ref(false);
const error = ref("");
const notice = ref("");
async function load() {
  try { settings.value = await nutritionApi.photoSettings(); automatic.value = settings.value.automatic; consent.value = settings.value.consentAt !== null; emit("changed", settings.value.automatic); error.value = ""; }
  catch { error.value = "识别设置暂时读取不了，请重新读取后上传照片；手工记录不受影响。"; }
}
onMounted(load);
async function save() {
  if (!settings.value || saving.value) return;
  saving.value = true; error.value = ""; notice.value = "";
  try { settings.value = await nutritionApi.savePhotoSettings({ revision: settings.value.revision, automatic: automatic.value, consent: consent.value }); emit("changed", settings.value.automatic); notice.value = "已保存，仅影响后续上传的照片。"; }
  catch (cause) { error.value = cause instanceof ApiError ? cause.message : "设置未保存，请重试。"; }
  finally { saving.value = false; }
}
</script>

<template>
  <details class="reference-details photo-settings">
    <summary>拍照识别设置</summary>
    <p class="field-help">识别时会把所选餐食照片发送给服务器配置的模型服务，用于估算食物和营养；不会发送其他餐食或账号资料。照片仅临时保留，食物记录长期保存。</p>
    <p class="field-help">关闭自动识别后，后续照片只保存到餐食，你可以逐张发起识别。开关不会处理历史照片，也不会取消已经发起的任务。</p>
    <p v-if="error" class="form-error" role="alert">{{ error }} <button type="button" class="text-action" @click="load">重新读取设置</button></p>
    <form v-if="settings" @submit.prevent="save">
      <fieldset :disabled="saving">
        <label class="checkbox-row"><input v-model="automatic" type="checkbox" />拍照后自动识别</label>
        <label v-if="!settings.consentAt" class="checkbox-row"><input v-model="consent" type="checkbox" :required="automatic" />我了解并同意上述照片发送范围</label>
        <button class="action-button" type="submit">{{ saving ? '正在保存…' : '保存识别设置' }}</button>
      </fieldset>
    </form>
    <p v-if="notice" class="form-notice" role="status">{{ notice }}</p>
  </details>
</template>

<style scoped>
fieldset { border: 0; padding: 0; margin: 0; display: grid; gap: .75rem; min-width: 0; }
</style>
