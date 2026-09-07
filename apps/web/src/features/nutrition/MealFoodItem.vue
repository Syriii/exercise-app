<script setup lang="ts">
import { ref } from "vue";
import { ApiError } from "../../api/client";
import { nutritionApi, type Meal, type MealContribution } from "../../api/nutrition";

const props = defineProps<{ meal: Meal; item: MealContribution; disabled: boolean }>();
const emit = defineEmits<{ saved: [meal: Meal]; edit: []; remove: []; favorite: [] }>();
const draft = ref<{ meal: Meal; item: MealContribution; amount: string } | null>(null);
const saving = ref(false);
const error = ref("");
const nutrient = (value: number | null, unit: string) => value === null ? "未知" : `${value} ${unit}`;
function startPortion() {
  draft.value = { meal: props.meal, item: props.item, amount: props.item.portionAmount?.toString() ?? "" };
  error.value = "";
}
async function savePortion() {
  const current = draft.value;
  if (current === null || String(current.amount).trim() === "") return;
  saving.value = true;
  error.value = "";
  try {
    const saved = await nutritionApi.changePortion(current.meal, current.item, Number(current.amount));
    draft.value = null;
    emit("saved", saved);
  } catch (cause) {
    error.value = cause instanceof ApiError ? cause.message : "份量暂时保存不了，输入已保留。";
  } finally { saving.value = false; }
}
</script>

<template>
  <li class="food-item">
    <div>
      <strong>{{ item.label }}</strong>
      <span>{{ item.portionAmount ?? '份量未知' }} {{ item.portionUnit ?? '' }}<template v-if="item.source === 'model_adopted' || item.basisDescription?.startsWith('照片估算')"> · 照片估算</template></span>
      <small>{{ nutrient(item.energyKcal, 'kcal') }} · 蛋白质 {{ nutrient(item.proteinGrams, 'g') }} · 碳水 {{ nutrient(item.carbohydrateGrams, 'g') }} · 脂肪 {{ nutrient(item.fatGrams, 'g') }}</small>
    </div>
    <span class="row-actions">
      <button v-if="item.mode === 'item' && item.portionAmount !== null && item.portionUnit" class="text-action" type="button" :disabled="disabled || saving" @click="startPortion">改份量</button>
      <button class="text-action" type="button" :disabled="disabled || saving" @click="emit('edit')">修正</button>
      <button v-if="item.mode === 'item'" class="text-action" type="button" :disabled="disabled || saving" @click="emit('favorite')">设为常用</button>
      <button class="text-action danger-text" type="button" :disabled="disabled || saving" @click="emit('remove')">移除</button>
    </span>
    <form v-if="draft" class="portion-editor" @submit.prevent="savePortion">
      <label>{{ item.label }}份量（{{ draft.item.portionUnit }}）<input v-model="draft.amount" type="number" min="0" max="100000" step="any" required :disabled="saving" /></label>
      <p>营养将按份量同比调整，未知的营养仍保持未知。</p>
      <button class="action-button" type="submit" :disabled="saving || disabled">{{ saving ? '保存中…' : '保存份量' }}</button>
      <button class="text-action" type="button" :disabled="saving" @click="draft = null">取消</button>
      <p v-if="error" role="alert">{{ error }}<template v-if="meal.revision !== draft.meal.revision"> 这顿饭已有其他修改，请取消后重新打开份量编辑。</template></p>
    </form>
  </li>
</template>

<style scoped>
.food-item { flex-wrap: wrap; }
.portion-editor { flex: 1 0 100%; padding-block: .5rem; }
.portion-editor label { display: grid; gap: .35rem; max-width: 20rem; }
.portion-editor p { font-size: .85rem; margin-block: .5rem; }
</style>
