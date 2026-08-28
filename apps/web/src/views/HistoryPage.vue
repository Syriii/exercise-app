<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";

import { ApiError } from "../api/client";
import AppShell from "../app/AppShell.vue";
import { nutritionApi, type Meal } from "../api/nutrition";
import { planningApi, type BodyMeasurement } from "../api/planning";
import {
  trainingApi,
  type TrainingExpenditureActivity,
  type TrainingExpenditureActivityCode,
  type TrainingSession,
  type TrainingSessionItem,
  type TrainingSessionItemRevision,
  type TrainingSessionRevision,
  type TrainingSetInput,
} from "../api/training";

const router = useRouter();
const sessions = ref<TrainingSession[]>([]);
const meals = ref<Meal[]>([]);
const measurements = ref<BodyMeasurement[]>([]);
const loading = ref(true);
const saving = ref(false);
const errorMessage = ref("");
const notice = ref("");
const filter = ref<"all" | "training" | "nutrition">("all");
const expandedSessionId = ref<string | null>(null);
const editingItemId = ref<string | null>(null);
const editingSessionId = ref<string | null>(null);
const addingExtraSessionId = ref<string | null>(null);
const editingExpenditureSessionId = ref<string | null>(null);
const expenditureActivities = ref<readonly TrainingExpenditureActivity[]>([]);

interface CorrectionSetForm {
  reps: string;
  weightKg: string;
  durationSeconds: string;
  distanceMeters: string;
}

interface CorrectionForm {
  status: "completed" | "skipped";
  performedExerciseName: string;
  actualNote: string;
  sets: CorrectionSetForm[];
}

const correctionForms = reactive<Record<string, CorrectionForm>>({});
const itemRevisions = reactive<Record<string, readonly TrainingSessionItemRevision[]>>({});
const sessionRevisions = reactive<Record<string, readonly TrainingSessionRevision[]>>({});
const sessionForms = reactive<Record<string, { localDate: string; note: string }>>({});
const extraForms = reactive<Record<string, { exerciseName: string; actualNote: string; sets: CorrectionSetForm[] }>>({});
const expenditureForms = reactive<Record<string, { activityCode: TrainingExpenditureActivityCode | ""; durationMinutes: string }>>({});

const historyDays = computed(() => {
  const dates = new Set<string>();
  if (filter.value !== "nutrition") sessions.value.forEach((value) => dates.add(value.localDate));
  if (filter.value !== "training") meals.value.forEach((value) => dates.add(value.localDate));
  return [...dates].sort((left, right) => right.localeCompare(left)).map((date) => ({
    date,
    sessions: filter.value === "nutrition" ? [] : sessions.value.filter((value) => value.localDate === date),
    meals: filter.value === "training" ? [] : meals.value.filter((value) => value.localDate === date),
  }));
});

const trendRows = computed(() => {
  const dates = new Set<string>();
  sessions.value.forEach((value) => dates.add(value.localDate));
  meals.value.forEach((value) => dates.add(value.localDate));
  measurements.value.filter((value) => value.localDate >= daysAgo(89)).forEach((value) => dates.add(value.localDate));
  return [...dates].sort((left, right) => right.localeCompare(left)).slice(0, 14).map((date) => {
    const dateSessions = sessions.value.filter((value) => value.localDate === date);
    const dateMeals = meals.value.filter((value) => value.localDate === date);
    const dateMeasurements = measurements.value.filter((value) => value.localDate === date).sort((left, right) => right.measuredAt.localeCompare(left.measuredAt));
    return {
      date,
      sessions: dateSessions.length,
      completedActions: dateSessions.flatMap((value) => value.items).filter((value) => value.status === "completed").length,
      energyKcal: mealNutrient(dateMeals, "energyKcal"),
      proteinGrams: mealNutrient(dateMeals, "proteinGrams"),
      weightKg: dateMeasurements[0]?.weightKg ?? null,
    };
  });
});

const trendSummary = computed(() => {
  const orderedWeights = measurements.value.filter((value) => value.localDate >= daysAgo(89)).sort((left, right) => left.measuredAt.localeCompare(right.measuredAt));
  const firstWeight = orderedWeights[0]?.weightKg ?? null;
  const lastWeight = orderedWeights.at(-1)?.weightKg ?? null;
  return {
    sessions: sessions.value.length,
    completedActions: sessions.value.flatMap((value) => value.items).filter((value) => value.status === "completed").length,
    mealDays: new Set(meals.value.map((value) => value.localDate)).size,
    weightChange: firstWeight === null || lastWeight === null || orderedWeights.length < 2 ? null : Math.round((lastWeight - firstWeight) * 10) / 10,
  };
});

function mealNutrient(dayMeals: readonly Meal[], key: "energyKcal" | "proteinGrams"): number | null {
  const known = dayMeals.flatMap((meal) => meal.contributions.map((value) => value[key])).filter((value): value is number => value !== null);
  return known.length === 0 ? null : Math.round(known.reduce((sum, value) => sum + value, 0) * 10) / 10;
}

function mealEnergy(dayMeals: readonly Meal[]): string {
  const values = dayMeals.flatMap((meal) => meal.contributions.map((item) => item.energyKcal));
  const known = values.filter((value): value is number => value !== null);
  if (known.length === 0) return "能量尚未知";
  const total = Math.round(known.reduce((sum, value) => sum + value, 0) * 10) / 10;
  return `${total} kcal${known.length === values.length ? "" : "（部分）"}`;
}

function openNutritionDate(date: string) {
  void router.push({ name: "nutrition", query: { date } });
}

function localDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function daysAgo(days: number): string {
  const value = new Date();
  value.setDate(value.getDate() - days);
  return localDate(value);
}

function displayDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "short" }).format(new Date(`${value}T12:00:00`));
}

function sessionTitle(training: TrainingSession): string {
  if (training.sourceScheduleTitle !== null) return training.sourceScheduleTitle;
  if (training.sourceProgramName !== null) return `${training.sourceProgramName} · 第 ${training.sourceWeekNumber} 周 · ${training.sourceTrainingDayName}`;
  return training.sourceTemplateName ?? "空白训练";
}

function completedItems(training: TrainingSession): string {
  const completed = training.items.filter((item) => item.status === "completed");
  if (completed.length === 0) return "没有标记完成的动作";
  return completed.map(displayedExercise).join("、");
}

function displayedExercise(item: TrainingSessionItem): string {
  return item.performedExerciseName ?? item.exerciseName;
}

function describeItem(item: TrainingSessionItem): string {
  if (item.status === "pending") return `未处理 · 原计划 ${item.exerciseName}`;
  if (item.status === "skipped") return `已跳过 · 原计划 ${item.exerciseName}`;
  const relationship = item.performedExerciseName === item.exerciseName || item.origin === "extra"
    ? "已完成"
    : `替代 ${item.exerciseName}`;
  const setSummary = item.sets.length === 0 ? "未记录训练量" : item.sets.map((set) => {
    const values = [
      set.reps === null ? null : `${set.reps} 次`,
      set.weightKg === null ? null : `${Number(set.weightKg)} kg`,
      set.durationSeconds === null ? null : `${set.durationSeconds} 秒`,
      set.distanceMeters === null ? null : `${Number(set.distanceMeters)} 米`,
    ].filter((value): value is string => value !== null);
    return values.length === 0 ? "该组未填量" : values.join(" · ");
  }).join("；");
  return `${relationship} · ${setSummary}`;
}

function openCorrection(item: TrainingSessionItem) {
  correctionForms[item.id] = {
    status: item.status === "skipped" ? "skipped" : "completed",
    performedExerciseName: item.performedExerciseName ?? item.exerciseName,
    actualNote: item.actualNote ?? "",
    sets: item.sets.length === 0
      ? [{ reps: "", weightKg: "", durationSeconds: "", distanceMeters: "" }]
      : item.sets.map((set) => ({
          reps: set.reps?.toString() ?? "",
          weightKg: set.weightKg === null ? "" : Number(set.weightKg).toString(),
          durationSeconds: set.durationSeconds?.toString() ?? "",
          distanceMeters: set.distanceMeters === null ? "" : Number(set.distanceMeters).toString(),
        })),
  };
  editingItemId.value = item.id;
}

async function toggleSessionDetails(training: TrainingSession) {
  if (expandedSessionId.value === training.id) {
    expandedSessionId.value = null;
    return;
  }
  expandedSessionId.value = training.id;
  if (itemRevisions[training.id] !== undefined && sessionRevisions[training.id] !== undefined) return;
  try {
    const [items, metadata] = await Promise.all([
      trainingApi.listItemRevisions(training.id),
      trainingApi.listSessionRevisions(training.id),
    ]);
    itemRevisions[training.id] = items;
    sessionRevisions[training.id] = metadata;
  } catch (error) {
    console.error("History revisions load failed", error);
    errorMessage.value = error instanceof ApiError ? error.message : "暂时读取不了修订记录";
  }
}

function openSessionCorrection(training: TrainingSession) {
  sessionForms[training.id] = { localDate: training.localDate, note: training.note ?? "" };
  editingSessionId.value = training.id;
}

function openExtraCorrection(training: TrainingSession) {
  extraForms[training.id] = {
    exerciseName: "",
    actualNote: "",
    sets: [{ reps: "", weightKg: "", durationSeconds: "", distanceMeters: "" }],
  };
  addingExtraSessionId.value = training.id;
}

function openExpenditure(training: TrainingSession) {
  const elapsedMinutes = training.endedAt === null
    ? 60
    : Math.max(1, Math.min(720, Math.round((new Date(training.endedAt).getTime() - new Date(training.startedAt).getTime()) / 60_000)));
  expenditureForms[training.id] = {
    activityCode: training.expenditureAssessment?.inputSnapshot.activityCode ?? "",
    durationMinutes: training.expenditureAssessment?.inputSnapshot.durationMinutes?.toString() ?? elapsedMinutes.toString(),
  };
  editingExpenditureSessionId.value = training.id;
}

async function saveExpenditure(training: TrainingSession) {
  const form = expenditureForms[training.id];
  if (form === undefined) return;
  saving.value = true;
  errorMessage.value = "";
  try {
    const activityCode = form.activityCode === "" ? null : form.activityCode;
    const durationMinutes = activityCode === null ? null : Number.parseInt(form.durationMinutes, 10);
    const updated = await trainingApi.assessSessionExpenditure(training.id, training.revision, activityCode, durationMinutes);
    sessions.value = sessions.value.map((candidate) => candidate.id === updated.id ? updated : candidate);
    sessionRevisions[training.id] = await trainingApi.listSessionRevisions(training.id);
    editingExpenditureSessionId.value = null;
    notice.value = updated.expenditureAssessment?.status === "estimated"
      ? "训练消耗估算已保存；它只用于训练回顾，不会改变今天还能吃多少"
      : "已保存为暂时无法估算，训练记录本身不受影响";
  } catch (error) {
    console.error("Training expenditure assessment failed", error);
    errorMessage.value = error instanceof ApiError ? error.message : "暂时估算不了这次训练";
  } finally {
    saving.value = false;
  }
}

async function saveSessionCorrection(training: TrainingSession) {
  const form = sessionForms[training.id];
  if (form === undefined) return;
  saving.value = true;
  errorMessage.value = "";
  try {
    const updated = await trainingApi.updateSessionMetadata(
      training.id,
      training.revision,
      form.localDate,
      nullableText(form.note),
    );
    sessions.value = sessions.value.map((candidate) => candidate.id === updated.id ? updated : candidate);
    sessionRevisions[training.id] = await trainingApi.listSessionRevisions(training.id);
    editingSessionId.value = null;
    notice.value = "训练归属日期或备注已修正；开始时间和当时时区仍保留";
  } catch (error) {
    console.error("Session metadata correction failed", error);
    errorMessage.value = error instanceof ApiError ? error.message : "暂时保存不了训练日期修正";
  } finally {
    saving.value = false;
  }
}

async function saveHistoricalExtra(training: TrainingSession) {
  const form = extraForms[training.id];
  if (form === undefined) return;
  saving.value = true;
  errorMessage.value = "";
  try {
    const sets = correctionSets({ status: "completed", performedExerciseName: form.exerciseName, actualNote: form.actualNote, sets: form.sets });
    const updated = await trainingApi.addExtraItem(
      training.id,
      training.revision,
      form.exerciseName,
      nullableText(form.actualNote),
      sets,
    );
    sessions.value = sessions.value.map((candidate) => candidate.id === updated.id ? updated : candidate);
    addingExtraSessionId.value = null;
    notice.value = "遗漏的实际动作已补记到这次训练";
  } catch (error) {
    console.error("Historical extra action failed", error);
    errorMessage.value = error instanceof ApiError ? error.message : "暂时补记不了这个动作";
  } finally {
    saving.value = false;
  }
}

function revisionsFor(trainingId: string, itemId: string): readonly TrainingSessionItemRevision[] {
  return itemRevisions[trainingId]?.filter((revision) => revision.sessionItemId === itemId) ?? [];
}

function revisionDescription(revision: TrainingSessionItemRevision): string {
  if (revision.status === "pending") return "当时仍是待完成";
  if (revision.status === "skipped") return `当时标为跳过${revision.actualNote === null ? "" : `：${revision.actualNote}`}`;
  const name = revision.performedExerciseName ?? "未填写实际动作";
  return `当时记录为 ${name}，${revision.sets.length} 组`;
}

function nullableInteger(value: string): number | null {
  const cleaned = value.trim();
  return cleaned.length === 0 ? null : Number.parseInt(cleaned, 10);
}

function nullableText(value: string): string | null {
  const cleaned = value.trim();
  return cleaned.length === 0 ? null : cleaned;
}

function correctionSets(form: CorrectionForm): TrainingSetInput[] {
  if (form.status === "skipped") return [];
  return form.sets
    .filter((set) => [set.reps, set.weightKg, set.durationSeconds, set.distanceMeters].some((value) => value.trim().length > 0))
    .map((set) => ({
      reps: nullableInteger(set.reps),
      weightKg: nullableText(set.weightKg),
      durationSeconds: nullableInteger(set.durationSeconds),
      distanceMeters: nullableText(set.distanceMeters),
      note: null,
    }));
}

async function saveCorrection(training: TrainingSession, item: TrainingSessionItem) {
  const form = correctionForms[item.id];
  if (form === undefined) return;
  saving.value = true;
  errorMessage.value = "";
  try {
    const updated = await trainingApi.updateItem(
      training.id,
      item.id,
      training.revision,
      form.status,
      form.status === "completed" ? nullableText(form.performedExerciseName) : null,
      nullableText(form.actualNote),
      correctionSets(form),
    );
    sessions.value = sessions.value.map((candidate) => candidate.id === updated.id ? updated : candidate);
    itemRevisions[training.id] = await trainingApi.listItemRevisions(training.id);
    editingItemId.value = null;
    notice.value = "训练记录已修正，原方案没有改变";
  } catch (error) {
    console.error("History correction failed", error);
    errorMessage.value = error instanceof ApiError ? error.message : "暂时保存不了这次修正";
  } finally {
    saving.value = false;
  }
}

async function load() {
  loading.value = true;
  errorMessage.value = "";
  const results = await Promise.allSettled([
      trainingApi.listSessions(daysAgo(89), localDate(new Date())),
      nutritionApi.listMeals(daysAgo(89), localDate(new Date())),
      trainingApi.listExpenditureActivities(),
      planningApi.listMeasurements(),
  ] as const);
  const [sessionsResult, mealsResult, activitiesResult, measurementsResult] = results;
  if (sessionsResult.status === "fulfilled") sessions.value = sessionsResult.value;
  if (mealsResult.status === "fulfilled") meals.value = mealsResult.value;
  if (activitiesResult.status === "fulfilled") expenditureActivities.value = activitiesResult.value;
  if (measurementsResult.status === "fulfilled") measurements.value = measurementsResult.value;
  const failed = results.find((result) => result.status === "rejected");
  if (failed?.status === "rejected") {
    console.error("History page loaded partially", failed.reason);
    const detail = failed.reason instanceof ApiError ? failed.reason.message : "部分历史内容暂时读取不了";
    errorMessage.value = `${detail}；其他可用内容已保留，可以稍后重试。`;
  }
  loading.value = false;
}

onMounted(() => void load());
</script>

<template>
  <AppShell page-class="history-page" rail-note="历史优先回答实际做了什么。">
        <header class="view-header"><div><p class="date-line">最近 90 天</p><h1>按天回看</h1><p>训练和饮食按日期放在一起，也可以单独筛选。</p></div></header>
        <div class="history-filters" aria-label="筛选历史内容"><button type="button" :aria-pressed="filter === 'all'" @click="filter = 'all'">全部</button><button type="button" :aria-pressed="filter === 'training'" @click="filter = 'training'">训练</button><button type="button" :aria-pressed="filter === 'nutrition'" @click="filter = 'nutrition'">饮食</button></div>
        <section v-if="!loading" class="work-panel history-trends" aria-labelledby="history-trends-title">
          <div class="panel-heading"><div><h2 id="history-trends-title">最近 90 天的记录趋势</h2><p>只汇总实际保存的数据；没有记录的日期不会补成 0。</p></div></div>
          <dl class="history-trend-summary"><div><dt>实际训练</dt><dd>{{ trendSummary.sessions }} 次</dd><span>{{ trendSummary.completedActions }} 个完成动作</span></div><div><dt>有饮食记录</dt><dd>{{ trendSummary.mealDays }} 天</dd><span>未知营养不参与求和</span></div><div><dt>记录体重变化</dt><dd>{{ trendSummary.weightChange === null ? '—' : `${trendSummary.weightChange > 0 ? '+' : ''}${trendSummary.weightChange} kg` }}</dd><span>{{ measurements.length < 2 ? '至少两次测量后显示' : '按首末有效测量' }}</span></div></dl>
          <p v-if="trendRows.length" class="horizontal-scroll-hint">表格可以左右滑动查看完整数据。</p><div v-if="trendRows.length" class="history-trend-table-wrap" tabindex="0" aria-label="最近 90 天趋势表，可左右滚动"><table class="history-trend-table"><thead><tr><th>日期</th><th>训练</th><th>能量</th><th>蛋白质</th><th>体重</th></tr></thead><tbody><tr v-for="row in trendRows" :key="row.date"><th scope="row">{{ row.date.slice(5) }}</th><td>{{ row.sessions === 0 ? '—' : `${row.sessions} 次 / ${row.completedActions} 动作` }}</td><td>{{ row.energyKcal === null ? '—' : `${row.energyKcal} kcal` }}</td><td>{{ row.proteinGrams === null ? '—' : `${row.proteinGrams} g` }}</td><td>{{ row.weightKg === null ? '—' : `${row.weightKg} kg` }}</td></tr></tbody></table></div>
          <p v-else class="empty-copy">还没有足够记录形成趋势。</p>
        </section>
        <p v-if="errorMessage" class="form-error" role="alert">{{ errorMessage }}</p>
        <p v-if="notice" class="training-notice" role="status">{{ notice }}</p>
        <section v-if="loading" class="work-panel training-empty"><strong>正在读取历史记录…</strong></section>
        <section v-else-if="historyDays.length === 0" class="work-panel training-empty"><strong>最近 90 天没有对应记录</strong><p>没有记录不代表没有训练或进食。</p></section>
        <section v-else class="history-list" aria-label="按日期排列的训练与饮食历史">
          <article v-for="day in historyDays" :key="day.date" class="history-day history-day--real">
            <time :datetime="day.date">{{ displayDate(day.date) }}</time>
            <div class="history-day__sections">
              <section v-for="training in day.sessions" :key="training.id" class="history-session">
                <div class="history-session__heading">
                  <strong>{{ sessionTitle(training) }}</strong>
                  <button class="text-action" type="button" @click="toggleSessionDetails(training)">
                    {{ expandedSessionId === training.id ? '收起' : '查看详情' }}
                  </button>
                </div>
                <p>{{ completedItems(training) }}</p>
                <small>{{ training.status === 'in_progress' ? '进行中' : training.status === 'completed' ? '已完成' : '提前结束' }} · {{ training.items.length }} 个动作</small>
                <div v-if="expandedSessionId === training.id" class="history-session__details">
                  <div class="history-detail-actions"><button class="text-action" type="button" @click="openSessionCorrection(training)">修正日期或备注</button><button class="text-action" type="button" @click="openExtraCorrection(training)">补记实际动作</button><button v-if="training.status !== 'in_progress'" class="text-action" type="button" @click="openExpenditure(training)">{{ training.expenditureAssessment === null ? '估算训练消耗' : '重新估算消耗' }}</button></div>
                  <article v-if="training.expenditureAssessment" class="history-item">
                    <div class="history-item__heading"><div><strong>训练消耗估算</strong><small v-if="training.expenditureAssessment.status === 'estimated'">约 {{ training.expenditureAssessment.grossEnergyKcal }} kcal（其中净活动消耗约 {{ training.expenditureAssessment.netEnergyKcal }} kcal）</small><small v-else>当前条件下没有给出数值</small></div></div>
                    <p v-if="training.expenditureAssessment.activityLabel">{{ training.expenditureAssessment.activityLabel }} · {{ training.expenditureAssessment.activityDescription }} · {{ training.expenditureAssessment.inputSnapshot.durationMinutes }} 分钟</p>
                    <p v-for="message in training.expenditureAssessment.messages" :key="message" class="data-note">{{ message }}</p>
                    <details class="history-revisions"><summary>查看计算依据与限制</summary><p>{{ training.expenditureAssessment.formula }}</p><p>采用体重：{{ training.expenditureAssessment.inputSnapshot.weightMeasurement?.weightKg ?? '缺少' }} kg；证据 {{ training.expenditureAssessment.evidenceIds.join('、') }}；方法 {{ training.expenditureAssessment.methodVersion }}</p><ul><li v-for="limitation in training.expenditureAssessment.limitations" :key="limitation">{{ limitation }}</li></ul></details>
                  </article>
                  <form v-if="editingExpenditureSessionId === training.id && expenditureForms[training.id]" class="history-correction" @submit.prevent="saveExpenditure(training)">
                    <label class="wide-field"><span>与本次训练完全相符的官方活动模式</span><select v-model="expenditureForms[training.id]!.activityCode"><option value="">没有完全相符的模式</option><option v-for="activity in expenditureActivities" :key="activity.code" :value="activity.code">{{ activity.label }} · {{ activity.description }} · {{ activity.met }} MET</option></select></label>
                    <label v-if="expenditureForms[training.id]!.activityCode !== ''"><span>有效训练时长（分钟）</span><input v-model="expenditureForms[training.id]!.durationMinutes" type="number" min="1" max="720" required /></label>
                    <p class="wide-field data-note">预填的是开始到结束的墙钟时长，请改成真正符合所选动作模式的有效时长。动作、RM、组数、次数或休息不同，就选择“没有完全相符”。</p>
                    <div class="form-actions wide-field"><button class="action-button action-button--primary" type="submit" :disabled="saving">保存估算</button><button class="text-action" type="button" @click="editingExpenditureSessionId = null">取消</button></div>
                  </form>
                  <form v-if="editingSessionId === training.id && sessionForms[training.id]" class="history-correction" @submit.prevent="saveSessionCorrection(training)">
                    <label><span>归属日期</span><input v-model="sessionForms[training.id]!.localDate" type="date" required /></label>
                    <label><span>整次训练备注（可选）</span><input v-model="sessionForms[training.id]!.note" maxlength="1000" /></label>
                    <p class="wide-field data-note">这里只修正历史归属日和备注；原开始时间 {{ new Date(training.startedAt).toLocaleString('zh-CN') }} 与当时时区 {{ training.timeZone }} 会继续保留。</p>
                    <div class="form-actions wide-field"><button class="action-button action-button--primary" type="submit" :disabled="saving">保存日期修正</button><button class="text-action" type="button" @click="editingSessionId = null">取消</button></div>
                  </form>
                  <details v-if="(sessionRevisions[training.id]?.length ?? 0) > 0" class="history-revisions">
                    <summary>查看日期与备注的之前版本</summary>
                    <ol><li v-for="revision in sessionRevisions[training.id]" :key="revision.id"><span>{{ revision.localDate }} · {{ revision.note ?? '当时没有备注' }}</span><time :datetime="revision.createdAt">修订前版本 · 当时时区 {{ revision.timeZone }}</time></li></ol>
                  </details>
                  <article v-for="item in training.items" :key="item.id" class="history-item">
                    <div class="history-item__heading">
                      <div><strong>{{ displayedExercise(item) }}</strong><small>{{ describeItem(item) }}</small></div>
                      <button class="text-action" type="button" :aria-label="`修正${displayedExercise(item)}`" @click="openCorrection(item)">修正</button>
                    </div>
                    <p v-if="item.actualNote">{{ item.actualNote }}</p>
                    <details v-if="revisionsFor(training.id, item.id).length > 0" class="history-revisions">
                      <summary>查看之前的 {{ revisionsFor(training.id, item.id).length }} 个版本</summary>
                      <ol><li v-for="revision in revisionsFor(training.id, item.id)" :key="revision.id"><span>{{ revisionDescription(revision) }}</span><time :datetime="revision.createdAt">修订前版本 · 记录于 {{ new Date(revision.createdAt).toLocaleString('zh-CN') }}</time></li></ol>
                    </details>
                    <form v-if="editingItemId === item.id && correctionForms[item.id]" class="history-correction" @submit.prevent="saveCorrection(training, item)">
                      <label><span>结果</span><select v-model="correctionForms[item.id]!.status"><option value="completed">已完成</option><option value="skipped">已跳过</option></select></label>
                      <label v-if="correctionForms[item.id]!.status === 'completed'" class="wide-field"><span>实际动作</span><input v-model="correctionForms[item.id]!.performedExerciseName" required maxlength="100" /></label>
                      <div v-if="correctionForms[item.id]!.status === 'completed'" class="history-correction__sets wide-field">
                        <div v-for="(set, index) in correctionForms[item.id]!.sets" :key="index" class="set-row">
                          <strong>第 {{ index + 1 }} 组</strong>
                          <label><span>次数</span><input v-model="set.reps" type="number" min="0" /></label>
                          <label><span>重量 kg</span><input v-model="set.weightKg" inputmode="decimal" /></label>
                          <label><span>时长（秒）</span><input v-model="set.durationSeconds" type="number" min="0" /></label>
                          <label><span>距离（米）</span><input v-model="set.distanceMeters" inputmode="decimal" /></label>
                        </div>
                        <button class="text-action" type="button" @click="correctionForms[item.id]!.sets.push({ reps: '', weightKg: '', durationSeconds: '', distanceMeters: '' })">再加一组 →</button>
                      </div>
                      <label class="wide-field"><span>{{ correctionForms[item.id]!.status === 'skipped' ? '跳过原因（可选）' : '实际备注（可选）' }}</span><input v-model="correctionForms[item.id]!.actualNote" maxlength="1000" /></label>
                      <div class="form-actions wide-field"><button class="action-button action-button--primary" type="submit" :disabled="saving">保存修正</button><button class="text-action" type="button" @click="editingItemId = null">取消</button></div>
                    </form>
                  </article>
                  <form v-if="addingExtraSessionId === training.id && extraForms[training.id]" class="history-correction history-extra-correction" @submit.prevent="saveHistoricalExtra(training)">
                    <label class="wide-field"><span>遗漏的实际动作</span><input v-model="extraForms[training.id]!.exerciseName" required maxlength="100" /></label>
                    <div class="history-correction__sets wide-field">
                      <div v-for="(set, index) in extraForms[training.id]!.sets" :key="index" class="set-row">
                        <strong>第 {{ index + 1 }} 组</strong>
                        <label><span>次数</span><input v-model="set.reps" type="number" min="0" /></label>
                        <label><span>重量 kg</span><input v-model="set.weightKg" inputmode="decimal" /></label>
                        <label><span>时长（秒）</span><input v-model="set.durationSeconds" type="number" min="0" /></label>
                        <label><span>距离（米）</span><input v-model="set.distanceMeters" inputmode="decimal" /></label>
                      </div>
                      <button class="text-action" type="button" @click="extraForms[training.id]!.sets.push({ reps: '', weightKg: '', durationSeconds: '', distanceMeters: '' })">再加一组 →</button>
                    </div>
                    <label class="wide-field"><span>实际备注（可选）</span><input v-model="extraForms[training.id]!.actualNote" maxlength="1000" /></label>
                    <div class="form-actions wide-field"><button class="action-button action-button--primary" type="submit" :disabled="saving">保存补记动作</button><button class="text-action" type="button" @click="addingExtraSessionId = null">取消</button></div>
                  </form>
                </div>
              </section>
              <section v-if="day.meals.length" class="history-session history-nutrition-summary">
                <div class="history-session__heading"><div><strong>饮食 · {{ day.meals.length }} 顿</strong><small>{{ mealEnergy(day.meals) }}</small></div><button class="text-action" type="button" @click="openNutritionDate(day.date)">查看或修正</button></div>
                <p>{{ day.meals.map((meal) => meal.name ?? '未命名餐次').join('、') }}</p>
                <small>仅汇总已经填写的数值；未知营养不会按 0 计算。</small>
              </section>
            </div>
            <span class="status-chip">{{ day.sessions.length }} 次训练 · {{ day.meals.length }} 顿</span>
          </article>
        </section>
  </AppShell>
</template>
