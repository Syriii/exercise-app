<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import { ApiError } from "../api/client";
import { nutritionApi, type NutritionDaySummary, type NutritionValueSummary } from "../api/nutrition";
import { planningApi, type DailyPlanningReference } from "../api/planning";
import { reminderApi, type MeasurementReminderStatus, type NutritionReminderStatus, type TrainingReminderStatus } from "../api/reminders";
import { trainingApi, type TrainingSchedule, type TrainingSession } from "../api/training";
import AppShell from "../app/AppShell.vue";
import { type AppSection } from "../app/modules";

const router = useRouter();
const schedules = ref<TrainingSchedule[]>([]);
const sessions = ref<TrainingSession[]>([]);
const loading = ref(true);
const saving = ref(false);
const errorMessage = ref("");
const reminderStatus = ref<TrainingReminderStatus | null>(null);
const nutritionReminderStatus = ref<NutritionReminderStatus | null>(null);
const measurementReminderStatus = ref<MeasurementReminderStatus | null>(null);
const dailyReference = ref<DailyPlanningReference | null>(null);
const nutritionSummary = ref<NutritionDaySummary | null>(null);
let browserNotificationShown = false;

const today = localDate(new Date());
const plannedSchedules = computed(() => schedules.value.filter((schedule) => schedule.status === "scheduled"));
const activeSession = computed(() => sessions.value.find((session) => session.status === "in_progress") ?? null);
const remainingItems = computed(
  () => activeSession.value?.items.filter((item) => item.origin === "planned" && item.status === "pending") ?? [],
);
const completedSessions = computed(() => sessions.value.filter((session) => session.status !== "in_progress"));

function localDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function displayDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "short" }).format(
    new Date(`${value}T12:00:00`),
  );
}

function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function remainingText(value: NutritionValueSummary | undefined, unit: string): string {
  if (value?.remaining === null || value?.remaining === undefined) return "—";
  return value.remaining >= 0 ? `${value.remaining} ${unit}` : `超出 ${Math.abs(value.remaining)} ${unit}`;
}

function recordedText(value: NutritionValueSummary | undefined, unit: string): string {
  if (value?.recorded === null || value?.recorded === undefined) return "尚无已知摄入";
  return `已记录 ${value.recorded} ${unit}${value.complete ? "" : "，仍有未知值"}`;
}

function maybeShowBrowserNotification(status: TrainingReminderStatus) {
  if (status.state !== "due" || browserNotificationShown || typeof Notification === "undefined" || Notification.permission !== "granted") return;
  browserNotificationShown = true;
  new Notification("今天有训练安排", { body: `还有 ${status.scheduleCount} 项安排未开始。` });
}

function maybeShowOtherBrowserNotifications(nutrition: NutritionReminderStatus, measurement: MeasurementReminderStatus) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  if (nutrition.state === "due") new Notification("看看今天的饮食记录", { body: nutrition.reason === "no_meals" ? "今天还没有餐食记录。" : nutrition.reason === "incomplete" ? "已有记录中仍有未知或可能漏记的内容。" : "可以看看今天还可以吃多少。" });
  if (measurement.state === "due") new Notification("可以更新身体测量", { body: measurement.latestMeasurementDate === null ? "还没有体重记录。" : `当前仍采用 ${measurement.latestMeasurementDate} 的记录。` });
}

function sessionTitle(training: TrainingSession): string {
  if (training.sourceScheduleTitle !== null) return training.sourceScheduleTitle;
  if (training.sourceProgramName !== null) {
    return `${training.sourceProgramName} · 第 ${training.sourceWeekNumber} 周 · ${training.sourceTrainingDayName}`;
  }
  return training.sourceTemplateName ?? "空白训练";
}

function openSection(section: AppSection) {
  void router.push({ name: section });
}

function reportError(error: unknown) {
  console.error("Today operation failed", error);
  errorMessage.value = error instanceof ApiError ? error.message : "暂时读取不了今天的内容，请稍后再试";
}

async function load() {
  loading.value = true;
  errorMessage.value = "";
  const results = await Promise.allSettled([
      trainingApi.listSchedules(today, today),
      trainingApi.listSessions(today, today),
      reminderApi.getTrainingStatus(today, browserTimeZone()),
      reminderApi.getNutritionStatus(today, browserTimeZone()),
      reminderApi.getMeasurementStatus(today, browserTimeZone()),
      planningApi.getDailyReference(today, browserTimeZone()),
      nutritionApi.getDaySummary(today, browserTimeZone()),
  ] as const);
  const [scheduleResult, sessionResult, trainingReminderResult, nutritionReminderResult, measurementReminderResult, referenceResult, summaryResult] = results;

  if (scheduleResult.status === "fulfilled") schedules.value = scheduleResult.value;
  if (sessionResult.status === "fulfilled") sessions.value = sessionResult.value;
  if (trainingReminderResult.status === "fulfilled") {
    reminderStatus.value = trainingReminderResult.value;
    maybeShowBrowserNotification(trainingReminderResult.value);
  }
  if (nutritionReminderResult.status === "fulfilled") nutritionReminderStatus.value = nutritionReminderResult.value;
  if (measurementReminderResult.status === "fulfilled") measurementReminderStatus.value = measurementReminderResult.value;
  if (nutritionReminderResult.status === "fulfilled" && measurementReminderResult.status === "fulfilled") {
    maybeShowOtherBrowserNotifications(nutritionReminderResult.value, measurementReminderResult.value);
  }
  if (referenceResult.status === "fulfilled") dailyReference.value = referenceResult.value;
  if (summaryResult.status === "fulfilled") nutritionSummary.value = summaryResult.value;

  const failed = results.find((result) => result.status === "rejected");
  if (failed?.status === "rejected") {
    console.error("Today page loaded partially", failed.reason);
    const detail = failed.reason instanceof ApiError ? failed.reason.message : "部分内容暂时读取不了";
    errorMessage.value = `${detail}；其他可用内容已保留，可以稍后重试。`;
  }
  loading.value = false;
}

async function snoozeReminder() {
  saving.value = true;
  try {
    await reminderApi.snoozeTraining(today, 60);
    reminderStatus.value = await reminderApi.getTrainingStatus(today, browserTimeZone());
  } catch (error) {
    reportError(error);
  } finally {
    saving.value = false;
  }
}

async function dismissReminder() {
  saving.value = true;
  try {
    await reminderApi.dismissTraining(today);
    reminderStatus.value = await reminderApi.getTrainingStatus(today, browserTimeZone());
  } catch (error) {
    reportError(error);
  } finally {
    saving.value = false;
  }
}

async function snoozeNutritionReminder() { saving.value = true; try { await reminderApi.snoozeNutrition(today, 60); nutritionReminderStatus.value = await reminderApi.getNutritionStatus(today, browserTimeZone()); } catch (error) { reportError(error); } finally { saving.value = false; } }
async function dismissNutritionReminder() { saving.value = true; try { await reminderApi.dismissNutrition(today); nutritionReminderStatus.value = await reminderApi.getNutritionStatus(today, browserTimeZone()); } catch (error) { reportError(error); } finally { saving.value = false; } }
async function snoozeMeasurementReminder() { saving.value = true; try { await reminderApi.snoozeMeasurement(today, 1440); measurementReminderStatus.value = await reminderApi.getMeasurementStatus(today, browserTimeZone()); } catch (error) { reportError(error); } finally { saving.value = false; } }
async function dismissMeasurementReminder() { saving.value = true; try { await reminderApi.dismissMeasurement(today); measurementReminderStatus.value = await reminderApi.getMeasurementStatus(today, browserTimeZone()); } catch (error) { reportError(error); } finally { saving.value = false; } }

async function startSchedule(schedule: TrainingSchedule) {
  saving.value = true;
  errorMessage.value = "";
  try {
    await trainingApi.startScheduledSession(schedule.id);
    await router.push({ name: "training" });
  } catch (error) {
    reportError(error);
  } finally {
    saving.value = false;
  }
}

async function cancelSchedule(schedule: TrainingSchedule) {
  saving.value = true;
  errorMessage.value = "";
  try {
    await trainingApi.cancelSchedule(schedule.id, schedule.revision);
    await load();
  } catch (error) {
    reportError(error);
  } finally {
    saving.value = false;
  }
}

onMounted(() => void load());
</script>

<template>
  <AppShell page-class="today-page" rail-note="今天只显示已经安排或开始的训练。">
        <header class="view-header">
          <div><p class="date-line">{{ displayDate(today) }} · 今天</p><h1>今天</h1><p>安排会放在这里；没选的方案不会算作今天没完成。</p></div>
          <button class="action-button" type="button" @click="openSection('training')">安排或开始训练</button>
        </header>

        <p v-if="errorMessage" class="form-error" role="alert">{{ errorMessage }}</p>
        <section v-if="loading" class="work-panel training-empty"><strong>正在读取今天的内容…</strong></section>

        <div v-else class="view-stack">
          <section v-if="reminderStatus?.state === 'due'" class="work-panel reminder-card" aria-labelledby="training-reminder-title">
            <div><p class="date-line">训练提醒</p><h2 id="training-reminder-title">今天有 {{ reminderStatus.scheduleCount }} 项训练安排还没开始</h2><p>现在不方便也没关系。提醒只负责提示，不会改变计划或记录。</p></div>
            <div class="form-actions"><button class="action-button action-button--primary" type="button" @click="openSection('training')">查看训练</button><button class="text-action" type="button" :disabled="saving" @click="snoozeReminder">一小时后再提醒</button><button class="text-action" type="button" :disabled="saving" @click="dismissReminder">今天不再提醒</button></div>
          </section>
          <section v-else-if="reminderStatus?.state === 'snoozed'" class="work-panel reminder-card reminder-card--quiet" aria-label="已暂缓的训练提醒"><p>训练提醒已暂缓到 {{ reminderStatus.nextAt === null ? '稍后' : new Date(reminderStatus.nextAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }}。训练安排没有改变。</p></section>
          <section v-if="nutritionReminderStatus?.state === 'due'" class="work-panel reminder-card" aria-labelledby="nutrition-reminder-title">
            <div><p class="date-line">饮食提醒</p><h2 id="nutrition-reminder-title">{{ nutritionReminderStatus.reason === 'no_meals' ? '今天还没有记餐' : nutritionReminderStatus.reason === 'incomplete' ? '今天的记录可能还不完整' : nutritionReminderStatus.reason === 'over_target' ? '当前已记录摄入高于部分参考' : '看看今天还可以吃多少' }}</h2><p>{{ nutritionReminderStatus.reason === 'incomplete' ? '未知和没记录的内容没有按 0 计算，因此这里只提醒你检查。' : '提醒只反映饮食记录，不会因今天练了多少而改写参考。' }}</p></div>
            <div class="form-actions"><button class="action-button action-button--primary" type="button" @click="openSection('nutrition')">查看饮食</button><button class="text-action" type="button" :disabled="saving" @click="snoozeNutritionReminder">一小时后再提醒</button><button class="text-action" type="button" :disabled="saving" @click="dismissNutritionReminder">今天不再提醒</button></div>
          </section>
          <section v-else-if="nutritionReminderStatus?.state === 'snoozed'" class="work-panel reminder-card reminder-card--quiet" aria-label="已暂缓的饮食提醒"><p>饮食提醒已经暂缓；当天参考和记录没有改变。</p></section>
          <section v-if="measurementReminderStatus?.state === 'due'" class="work-panel reminder-card" aria-labelledby="measurement-reminder-title">
            <div><p class="date-line">身体测量提醒</p><h2 id="measurement-reminder-title">{{ measurementReminderStatus.latestMeasurementDate === null ? '还没有体重记录' : '可以更新一次体重' }}</h2><p>{{ measurementReminderStatus.latestMeasurementDate === null ? '没有记录时系统不会猜体重。' : `当前仍采用 ${measurementReminderStatus.latestMeasurementDate} 的有效记录；现在不更新也不影响使用。` }}</p></div>
            <div class="form-actions"><button class="action-button action-button--primary" type="button" @click="openSection('settings')">去记录</button><button class="text-action" type="button" :disabled="saving" @click="snoozeMeasurementReminder">明天再提醒</button><button class="text-action" type="button" :disabled="saving" @click="dismissMeasurementReminder">本次不再提醒</button></div>
          </section>
          <section v-else-if="measurementReminderStatus?.state === 'snoozed'" class="work-panel reminder-card reminder-card--quiet" aria-label="已暂缓的身体测量提醒"><p>身体测量提醒已暂缓；系统继续采用最近一次有效记录。</p></section>
          <section class="balance-panel" aria-labelledby="today-food-title">
            <div class="panel-heading"><div><h2 id="today-food-title">今天还可以吃</h2><p>系统参考减去已经记录的摄入；没记录的内容不会算作 0。</p></div><button class="text-action" type="button" @click="openSection('nutrition')">去记一顿 →</button></div>
            <dl class="metric-list">
              <div><dt>能量</dt><dd>{{ remainingText(nutritionSummary?.energyKcal, 'kcal') }}</dd><span>{{ recordedText(nutritionSummary?.energyKcal, 'kcal') }}</span></div>
              <div><dt>蛋白质</dt><dd>{{ remainingText(nutritionSummary?.proteinGrams, 'g') }}</dd><span>{{ recordedText(nutritionSummary?.proteinGrams, 'g') }}</span></div>
              <div><dt>碳水化合物</dt><dd>{{ remainingText(nutritionSummary?.carbohydrateGrams, 'g') }}</dd><span>{{ recordedText(nutritionSummary?.carbohydrateGrams, 'g') }}</span></div>
              <div><dt>脂肪</dt><dd>{{ remainingText(nutritionSummary?.fatGrams, 'g') }}</dd><span>{{ recordedText(nutritionSummary?.fatGrams, 'g') }}</span></div>
            </dl>
            <p class="data-note">{{ nutritionSummary?.coverageConfirmed ? '你已确认今天的餐食记录完整。' : '全天覆盖仍未知；数值只代表已经录入的部分。' }} {{ dailyReference?.result.measurementDate ? `采用 ${dailyReference.result.measurementDate} 的体重。` : '' }} 系统参考方法：{{ dailyReference?.methodVersion ?? '尚未生成' }}。</p>
            <p class="data-note">这是群体方程形成的规划参考，不是个人代谢测量；已吃多少会在饮食记录接入后单独扣减。</p>
            <button v-if="dailyReference?.result.status !== 'ready'" class="text-action" type="button" @click="openSection('settings')">补充计算资料 →</button>
          </section>

          <section class="work-panel today-training-panel" aria-labelledby="today-training-title">
            <div class="panel-heading">
              <div><h2 id="today-training-title">今天还要练</h2><p v-if="activeSession">{{ sessionTitle(activeSession) }}</p></div>
              <span class="status-chip" :data-tone="activeSession && remainingItems.length === 0 ? 'accent' : undefined">
                {{ activeSession ? (remainingItems.length === 0 ? '计划动作已处理' : `还剩 ${remainingItems.length} 项`) : `${plannedSchedules.length} 个安排` }}
              </span>
            </div>

            <template v-if="activeSession">
              <ul v-if="remainingItems.length > 0" class="plain-list today-training-list"><li v-for="item in remainingItems" :key="item.id"><strong>{{ item.exerciseName }}</strong><span>待完成</span></li></ul>
              <p v-else>这次训练没有待完成的计划动作；额外动作仍可在训练页补充。</p>
              <button class="action-button action-button--primary" type="button" @click="openSection('training')">继续这次训练</button>
            </template>

            <template v-else-if="plannedSchedules.length > 0">
              <article v-for="schedule in plannedSchedules" :key="schedule.id" class="today-schedule-card">
                <div><strong>{{ schedule.title }}</strong><p>{{ schedule.note ?? (schedule.sourceProgramName ? `${schedule.sourceProgramName} · 第 ${schedule.sourceWeekNumber} 周` : schedule.sourceTemplateName ?? '训练主题') }}</p></div>
                <div class="form-actions">
                  <button class="action-button action-button--primary" type="button" :disabled="saving" @click="startSchedule(schedule)">开始训练</button>
                  <button class="text-action" type="button" :disabled="saving" @click="cancelSchedule(schedule)">取消今天这项</button>
                </div>
              </article>
            </template>

            <template v-else>
              <strong>今天还没有安排训练</strong>
              <p>这不代表你必须休息，也不会把方案库里的内容算成未完成。</p>
              <button class="text-action" type="button" @click="openSection('training')">选一个方案或直接开始 →</button>
            </template>
          </section>

          <section v-if="completedSessions.length > 0" class="work-panel" aria-labelledby="today-finished-title">
            <div class="panel-heading"><div><h2 id="today-finished-title">今天已经记录</h2></div><span class="status-chip">{{ completedSessions.length }} 次训练</span></div>
            <ul class="plain-list today-training-list"><li v-for="training in completedSessions" :key="training.id"><strong>{{ sessionTitle(training) }}</strong><span>{{ training.status === 'completed' ? '已完成' : '提前结束' }}</span></li></ul>
            <button class="text-action" type="button" @click="openSection('history')">查看历史 →</button>
          </section>
        </div>
  </AppShell>
</template>
