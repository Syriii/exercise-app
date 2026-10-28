<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { ApiError } from "../../api/client";
import { loadMealSuggestions, type MealSuggestion, type MealSuggestionDraft, type MealSuggestionsResult, type MealSuggestionStyle } from "./meal-suggestions";

const props = defineProps<{ date: string; disabled?: boolean }>();
const emit = defineEmits<{ use: [draft: MealSuggestionDraft]; close: [] }>();
const style = ref<MealSuggestionStyle>("all");
const availableFoods = ref("");
const result = ref<MealSuggestionsResult | null>(null);
const loading = ref(false), error = ref("");
const shown = ref(3);
let generation = 0;
const formatEnergy = (value: number | null) => value === null ? "能量待补充" : `约 ${Math.round(value)} kcal`;
const formatGrams = (value: number | null) => value === null ? "待补充" : `${Number(value.toFixed(1))} g`;
const amountText = (amount: number, unit: string | null) => `${Number(amount.toFixed(3))} ${unit ?? "单位待补充"}`;
function sourceLink(value: string | null) {
  if (!value) return null;
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
async function refresh() {
  const request = ++generation;
  const available = availableFoods.value.split(/[，,、\n]+/).map(value => value.trim()).filter(Boolean);
  if (available.length > 8 || available.some(value => value.length > 40)) {
    loading.value = false;
    error.value = "最多填写 8 种食物，每个名称不超过 40 个字。";
    return;
  }
  loading.value = true; error.value = "";
  try {
    const next = await loadMealSuggestions(props.date, style.value, available);
    if (request === generation) { result.value = next; shown.value = 3; }
  } catch (cause) {
    if (request === generation) error.value = `${cause instanceof ApiError ? cause.message : "搭配暂时读取不了，可以重试。"}${result.value ? "仍显示上次读取的搭配。" : ""}`;
  } finally { if (request === generation) loading.value = false; }
}
function use(choice: MealSuggestion) {
  if (loading.value || props.disabled) return;
  emit("use", { title: choice.title, selections: choice.items.map(item => ({ food: item.food, amount: String(item.amount) })) });
}
watch(() => props.date, () => { result.value = null; void refresh(); }, { immediate: true });
onBeforeUnmount(() => { generation++; });
</script>

<template>
  <section class="work-panel meal-suggestions" aria-labelledby="meal-suggestions-title">
    <header class="suggestion-heading"><div><h2 id="meal-suggestions-title">这顿吃什么</h2><p class="field-help">先挑搭配，实际吃了多少可以再改。</p></div><button class="text-action" type="button" @click="emit('close')">收起</button></header>
    <form class="suggestion-preferences" aria-label="选餐偏好" @submit.prevent="refresh">
      <label>这次优先<select v-model="style" :disabled="loading"><option value="all">换些口味</option><option value="rice">米饭搭配</option><option value="noodles">面食搭配</option><option value="dumplings">水饺搭配</option><option value="breakfast">早餐与便携食物</option></select></label>
      <details><summary>优先用已有食物</summary><label>已有食物<input v-model="availableFoods" maxlength="320" placeholder="如鸡蛋、馒头、酸奶" :disabled="loading" /></label><p class="field-help">只用于本次搭配排序，不发送给第三方。不同食物用顿号或逗号分开。</p></details>
      <button class="action-button" type="submit" :disabled="loading">{{ loading ? '正在组合…' : '更新搭配' }}</button>
    </form>
    <p v-if="loading" class="field-help" role="status">正在读取食物基准…</p>
    <p v-if="error" class="form-error" role="alert">{{ error }} <button class="text-action" type="button" :disabled="loading" @click="refresh">重新读取</button></p>
    <template v-if="result">
      <p class="field-help">{{ result.notice }}</p>
      <p v-if="result.choices.length < 3" class="field-help">当前目录不足三个完整搭配，可以继续用食物选择或拍照记录。</p>
      <ol class="suggestion-list">
        <li v-for="choice in result.choices.slice(0, shown)" :key="choice.id" class="suggestion-choice">
          <div class="suggestion-title"><h3>{{ choice.title }}</h3><strong>{{ formatEnergy(choice.nutrients.energyKcal) }}</strong></div>
          <p class="suggestion-amounts">{{ choice.items.map(item => `${item.food.label} ${amountText(item.amount, item.food.basisUnit)}`).join('、') }}</p>
          <p v-if="choice.reason" class="field-help">{{ choice.reason }}</p>
          <p v-if="!choice.complete.energyKcal && choice.knownSubtotal.energyKcal !== null" class="field-help">已知部分约 {{ Math.round(choice.knownSubtotal.energyKcal) }} kcal，合计尚不完整。</p>
          <details><summary>看怎么算与来源</summary>
            <p class="field-help">本份合计：蛋白质 {{ formatGrams(choice.nutrients.proteinGrams) }} · 碳水 {{ formatGrams(choice.nutrients.carbohydrateGrams) }} · 脂肪 {{ formatGrams(choice.nutrients.fatGrams) }}。</p>
            <ul class="suggestion-calculations"><li v-for="item in choice.items" :key="item.food.id"><strong>{{ item.food.label }}</strong><span>{{ item.energyFormula }}</span><small>{{ item.food.sourceName }} · {{ item.food.version }}</small><small v-if="item.food.originalName">目录样品说明：{{ item.food.originalName }}</small><a v-if="sourceLink(item.food.sourceUrl)" :href="sourceLink(item.food.sourceUrl)!" target="_blank" rel="noopener noreferrer">查看数据来源</a></li></ul>
            <ul class="suggestion-assumptions"><li v-for="note in choice.assumptions" :key="note">{{ note }}</li></ul>
            <p class="field-help">常见搜索词：{{ choice.searchTerms.join('、') }}。没有查询附近门店或库存。</p>
          </details>
          <button class="action-button" type="button" :disabled="loading || disabled" @click="use(choice)">用这份搭配记餐</button>
        </li>
      </ol>
      <button v-if="shown < result.choices.length" class="text-action" type="button" :disabled="loading" @click="shown += 3">再看几个搭配</button>
    </template>
  </section>
</template>

<style scoped>
/* Hallmark · component: meal choices · genre: modern-minimal · theme: existing app tokens
 * pre-emit critique: P4 H4 E4 S4 R4 V3 */
.meal-suggestions { min-width: 0; }
.suggestion-heading, .suggestion-title { display: flex; justify-content: space-between; align-items: start; gap: var(--space-sm); }
.suggestion-heading h2, .suggestion-title h3 { margin: 0; overflow-wrap: anywhere; min-width: 0; }
.suggestion-heading > div { min-width: 0; }
.suggestion-heading > button, .suggestion-title > strong { flex-shrink: 0; white-space: nowrap; }
.suggestion-title > strong { color: var(--color-accent); }
.suggestion-preferences { display: flex; flex-wrap: wrap; gap: var(--space-sm); align-items: end; }
.suggestion-preferences > label { flex: 1 1 12rem; min-width: 0; }
.suggestion-preferences > details { flex: 1 1 100%; min-width: 0; }
.suggestion-preferences > button { white-space: nowrap; }
.suggestion-list { list-style: none; padding: 0; margin: 0; display: grid; gap: var(--space-md); }
.suggestion-choice { border-top: var(--rule-thin) solid var(--color-rule); padding-top: var(--space-md); min-width: 0; display: grid; gap: var(--space-xs); }
.suggestion-choice > p { margin: 0; }
.suggestion-amounts, .suggestion-calculations, .suggestion-assumptions { overflow-wrap: anywhere; line-height: 1.6; }
.suggestion-amounts { font-size: var(--text-sm); }
.suggestion-choice > button { justify-self: start; white-space: nowrap; max-width: 100%; }
.suggestion-calculations { list-style: none; padding: 0; display: grid; gap: var(--space-sm); }
.suggestion-calculations > li { display: grid; gap: .25rem; }
.suggestion-calculations small { color: var(--color-muted); }
.suggestion-assumptions { padding-left: 1.25rem; font-size: var(--text-sm); color: var(--color-muted); }
@media (max-width: 479px) { .suggestion-title { flex-direction: column; gap: .25rem; } }
</style>
