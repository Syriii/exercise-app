<script setup lang="ts">
import { nextTick, ref } from "vue";
import type { Meal, MealContribution } from "../../api/nutrition";
import AppIcon from "../../components/AppIcon.vue";
import type { PortionDraft } from "./portion-draft";

const props = defineProps<{ meal: Meal; item: MealContribution; disabled: boolean; draft?: PortionDraft; saving?: boolean }>();
const emit = defineEmits<{ edit: []; replace: []; remove: []; favorite: []; startPortion: []; savePortion: []; cancelPortion: [] }>();
const amountInput = ref<HTMLInputElement | null>(null);
const nutrient = (value: number | null, unit: string) => value === null ? "未知" : `${Math.round(value * (unit === 'kcal' ? 1 : 10)) / (unit === 'kcal' ? 1 : 10)} ${unit}`;
async function startPortion() {
  if (props.saving || props.disabled) return;
  if (!props.draft) {
    emit("startPortion");
  }
  await nextTick();
  amountInput.value?.focus();
}
function savePortion() {
  const current = props.draft;
  if (!current || props.saving || props.disabled || String(current.amount).trim() === "") return;
  emit("savePortion");
}
</script>

<template>
  <li :id="`meal-food-${item.id}`" class="food-item">
    <div class="food-item-summary">
      <strong><button type="button" class="food-name-action" :aria-label="`编辑食物：${item.label}`" :disabled="disabled || saving" @click="emit('edit')"><AppIcon name="food" />{{ item.label }}<AppIcon name="edit" /></button></strong>
      <span>{{ item.portionAmount ?? '份量未知' }} {{ item.portionUnit ?? '' }}<template v-if="item.source === 'model_adopted' || item.basisDescription?.startsWith('照片估算')"> · 照片估算</template></span>
      <small>{{ nutrient(item.energyKcal, 'kcal') }} · 蛋白质 {{ nutrient(item.proteinGrams, 'g') }} · 碳水 {{ nutrient(item.carbohydrateGrams, 'g') }} · 脂肪 {{ nutrient(item.fatGrams, 'g') }}</small>
    </div>
    <div class="row-actions food-item-actions">
      <slot name="actions" />
      <button v-if="item.mode === 'item' && item.portionAmount !== null && item.portionUnit" class="text-action" type="button" :disabled="disabled || saving" @click="startPortion">改份量</button>
      <button v-if="item.mode === 'item'" class="text-action" type="button" :disabled="disabled || saving" @click="emit('replace')">换食物</button>
      <details class="food-more"><summary>更多</summary><div class="row-actions">
        <button class="text-action" type="button" :disabled="disabled || saving" @click="emit('edit')">修正</button>
        <button v-if="item.mode === 'item'" class="text-action" type="button" :disabled="disabled || saving" @click="emit('favorite')">设为常用</button>
        <button class="text-action danger-text" type="button" :disabled="disabled || saving" @click="emit('remove')"><AppIcon name="trash" />移除</button>
      </div></details>
    </div>
    <form v-if="draft" class="portion-editor" @submit.prevent="savePortion">
      <label class="portion-inline"><span class="sr-only">{{ item.label }}份量（{{ draft.item.portionUnit }}）</span><input ref="amountInput" v-model="draft.amount" type="number" min="0" max="100000" step="any" required :disabled="saving || disabled" /><span aria-hidden="true">{{ draft.item.portionUnit }}</span></label>
      <button class="action-button" type="submit" :disabled="saving || disabled">{{ saving ? '保存中…' : '保存份量' }}</button>
      <button class="text-action" type="button" :disabled="saving" @click="emit('cancelPortion')">取消</button>
      <p v-if="draft.error" role="alert">{{ draft.error }}<template v-if="meal.revision !== draft.meal.revision"> 这顿饭已有其他修改，请取消后重新打开份量编辑。</template></p>
    </form>
    <slot />
  </li>
</template>

<style scoped>
.food-item { display: grid; gap: var(--space-xs); padding: var(--space-sm) 0; border: 0; border-bottom: var(--rule-thin) solid var(--color-rule); background: transparent; border-radius: 0; }
.food-name-action { display: inline-flex; gap: var(--space-xs); align-items: center; padding: 0; min-height: 44px; max-width: 100%; text-align: left; color: var(--color-ink); background: transparent; border: 0; }
.food-name-action .icon:last-child { width: 16px; height: 16px; flex-basis: 16px; color: var(--color-muted); }
.food-item-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-start; }
.food-item-summary > span, .food-item-summary > small { display: block; }
.food-item-summary > small { color: var(--color-muted); line-height: 1.6; }
.food-more { align-self: center; }
.food-more > summary { min-height: 44px; }
.portion-editor { flex: 1 0 100%; padding-block: .5rem; }
.portion-editor label { display: grid; gap: .35rem; max-width: 20rem; }
.portion-editor p { font-size: .85rem; margin-block: .5rem; }
</style>
