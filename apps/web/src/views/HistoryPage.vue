<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import AppShell from "../app/AppShell.vue";
import BodyTrendChart from "../components/BodyTrendChart.vue";
import { nutritionApi, type Meal, type NutrientValues } from "../api/nutrition";
import { planningApi, type BodyMeasurement } from "../api/planning";
import { trainingApi, type TrainingSession } from "../api/training";
import { actionSummary } from "../features/training/record-draft";
const router = useRouter(), route = useRoute();
function dayAgo(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-"); }
function query(key: string, fallback: string) { return typeof route.query[key] === "string" ? route.query[key] as string : fallback; }
const tab = ref(query("tab", "records")), filter = ref(query("filter", "all")), metric = ref(query("metric", "body"));
const from = ref(query("from", dayAgo(89))), to = ref(query("to", dayAgo(0))), date = ref(query("date", "")), exercise = ref(query("exercise", ""));
const appliedFrom = ref(from.value), appliedTo = ref(to.value);
const sessions = ref<TrainingSession[]>([]), meals = ref<Meal[]>([]), measurements = ref<BodyMeasurement[]>([]);
const loading = ref(true), error = ref(""), trainingAvailable = ref(false), mealsAvailable = ref(false), bodyAvailable = ref(false);
const nutrients = [{ key: "energyKcal", label: "能量", unit: "kcal" }, { key: "proteinGrams", label: "蛋白质", unit: "g" }, { key: "carbohydrateGrams", label: "碳水化合物", unit: "g" }, { key: "fatGrams", label: "脂肪", unit: "g" }] as const;
const actual = computed(() => sessions.value.filter(record => record.items.some(item => item.status === "completed")));
const body = computed(() => measurements.value.filter(value => value.localDate >= appliedFrom.value && value.localDate <= appliedTo.value));
const days = computed(() => [...new Set([
  ...(filter.value === "all" || filter.value === "training" ? sessions.value.map(value => value.localDate) : []),
  ...(filter.value === "all" || filter.value === "nutrition" ? meals.value.map(value => value.localDate) : []),
  ...(filter.value === "all" || filter.value === "measurement" ? body.value.map(value => value.localDate) : []),
])].filter(value => !date.value || value === date.value).sort().reverse());
const names = computed(() => [...new Set(actual.value.flatMap(record => record.items.filter(item => item.status === "completed").map(item => item.performedExerciseName ?? item.exerciseName)))].sort());
const trainingDays = computed(() => new Set(actual.value.map(value => value.localDate)).size);
const actionRows = computed(() => actual.value.flatMap(record => record.items.filter(item => item.status === "completed" && (item.performedExerciseName ?? item.exerciseName) === exercise.value).map(item => ({ date: record.localDate, id: item.id, recordId: record.id, text: actionSummary(item) }))));
const mealDates = computed(() => [...new Set(meals.value.map(value => value.localDate))].sort().reverse());
function nutrientText(dateValue: string, key: keyof NutrientValues, unit: string) {
  const source = meals.value.filter(meal => meal.localDate === dateValue), items = source.flatMap(meal => meal.contributions);
  const values = items.map(item => item[key]).filter((value): value is number => value !== null);
  if (!values.length) return "未知";
  const incomplete = values.length !== items.length || source.some(meal => !meal.contributions.length);
  return Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100 + " " + unit + (incomplete ? "（部分已知）" : "");
}
function stateQuery() { return { tab: tab.value, filter: filter.value, metric: metric.value, from: appliedFrom.value, to: appliedTo.value, date: date.value, exercise: exercise.value }; }
watch([tab, filter, metric, date, exercise], () => { void router.replace({ name: "history", query: stateQuery() }); });
function openRecord(kind: "training" | "nutrition" | "measurement", id: string, localDate: string) {
  const scroll = Math.max(0, document.querySelector(".app-main")?.scrollTop ?? 0, window.scrollY);
  const returnTo = router.resolve({ name: "history", query: { ...stateQuery(), scroll: Math.round(scroll).toString() } }).fullPath;
  void router.push(kind === "measurement" ? { name: "settings", params: { section: "measurement" }, query: { edit: id, returnTo } } : { name: kind, query: { date: localDate, ...(kind === "training" ? { edit: id } : { mealId: id }), returnTo } });
}
let sequence = 0;
async function load() {
  const token = ++sequence; error.value = "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from.value) || !/^\d{4}-\d{2}-\d{2}$/.test(to.value) || from.value > to.value) { error.value = "请填写有效的起止日期。"; loading.value = false; return; }
  loading.value = true;
  appliedFrom.value = from.value; appliedTo.value = to.value;
  const result = await Promise.allSettled([trainingApi.listSessions(from.value, to.value), nutritionApi.listMeals(from.value, to.value), planningApi.listMeasurements()] as const);
  if (token !== sequence) return;
  const [a,b,c] = result;
  trainingAvailable.value = a.status === "fulfilled"; mealsAvailable.value = b.status === "fulfilled"; bodyAvailable.value = c.status === "fulfilled";
  sessions.value = a.status === "fulfilled" ? a.value : []; meals.value = b.status === "fulfilled" ? b.value : []; measurements.value = c.status === "fulfilled" ? c.value : [];
  if (result.some(value => value.status === "rejected")) error.value = "部分记录读取失败；不可用的数据没有作为零或无记录统计。";
  loading.value = false;
  await nextTick();
  const scroll = Number(route.query.scroll);
  if (Number.isFinite(scroll) && scroll >= 0) {
    const top = Math.min(scroll, 1_000_000);
    document.querySelector(".app-main")?.scrollTo({ top, behavior: "instant" });
    window.scrollTo({ top, behavior: "instant" });
  }
}
async function applyRange() { await load(); if (!error.value) { date.value = ""; await router.replace({ name: "history", query: stateQuery() }); } }
onMounted(() => void load());
</script>

<template>
  <AppShell page-class="history-page" rail-note="记录回到原页面修改，趋势只采用实际记录。">
    <header class="view-header"><div><h1>历史</h1><p>回看记录，或查看一段时间的变化。</p></div></header>
    <nav class="history-filters" aria-label="历史视图"><button :aria-pressed="tab === 'records'" @click="tab = 'records'">记录</button><button :aria-pressed="tab === 'trends'" @click="tab = 'trends'">趋势</button></nav>
    <details class="history-range-options"><summary>时间范围：{{ query('from', dayAgo(89)) }} 至 {{ query('to', dayAgo(0)) }}</summary><form class="field-grid history-range" @submit.prevent="applyRange"><label>开始日期<input v-model="from" type="date" required /></label><label>结束日期<input v-model="to" type="date" required /></label><button class="action-button" type="submit">查看这段时间</button></form></details>
    <p v-if="error" class="form-error" role="alert">{{ error }} <button class="text-action" @click="load">重试</button></p>
    <p v-if="loading" role="status">正在读取历史记录…</p>
    <template v-else-if="tab === 'records'">
      <div class="history-filters" aria-label="筛选按日记录"><button v-for="item in [{ id: 'all', label: '全部' }, { id: 'training', label: '训练' }, { id: 'nutrition', label: '饮食' }, { id: 'measurement', label: '身体' }]" :key="item.id" :aria-pressed="filter === item.id" @click="filter = item.id">{{ item.label }}</button></div>
      <label class="history-date-filter">定位日期<input v-model="date" type="date" :min="from" :max="to" /></label><button v-if="date" class="text-action" @click="date = ''">查看全部日期</button>
      <p v-if="!days.length && !error">这段时间没有符合筛选的记录。未记录不代表没有运动或进食。</p>
      <button v-if="!days.length && !error" class="text-action" @click="router.push({ name: 'today' })">回到今天</button>
      <section v-for="day in days" :key="day" class="work-panel history-day-records" :aria-label="day + '的记录'">
        <h2>{{ day }}</h2>
        <template v-if="filter === 'all' || filter === 'training'"><article v-for="record in sessions.filter(value => value.localDate === day)" :key="record.id" class="history-session"><strong>训练 · {{ record.recordedTime ?? '时间未记录' }}</strong><p>{{ record.items.filter(item => item.status === 'completed').map(item => item.performedExerciseName ?? item.exerciseName).join('、') || '没有已确认的实际动作' }}</p><details><summary>查看记录内容</summary><ul><li v-for="item in record.items.filter(item => item.status === 'completed')" :key="item.id">{{ item.performedExerciseName ?? item.exerciseName }} · {{ actionSummary(item) }}</li></ul><p>{{ record.note }}</p></details><button class="text-action" @click="openRecord('training', record.id, day)">查看／修改训练</button></article></template>
        <template v-if="filter === 'all' || filter === 'nutrition'"><article v-for="meal in meals.filter(value => value.localDate === day)" :key="meal.id" class="history-session"><strong>{{ meal.name ?? '餐食' }} · {{ new Date(meal.occurredAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }}</strong><p>{{ meal.contributions.map(value => value.label).join('、') || '尚无食物明细' }}</p><button class="text-action" @click="openRecord('nutrition', meal.id, day)">查看／修改餐食</button></article></template>
        <template v-if="filter === 'all' || filter === 'measurement'"><article v-for="item in body.filter(value => value.localDate === day)" :key="item.id" class="history-session"><strong>体重 {{ item.weightKg }} kg</strong><p>腰围 {{ item.waistCm === null ? '未记录' : item.waistCm + ' cm' }} · {{ item.note ?? '' }}</p><button class="text-action" @click="openRecord('measurement', item.id, day)">查看／修正身体记录</button></article></template>
      </section>
    </template>
    <template v-else>
      <div class="history-filters" aria-label="趋势类型"><button :aria-pressed="metric === 'body'" @click="metric = 'body'">身体</button><button :aria-pressed="metric === 'training'" @click="metric = 'training'">训练</button><button :aria-pressed="metric === 'nutrition'" @click="metric = 'nutrition'">饮食</button></div>
      <section v-if="metric === 'body'" class="work-panel"><h2>身体趋势</h2><p>仅列出真实测量日期，不补零或推算未测日期。</p><p v-if="!bodyAvailable">身体数据暂时不可用。</p><p v-else-if="!body.length">这段时间没有身体测量记录。</p><BodyTrendChart v-if="bodyAvailable && body.length" :measurements="body" /><ul v-if="bodyAvailable && body.length" class="measurement-list"><li v-for="item in body" :key="item.id"><div><strong>{{ item.localDate }}</strong><span>体重 {{ item.weightKg }} kg · 腰围 {{ item.waistCm === null ? '未记录' : item.waistCm + ' cm' }}</span></div><button class="text-action" @click="openRecord('measurement', item.id, item.localDate)">查看／修正</button></li></ul></section>
      <section v-else-if="metric === 'training'" class="work-panel"><h2>训练趋势</h2><p v-if="!trainingAvailable">训练记录暂时不可用。</p><template v-else><p>这段时间已记录 {{ actual.length }} 次训练，分布在 {{ trainingDays }} 天。次数按实际训练记录计，不按动作数量计。</p><label>查看某个动作<select v-model="exercise"><option value="">请选择动作</option><option v-for="name in names" :key="name">{{ name }}</option></select></label><p>同一动作逐次回看组数、次数、重量或时长、距离；未记录的数量不当作零，不混合不同动作计算进步。</p><ul class="measurement-list"><li v-for="row in actionRows" :key="row.id"><div><strong>{{ row.date }} · {{ exercise }}</strong><span>{{ row.text }}</span></div><button class="text-action" @click="openRecord('training', row.recordId, row.date)">查看训练</button></li></ul></template></section>
      <section v-else class="work-panel"><h2>饮食趋势</h2><p>按天汇总已记录的四项营养，不等于全天摄入，不计算可能漏记日期的平均摄入。缺少的日期不补零。</p><p v-if="!mealsAvailable">饮食记录暂时不可用。</p><p v-else-if="!mealDates.length">这段时间没有餐食记录。</p><div v-else class="history-trend-table-wrap" tabindex="0" aria-label="饮食趋势，可左右滚动"><table class="history-trend-table"><thead><tr><th>日期</th><th v-for="n in nutrients" :key="n.key">{{ n.label }}</th></tr></thead><tbody><tr v-for="day in mealDates" :key="day"><th scope="row">{{ day }}</th><td v-for="n in nutrients" :key="n.key">{{ nutrientText(day, n.key, n.unit) }}</td></tr></tbody></table></div></section>
    </template>
  </AppShell>
</template>
<style scoped>
.history-range { margin-block: 1rem; align-items: end; }
.history-day-records { margin-block: 1rem; }
.history-date-filter { display: inline-flex; align-items: center; gap: .75rem; margin-block: 1rem; }
.history-filters { display: flex; flex-wrap: wrap; }
.history-range-options summary { min-height: 2.75rem; cursor: pointer; }
.history-page :deep(.app-main) { gap: 1rem; align-content: start; }
</style>
