<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import AppShell from "../app/AppShell.vue";
import { nutritionApi, type Meal, type NutritionDaySummary, type NutritionValueSummary } from "../api/nutrition";
import { reminderApi, type MeasurementReminderStatus, type NutritionReminderStatus, type TrainingReminderStatus } from "../api/reminders";
import { trainingApi, type TrainingSchedule, type TrainingSession } from "../api/training";
import { progressSummary } from "../features/training/plan-progress";

const router = useRouter();
function localDate() { const d = new Date(); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-"); }
const today = ref(localDate()), schedules = ref<TrainingSchedule[] | null>(null), sessions = ref<TrainingSession[] | null>(null);
const summary = ref<NutritionDaySummary | null>(null), meals = ref<Meal[] | null>(null), measurement = ref<MeasurementReminderStatus | null>(null);
const loading = ref(true), error = ref("");
const trainingReminder = ref<TrainingReminderStatus | null>(null), nutritionReminder = ref<NutritionReminderStatus | null>(null);
const notified = new Set<string>();
async function snoozeMeasurement() {
  try { await reminderApi.snoozeMeasurement(today.value); measurement.value = null; }
  catch { error.value = "暂时推迟不了提醒，请稍后重试。"; }
}
async function dismiss(kind: "training" | "nutrition" | "measurement") {
  try { if (kind === "training") { await reminderApi.dismissTraining(today.value); trainingReminder.value = null; }
    else if (kind === "nutrition") { await reminderApi.dismissNutrition(today.value); nutritionReminder.value = null; }
    else { await reminderApi.dismissMeasurement(today.value); measurement.value = null; }
  } catch { error.value = "暂时关闭不了这次提醒，请稍后重试。"; }
}
async function refreshReminders() {
  const date = today.value, zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const [a,b,c] = await Promise.allSettled([reminderApi.getTrainingStatus(date, zone), reminderApi.getNutritionStatus(date, zone), reminderApi.getMeasurementStatus(date, zone)]);
  if (date !== today.value) return;
  trainingReminder.value = a.status === "fulfilled" ? a.value : null;
  nutritionReminder.value = b.status === "fulfilled" ? b.value : null;
  if (c.status === "fulfilled") measurement.value = c.value;
  for (const [kind, status, body] of [["training", trainingReminder.value, "今天有训练计划，可以查看计划或记录练过的内容。"], ["nutrition", nutritionReminder.value, "到设定的记餐提醒时间了。"]] as const) {
    if (status?.state === "due" && typeof Notification !== "undefined" && Notification.permission === "granted" && !notified.has(date + kind)) { notified.add(date + kind); new Notification(kind === "training" ? "训练提醒" : "饮食提醒", { body }); }
  }
}
const plans = computed(() => schedules.value?.filter(value => value.status !== "cancelled") ?? []);
const lastMeal = computed(() => [...(meals.value ?? [])].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0]);
const actualNames = computed(() => [...new Set((sessions.value ?? []).flatMap(record => record.items.filter(item => item.status === "completed").map(item => item.performedExerciseName ?? item.exerciseName)))].join("、"));
const nutrients = [{ key: "energyKcal", label: "能量", unit: "kcal" }, { key: "proteinGrams", label: "蛋白质", unit: "g" }, { key: "carbohydrateGrams", label: "碳水化合物", unit: "g" }, { key: "fatGrams", label: "脂肪", unit: "g" }] as const;
function valueText(value: NutritionValueSummary | undefined, unit: string) {
  if (!summary.value) return "暂时无法读取";
  if (summary.value.mealCount === 0) return `0 ${unit}`;
  if (value?.recorded === null || value?.recorded === undefined) return "未知";
  return value.recorded + " " + unit;
}
function openNutrition(photo = false) { void router.push({ name: "nutrition", query: { date: today.value, ...(photo ? { action: "photo" } : lastMeal.value ? { mealId: lastMeal.value.id } : {}) } }); }
let sequence = 0;
async function load() {
  const token = ++sequence, date = today.value, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  loading.value = true; error.value = "";
  const results = await Promise.allSettled([trainingApi.listSchedules(date, date), trainingApi.listSessions(date, date), nutritionApi.getDaySummary(date, timeZone), nutritionApi.listMeals(date, date), reminderApi.getMeasurementStatus(date, timeZone)] as const);
  if (token !== sequence) return;
  const [a,b,c,d,e] = results;
  schedules.value = a.status === "fulfilled" ? a.value : null;
  sessions.value = b.status === "fulfilled" ? b.value : null;
  summary.value = c.status === "fulfilled" ? c.value : null;
  meals.value = d.status === "fulfilled" ? d.value : null;
  measurement.value = e.status === "fulfilled" ? e.value : null;
  if (results.some(value => value.status === "rejected")) error.value = "部分内容暂时读取不了，已保留其他内容。";
  loading.value = false;
  void refreshReminders();
}
let timer: number | undefined;
function checkDay() { const next = localDate(); if (next !== today.value) { today.value = next; schedules.value = null; sessions.value = null; meals.value = null; summary.value = null; void load(); } else void refreshReminders(); }
onMounted(() => { void load(); timer = window.setInterval(checkDay, 15_000); window.addEventListener("focus", checkDay); });
onBeforeUnmount(() => { ++sequence; window.clearInterval(timer); window.removeEventListener("focus", checkDay); });
</script>

<template>
  <AppShell page-class="today-page" rail-note="看看今天记下了什么。">
    <header class="view-header"><div><p class="date-line">{{ today }}</p><h1>今天</h1></div></header>
    <p v-if="error" class="form-error" role="alert">{{ error }} <button class="text-action" @click="load">重试</button></p>
    <p v-if="loading" role="status">正在读取今天的内容…</p>
    <div v-else class="view-stack">
      <section class="balance-panel" aria-labelledby="today-food-title">
        <div class="panel-heading"><h2 id="today-food-title">今天已记录的饮食</h2></div>
        <p v-if="nutritionReminder?.state === 'due'" class="data-note">到记餐提醒时间了。 <button class="text-action" @click="dismiss('nutrition')">今天不再提醒</button></p>
        <dl class="metric-list"><div v-for="nutrient in nutrients" :key="nutrient.key"><dt>{{ nutrient.label }}</dt><dd>{{ valueText(summary?.[nutrient.key], nutrient.unit) }}</dd></div></dl>
        <p class="data-note">{{ summary && summary.mealCount > 0 && nutrients.some(n => !summary![n.key].complete) ? '部分营养未知，合计仅含已知值。' : '仅统计已记录餐食，不代表全天摄入。' }}</p>
        <button class="action-button action-button--primary" @click="openNutrition(true)">拍照记一餐</button>
        <button class="today-last-meal text-action" @click="openNutrition()">
          <template v-if="lastMeal">上一餐 {{ new Date(lastMeal.occurredAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }} · {{ lastMeal.name ?? '餐食' }} · 查看今天餐食 →</template>
          <template v-else>{{ meals === null ? '餐食暂时无法读取' : '今天还没有餐食记录' }} · 进入饮食 →</template>
        </button>
      </section>
      <section class="work-panel today-training-panel" aria-labelledby="today-training-title">
        <div class="panel-heading"><h2 id="today-training-title">今天的训练</h2></div>
        <p v-if="trainingReminder?.state === 'due'" class="data-note">今天有训练计划。 <button class="text-action" @click="dismiss('training')">今天不再提醒</button></p>
        <p v-if="schedules === null">训练计划暂时无法读取。</p>
        <template v-else-if="plans.length"><div v-for="plan in plans" :key="plan.id" class="today-schedule-card"><div><strong>{{ plan.title }}</strong><p>{{ progressSummary(plan) }}</p></div></div><button class="text-action" @click="router.push({ name: 'training', query: { date: today } })">查看／修改今天计划 →</button></template>
        <p v-else>{{ sessions === null ? '训练记录暂时无法读取。' : actualNames || '今天还没有训练记录' }}</p>
        <p v-if="plans.length && actualNames" class="data-note">实际记录：{{ actualNames }}</p>
        <button class="action-button action-button--primary" @click="router.push({ name: 'training', query: { date: today, new: '1' } })">记录训练内容</button>
      </section>
      <div v-if="measurement?.state === 'due'" class="data-note" aria-label="身体测量提醒"><p>{{ measurement.latestMeasurementDate ? '上次体重记录于 ' + measurement.latestMeasurementDate + '，可以更新了。' : '有测量值时，可以记下体重。' }}</p><button class="text-action" @click="router.push({ name: 'settings', params: { section: 'measurement' } })">记录身体数据 →</button><div class="row-actions"><button class="text-action" @click="snoozeMeasurement">明天再提醒</button><button class="text-action" @click="dismiss('measurement')">本次忽略</button></div></div>
    </div>
  </AppShell>
</template>

<style scoped>
.today-last-meal { display: block; text-align: left; width: 100%; }
.metric-list dd { font-size: clamp(1rem, 2vw, 1.6rem); }
.balance-panel, .today-training-panel { gap: .75rem; padding: 1rem; }
.metric-list > div { padding-block: .5rem; }
.view-stack { gap: 1rem; }
.today-schedule-card { padding: 0; }
</style>
