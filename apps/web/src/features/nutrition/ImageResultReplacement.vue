<script setup lang="ts">
import { ref } from "vue";
import { ApiError } from "../../api/client";
import { nutritionApi, type ImageReplacementInput, type Meal, type MealImageAnalysis } from "../../api/nutrition";
const props = defineProps<{ meal: Meal; analysis: MealImageAnalysis; disabled?: boolean }>();
const emit = defineEmits<{ saved: [meal: Meal, analysis: MealImageAnalysis]; refreshed: [meal: Meal, analysis: MealImageAnalysis]; busy: [value: boolean] }>();
const draft = ref<{ meal: Meal; analysis: MealImageAnalysis; input: ImageReplacementInput } | null>(null);
const saving = ref(false);
const error = ref("");
async function preview(refresh = false) {
  if (saving.value || props.disabled) return;
  error.value = "";
  let meal = props.meal, analysis = props.analysis;
  if (refresh) {
    saving.value = true; emit("busy", true);
    try {
      const [meals, analyses] = await Promise.all([nutritionApi.listMeals(meal.localDate, meal.localDate), nutritionApi.listImageAnalyses(meal.id)]);
      const currentMeal = meals.find(item => item.id === meal.id), currentAnalysis = analyses.find(item => item.id === analysis.id);
      if (!currentMeal || !currentAnalysis) throw new Error("record moved or removed");
      meal = currentMeal; analysis = currentAnalysis; emit("refreshed", meal, analysis);
    } catch { error.value = "未能重新读取这餐与结果，原选择仍保留。如果这餐已改期或删除，请回到对应日期查看。"; return; }
    finally { saving.value = false; emit("busy", false); }
  }
  if (analysis.replacement && !analysis.replacement.undone) { draft.value = null; error.value = "这份结果已经保存，请查看当前食物；需要时可撤销这次替换。"; return; }
  draft.value = { meal: JSON.parse(JSON.stringify(meal)) as Meal, analysis: JSON.parse(JSON.stringify(analysis)) as MealImageAnalysis, input: { operationId: crypto.randomUUID(), mealRevision: meal.revision, analysisRevision: analysis.revision, replaceIds: meal.contributions.map(item => item.id) } };
}
async function save(undo = false) {
  if (saving.value || props.disabled) return;
  const state = props.analysis.replacement;
  const input = undo && state ? { operationId: state.operationId, mealRevision: props.meal.revision, analysisRevision: props.analysis.revision, replaceIds: [] } : draft.value?.input;
  if (!input) return;
  if (undo && !window.confirm("撤销这次结果替换，恢复替换前的食物和份量？")) return;
  saving.value = true; emit("busy", true); error.value = "";
  try { const result = await nutritionApi.replaceImageFoods(props.analysis.id, input, undo); draft.value = null; emit("saved", result.meal, result.analysis); }
  catch (cause) { error.value = cause instanceof ApiError ? cause.message : "尚未确认保存成功，选择已保留；可以重试，不会重复计入。"; }
  finally { saving.value = false; emit("busy", false); }
}
</script>

<template>
  <section class="image-replacement" aria-label="使用照片结果">
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <template v-if="analysis.replacement">
      <p v-if="analysis.replacement.undone" class="field-help">已撤销这次替换，原有食物已恢复。</p>
      <template v-else>
        <button class="text-action" type="button" :disabled="saving || disabled || meal.revision !== analysis.replacement.mealRevision" @click="save(true)">撤销这次结果替换</button>
        <p v-if="meal.revision !== analysis.replacement.mealRevision" class="field-help">替换后这餐又有修改，为保护后续记录，不能直接撤销；你仍可逐项编辑食物。</p>
      </template>
    </template>
    <button v-if="(!analysis.replacement || analysis.replacement.undone) && !draft" class="action-button" type="button" :disabled="disabled" @click="preview()">预览并使用这份结果</button>
    <form v-if="draft" aria-label="照片结果替换预览" @submit.prevent="save()">
      <fieldset :disabled="saving || disabled">
        <h4>将加入的照片食物</h4>
        <ul class="observed-foods"><li v-for="(food, index) in draft.analysis.candidate?.foods ?? []" :key="index"><strong>{{ food.label }}</strong><span>{{ food.portionAmount ?? '份量未知' }} {{ food.portionUnit ?? '' }} · {{ food.energyKcal ?? '未知' }} kcal · 蛋白质 {{ food.proteinGrams ?? '未知' }} g · 碳水 {{ food.carbohydrateGrams ?? '未知' }} g · 脂肪 {{ food.fatGrams ?? '未知' }} g</span></li></ul>
        <h4>照片覆盖了哪些已有食物？</h4>
        <p class="field-help">勾选项将被替换，未勾选项原样保留。默认替换全部，请取消照片没有覆盖的食物，避免重复计算。</p>
        <label v-for="item in draft.meal.contributions" :key="item.id" class="checkbox-row"><input v-model="draft.input.replaceIds" type="checkbox" :value="item.id" />{{ item.label }} · {{ item.portionAmount ?? '份量未知' }} {{ item.portionUnit ?? '' }}</label>
        <p class="field-help">替换 {{ draft.input.replaceIds.length }} 项，保留 {{ draft.meal.contributions.length - draft.input.replaceIds.length }} 项。保存成功前原记录仍有效。</p>
        <p v-if="meal.revision !== draft.input.mealRevision || analysis.revision !== draft.input.analysisRevision" class="form-error">这餐或识别结果已变化。原预览保留，请重新查看后再保存。</p>
        <div class="row-actions"><button type="submit" class="primary-button">{{ saving ? '正在保存…' : '使用照片食物并保存' }}</button><button type="button" class="text-action" @click="preview(true)">重新查看当前内容</button><button type="button" class="text-action" @click="draft = null">取消</button></div>
      </fieldset>
    </form>
  </section>
</template>

<style scoped>
fieldset { border: 0; padding: 0; margin: 0; display: grid; gap: .75rem; min-width: 0; }
.image-replacement { display: grid; gap: .5rem; }
</style>
