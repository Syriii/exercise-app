<script setup lang="ts">
import { onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, useId } from "vue";
import { ApiError } from "../../api/client";
import { foodCatalogApi, type CatalogFood, type FoodCatalogPage } from "../../api/food-catalog";
import { nutritionApi, type Meal } from "../../api/nutrition";
import { submissionId } from "../../support/submission-id";
import type { FoodPickerDraft, FoodReplacementTarget } from "./food-picker-draft";
import FoodArt from "../../components/FoodArt.vue";
import AppIcon from "../../components/AppIcon.vue";
const categoryArt = { grains: "rice", vegetables: "vegetable", fruit: "fruit", meat_eggs: "egg", dairy: "drink", beans: "drink", fats: "rice", other: "rice" };

const props = defineProps<{ meal?: Meal; createMeal?: () => Promise<Meal>; standalone?: boolean; draft: FoodPickerDraft; disabled: boolean; replacement?: FoodReplacementTarget }>();
const emit = defineEmits<{ saved: [meal: Meal]; refreshed: [meal: Meal]; cancel: []; busy: [busy: boolean] }>();
const latestReplacementMeal = ref<Meal | null>(null);
const replacementConflict = ref(false);
const page = ref<FoodCatalogPage | null>(null);
const loading = ref(false), saving = ref(false), error = ref("");
const selectionId = `food-selection-${useId()}`;
function chooseCategory(category: FoodPickerDraft['category']) { props.draft.category = category; void load(false, online); }
let generation = 0;
let lastQuery = "", lastCategory = props.draft.category, online = false;
const amountText = (value: number | null, unit: string) => value === null ? "未知" : `${value} ${unit}`;
async function load(more = false, submitted = false) {
  const current = ++generation;
  loading.value = true; error.value = "";
  if (!more) { lastQuery = props.draft.query; lastCategory = props.draft.category; online = submitted && lastQuery.trim().length >= 2; }
  try {
    const result = await foodCatalogApi.browse(lastQuery, lastCategory, more ? page.value?.nextCursor ?? null : null, online);
    if (current !== generation) return;
    page.value = { ...result, items: more ? [...(page.value?.items ?? []), ...result.items.filter((item) => !page.value?.items.some((old) => old.id === item.id))] : result.items };
  } catch (cause) { if (current === generation) error.value = cause instanceof ApiError ? cause.message : "食物列表暂时打不开，已选内容会保留。"; }
  finally { if (current === generation) loading.value = false; }
}
function toggle() { props.draft.open = !props.draft.open; if (props.draft.open) void load(); }
function select(food: CatalogFood) {
  if (props.draft.selected.some((item) => item.food.id === food.id)) return;
  if (props.draft.selected.length >= 20) { error.value = "每次最多选择20种食物，保存后可以继续添加。"; return; }
  props.draft.mealRevision ??= props.meal?.revision ?? null;
  const selection = { food: { ...food }, amount: food.basisAmount?.toString() ?? "" };
  if (props.replacement) props.draft.selected = [selection];
  else props.draft.selected.push(selection);
}
async function refreshReplacement() {
  if (!props.replacement || !props.meal || saving.value || props.disabled) return;
  saving.value = true; emit("busy", true);
  replacementConflict.value = true; latestReplacementMeal.value = null;
  try {
    const currentMeal = props.meal;
    const meals = await nutritionApi.listMeals(currentMeal.localDate, currentMeal.localDate);
    const meal = meals.find(item => item.id === currentMeal.id);
    if (!meal) throw new Error("meal moved or removed");
    latestReplacementMeal.value = meal; emit("refreshed", meal);
    error.value = meal.contributions.some(item => item.id === props.replacement!.id && item.mode === "item")
      ? "已重新读取餐食，请核对当前食物。选择仍保留，尚未再次替换。" : "原食物已被移除，不能继续替换。请取消后查看这顿饭。";
  } catch { error.value = "餐食暂时读取不了，选择仍保留。若已改期或删除，请回到相应日期查看。"; }
  finally { saving.value = false; emit("busy", false); }
}
function confirmReplacementBase() {
  const meal = latestReplacementMeal.value;
  const item = meal?.contributions.find(value => value.id === props.replacement?.id && value.mode === "item");
  if (!meal || !item || !props.replacement) return;
  Object.assign(props.replacement, { label: item.label, revision: item.revision });
  props.draft.mealRevision = meal.revision; latestReplacementMeal.value = null; replacementConflict.value = false; error.value = "";
}
function scaledEnergy(food: CatalogFood, amount: string): string {
  if (food.energyKcal === null || !food.basisAmount || !Number.isFinite(Number(amount)) || String(amount).trim() === "") return "能量未知";
  return `${Math.round(food.energyKcal * Number(amount) / food.basisAmount * 10) / 10} kcal`;
}
async function favorite(food: CatalogFood) {
  saving.value = true;
  try { await foodCatalogApi.favorite(food.id, !food.isFavorite); await load(false, online); }
  catch (cause) { error.value = cause instanceof ApiError ? cause.message : "常用标记暂时保存不了。"; }
  finally { saving.value = false; }
}
async function save() {
  if (!props.draft.selected.length || saving.value || props.disabled || (props.replacement && replacementConflict.value)) return;
  if (props.draft.selected.some((item) => !String(item.amount).trim() || !Number.isFinite(Number(item.amount)) || Number(item.amount) <= 0 || Number(item.amount) > 100000)) {
    error.value = "请为每项食物填写有效的正数份量。"; return;
  }
  saving.value = true; emit("busy", true); error.value = "";
  try {
    const selections = props.draft.selected.map(({ food, amount }) => ({ foodId: food.id, version: food.version, amount: Number(amount) }));
    const meal = props.meal ?? await props.createMeal?.();
    if (!meal) throw new Error("No meal selected");
    const saved = props.replacement
      ? await foodCatalogApi.replaceSelection(meal.id, props.replacement.id, props.draft.mealRevision!, props.replacement.revision, selections[0]!)
      : await foodCatalogApi.addSelections({ ...meal, revision: props.draft.mealRevision ?? meal.revision }, props.draft.submissionId, selections);
    props.draft.selected = []; props.draft.submissionId = submissionId(); props.draft.mealRevision = null; props.draft.open = false;
    emit("saved", saved);
  } catch (cause) {
    if (props.replacement && cause instanceof ApiError && cause.code === "nutrition_revision_conflict") replacementConflict.value = true;
    error.value = cause instanceof ApiError ? cause.message : props.standalone
      ? "尚未确认保存结果，选择已保留。请查看页面提示；已确认建立的餐食会继续使用，不重复建立。"
      : props.replacement
      ? "尚未确认替换结果，选择已保留。可以重试或重新查看餐食，不会重复添加食物。"
      : "暂时未能确认保存结果。选择和提交编号已保留，重试不会重复添加。";
  }
  finally { saving.value = false; emit("busy", false); }
}
async function createPersonal() {
  if (saving.value || props.disabled) return;
  if (props.draft.selected.length >= 20) { error.value = "每次最多选择20种食物，请先保存已选内容。"; return; }
  props.draft.personalPending ??= { ...props.draft.personal };
  const input = props.draft.personalPending;
  const number = (value: string) => String(value).trim() === "" ? null : Number(value);
  saving.value = true; error.value = "";
  try {
    const food = await foodCatalogApi.createPersonal({ submissionId: props.draft.personalSubmissionId, mode: "item", label: input.label, category: input.category,
      portionAmount: number(input.amount), portionUnit: input.unit, basisDescription: "个人录入",
      energyKcal: number(input.energy), proteinGrams: number(input.protein), carbohydrateGrams: number(input.carbs), fatGrams: number(input.fat) });
    props.draft.personalSubmissionId = submissionId();
    props.draft.personalPending = null;
    select(food); props.draft.personal.label = ""; props.draft.personal.energy = ""; props.draft.personal.protein = ""; props.draft.personal.carbs = ""; props.draft.personal.fat = "";
    await load(false, online);
  } catch (cause) {
    if (cause instanceof ApiError && cause.status >= 400 && cause.status < 500 && cause.status !== 409) props.draft.personalPending = null;
    error.value = cause instanceof ApiError ? cause.message : "尚未确认个人食物的保存结果，内容与保存编号已保留；重试不会重复新建。";
  }
  finally { saving.value = false; }
}
onMounted(() => { if (props.draft.open) void load(); });
onActivated(() => { if (props.draft.open && !loading.value) void load(); });
onDeactivated(() => { generation++; loading.value = false; });
onBeforeUnmount(() => { generation++; });
</script>

<template>
  <section class="food-picker" :aria-label="replacement ? '替换单项食物' : '添加食物'">
    <template v-if="replacement"><strong>替换：{{ replacement.label }}</strong><p class="field-help">只替换这一项，其他食物保留。请按新食物的单位填写份量，不沿用照片估算的营养。</p><button class="text-action" type="button" :disabled="saving || disabled" @click="emit('cancel')">取消替换</button></template>
    <button v-else-if="!standalone" class="action-button" type="button" :aria-expanded="draft.open" :disabled="saving || disabled" @click="toggle">{{ draft.open ? '收起食物选择' : '添加食物' }}<template v-if="draft.selected.length"> · 已选 {{ draft.selected.length }} 项</template></button>
    <div v-if="draft.open" class="food-picker-content">
      <form class="catalog-search catalog-search--compact" @submit.prevent="load(false, true)">
        <label><span class="sr-only">搜索食物</span><input v-model="draft.query" maxlength="100" placeholder="搜索食物，例如鸡蛋、豆浆" :disabled="saving" /></label>
        <button class="action-button" type="submit" :disabled="loading || saving">搜索</button>
      </form>
      <div class="category-chips" role="group" aria-label="食物分类">
        <button class="category-chip" type="button" :aria-pressed="draft.category === 'all'" :disabled="saving" @click="chooseCategory('all')">全部</button>
        <button v-for="(name, key) in page?.categories" :key="key" class="category-chip" type="button" :aria-pressed="draft.category === key" :disabled="saving" @click="chooseCategory(key)">{{ name }}</button>
      </div>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <p v-if="replacement && replacementConflict && !error" class="field-help">餐食已有变化，请重新查看并确认当前食物，所选内容仍保留。</p>
      <button v-if="replacement && (error || replacementConflict)" class="text-action" type="button" :disabled="saving || disabled" @click="refreshReplacement">重新查看餐食</button>
      <div v-if="replacement && latestReplacementMeal" class="field-help">
        <p v-for="item in latestReplacementMeal.contributions.filter(item => item.id === replacement!.id)" :key="item.id">当前：{{ item.label }} · {{ item.portionAmount ?? '份量未知' }} {{ item.portionUnit ?? '' }}</p>
        <button v-if="latestReplacementMeal.contributions.some(item => item.id === replacement!.id && item.mode === 'item')" class="text-action" type="button" :disabled="saving || disabled" @click="confirmReplacementBase">按当前食物重新确认</button>
      </div>
      <p v-if="page?.warning" class="field-help" role="status">{{ page.warning }}</p>
      <p v-if="loading" role="status">正在读取食物…</p>
      <p v-else-if="page && !page.items.length" class="empty-copy">没有匹配的食物。已选内容仍在，也可以补充个人食物。</p>
      <ul v-if="page?.items.length" class="catalog-results" aria-label="食物列表">
        <li v-for="food in page.items" :key="food.id">
          <FoodArt :kind="categoryArt[food.category]" />
          <div><strong>{{ food.label }}</strong><small>{{ food.basisAmount ?? '基准未知' }} {{ food.basisUnit ?? '' }} · {{ amountText(food.energyKcal, 'kcal') }}</small>
            <details><summary>来源与营养</summary><p>{{ food.sourceName }}</p><p v-if="food.originalName">{{ food.originalName }}</p>
              <p>蛋白质 {{ amountText(food.proteinGrams, 'g') }} · 碳水 {{ amountText(food.carbohydrateGrams, 'g') }} · 脂肪 {{ amountText(food.fatGrams, 'g') }}</p>
              <a v-if="food.sourceUrl" :href="food.sourceUrl" target="_blank" rel="noreferrer">来源记录 · {{ food.license }}</a>
            </details>
          </div>
          <div class="catalog-item-actions"><button class="text-action" type="button" :aria-label="`${food.isFavorite ? '取消常用' : '设为常用'}：${food.label}`" :aria-pressed="food.isFavorite" :disabled="saving || disabled" @click="favorite(food)">{{ food.isFavorite ? '★' : '☆' }}</button>
            <button class="action-button" type="button" :aria-label="`选择：${food.label}`" :aria-pressed="draft.selected.some(item => item.food.id === food.id)" :disabled="saving || disabled || draft.selected.some(item => item.food.id === food.id)" @click="select(food)"><AppIcon :name="draft.selected.some(item => item.food.id === food.id) ? 'check' : 'plus'" /></button></div>
        </li>
      </ul>
      <button v-if="page?.nextCursor" class="text-action" type="button" :disabled="loading || saving" @click="load(true)">加载更多食物</button>
      <form v-if="draft.selected.length" :id="selectionId" class="catalog-selection" aria-label="已选食物" @submit.prevent="save">
        <strong>已选 {{ draft.selected.length }} 项</strong>
        <div v-for="(item, index) in draft.selected" :key="item.food.id" class="catalog-selection-row">
          <div class="selection-food-name"><strong>{{ item.food.label }}</strong><small>{{ scaledEnergy(item.food, item.amount) }}</small></div>
          <label class="portion-inline"><span class="sr-only">{{ item.food.label }}份量（{{ item.food.basisUnit ?? '单位未知' }}）</span><input v-model="item.amount" type="number" min="0.001" max="100000" step="0.001" required :disabled="saving" /><span aria-hidden="true">{{ item.food.basisUnit ?? '单位未知' }}</span></label>
          <button class="text-action" type="button" :disabled="saving" :aria-label="`取消选择：${item.food.label}`" @click="draft.selected.splice(index, 1)"><AppIcon name="trash" /></button>
        </div>
        <p v-if="!replacement && meal && draft.mealRevision !== null && draft.mealRevision !== meal.revision" class="field-help">这顿饭有其他更新，所选食物仍保留。<button class="text-action" type="button" @click="draft.mealRevision = meal!.revision">按当前餐食重试</button></p>
      </form>
      <details class="catalog-personal"><summary>找不到？补充个人食物</summary>
        <form @submit.prevent="createPersonal">
          <fieldset :disabled="saving || disabled || draft.personalPending !== null">
            <label>个人食物名称<input v-model="draft.personal.label" required maxlength="100" /></label>
            <div class="catalog-search"><label>基准份量<input v-model="draft.personal.amount" type="number" min="0.001" max="100000" step="0.001" required /></label><label>基准单位<input v-model="draft.personal.unit" required maxlength="30" /></label>
              <label>个人食物分类<select v-model="draft.personal.category"><option v-for="(name, key) in page?.categories" :key="key" :value="key">{{ name }}</option></select></label></div>
            <p class="field-help">基准可填写包装标签上的100 g，或你确定的一份。未知营养留空，不按零计算。</p>
            <details><summary>补充营养（选填）</summary><div class="catalog-search">
              <label>基准能量 kcal<input v-model="draft.personal.energy" type="number" min="0" step="any" /></label><label>基准蛋白质 g<input v-model="draft.personal.protein" type="number" min="0" step="any" /></label>
              <label>基准碳水 g<input v-model="draft.personal.carbs" type="number" min="0" step="any" /></label><label>基准脂肪 g<input v-model="draft.personal.fat" type="number" min="0" step="any" /></label>
            </div></details>
          </fieldset>
          <p v-if="draft.personalPending" class="field-help">上次保存结果尚未确认，请先重试同一份内容；不会重复新建。</p>
          <button class="action-button" type="submit" :disabled="saving || disabled">{{ draft.personalPending ? '重试上次保存' : '保存个人食物并选择' }}</button>
        </form>
      </details>
      <details><summary>食物来源与搜索说明</summary><p class="field-help">常用食物优先显示，插图仅表示类别。不输入可浏览全部已接入食物。搜索至少两个字时也会查询 Open Food Facts，发送搜索词但不发送账号信息。食物包含台湾食药署样品与 USDA 参考，请核对生熟、含糖和加工状态。</p></details>
      <div v-if="draft.selected.length" class="selection-save-bar">
        <a :href="`#${selectionId}`">已选 {{ draft.selected.length }} 项 · 改份量</a>
        <button class="primary-button" type="submit" :form="selectionId" :disabled="saving || disabled || (!!replacement && replacementConflict)">{{ saving ? '保存中…' : replacement ? '替换这一项' : `加入这顿饭（${draft.selected.length}项）` }}</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.food-picker { padding-block: .75rem; }
.food-picker-content { display: grid; gap: .75rem; padding-top: .75rem; }
.catalog-search { display: flex; flex-wrap: wrap; gap: .75rem; align-items: end; }
.catalog-search label { flex: 1 1 9rem; min-width: 0; }
label { display: grid; gap: .3rem; }
input, select { width: 100%; min-width: 0; min-height: 44px; }
.catalog-results { margin: 0; padding: 0; list-style: none; }
.food-picker .catalog-results > li { display: grid; grid-template-columns: 44px minmax(0,1fr) 44px; gap: var(--space-xs); padding-block: var(--space-sm); border-bottom: 1px solid var(--color-rule); }
.food-picker .catalog-results .food-art { width:44px; height:44px; }
.catalog-item-actions { display:grid; align-content:start; }
.catalog-item-actions button { min-width:44px; padding-inline:var(--space-xs); }
.catalog-search--compact { display:grid; grid-template-columns:minmax(0,1fr) auto; }
.catalog-results > li > div:first-child { flex: 1 1 14rem; min-width: 0; }
.catalog-results strong, small { display: block; overflow-wrap: anywhere; }
small, details p, .field-help { font-size: .85rem; line-height: 1.5; }
summary { cursor: pointer; min-height: 44px; display: flex; align-items: center; }
.catalog-selection { display: grid; gap: .75rem; padding-block: .75rem; }
.catalog-selection-row { display:grid; grid-template-columns:minmax(0,1fr) auto 44px; align-items:center; gap:var(--space-xs); }
.catalog-selection-row label { display:flex; gap:var(--space-2xs); align-items:center; min-width:0; }
.catalog-selection-row input { width:4.5rem; padding-inline:var(--space-xs); }
.selection-food-name { min-width:0; }
.catalog-selection { padding-inline:var(--space-xs); scroll-margin-block:var(--space-lg); }
fieldset { border: 0; padding: 0; margin: 0; display: grid; gap: .75rem; min-width: 0; }
</style>
