<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";

import { ApiError } from "../api/client";
import {
  planningApi,
  type BodyMeasurement,
  type MacroPreference,
  type PalCategory,
  type PlanningSexCategory,
  type WeightStrategy,
} from "../api/planning";
import { portabilityApi, type PortabilityTask } from "../api/portability";
import { reminderApi } from "../api/reminders";
import { navigationItems, type AppSection } from "../app/modules";
import { useSessionStore } from "../stores/session";
import {
  buildProblemReport,
  clearDiagnosticEvents,
  copyText,
  downloadProblemReport,
} from "../support/diagnostics";

const router = useRouter();
const sessionStore = useSessionStore();
const loading = ref(true);
const saving = ref(false);
const profileSaving = ref(false);
const strategySaving = ref(false);
const measurementSaving = ref(false);
const nutritionReminderSaving = ref(false);
const measurementReminderSaving = ref(false);
const exportSaving = ref(false);
const deletionSaving = ref(false);
const revision = ref(0);
const nutritionReminderRevision = ref(0);
const measurementReminderRevision = ref(0);
const profileRevision = ref(0);
const strategyRevision = ref(0);
const errorMessage = ref("");
const notice = ref("");
const browserNotification = ref<NotificationPermission | "unsupported">(
  typeof Notification === "undefined" ? "unsupported" : Notification.permission,
);
const form = reactive({ enabled: false, localTime: "18:00", timeZone: browserTimeZone() });
const nutritionReminderForm = reactive({ enabled: false, localTime: "20:00", timeZone: browserTimeZone() });
const measurementReminderForm = reactive({ enabled: true, intervalDays: 7, localTime: "09:00", timeZone: browserTimeZone() });
const profileForm = reactive({
  birthDate: null as string | null,
  sexCategory: null as PlanningSexCategory | null,
  heightCm: null as number | null,
  pregnantOrBreastfeeding: false,
  medicalNutritionCondition: false,
  specialBodyComposition: false,
  palCategory: null as PalCategory | null,
});
const strategyForm = reactive({
  weightStrategy: "maintain" as WeightStrategy,
  macroPreference: "balanced" as MacroPreference,
  regularExercise: false,
  trainingIntent: null as string | null,
  targetWeightKg: null as number | null,
  targetDate: null as string | null,
});
const measurements = ref<BodyMeasurement[]>([]);
const portabilityTasks = ref<PortabilityTask[]>([]);
const deletionForm = reactive({ confirmationUsername: "", password: "", understood: false });
const problemDescription = ref("");
const problemReport = ref("");
const problemReportGenerating = ref(false);
const problemReportNotice = ref("");
let portabilityTimer: number | undefined;
const editingMeasurementId = ref<string | null>(null);
const measurementRevision = ref(0);
const measurementForm = reactive({ localDate: localDate(new Date()), weightKg: null as number | null, waistCm: null as number | null, note: null as string | null });
const adminVisible = computed(() => sessionStore.account?.role === "admin");
const macroOptions = computed(() => [
  { value: "balanced" as const, label: "均衡分配", description: "采用适用官方范围内的常规分配。" },
  { value: "high_protein" as const, label: "偏高蛋白", description: "仅在健康规律运动且范围适用时使用。" },
  ...(strategyForm.weightStrategy === "lose" ? [{ value: "lower_fat" as const, label: "减脂期较低脂肪", description: "脂肪取官方范围下沿，其他宏量仍需同时成立。" }] : []),
]);

function localDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function openSection(section: AppSection) {
  void router.push({ name: section });
}

async function load() {
  loading.value = true;
  errorMessage.value = "";
  try {
    const [settings, nutritionSettings, measurementSettings, profile, strategy, loadedMeasurements, loadedPortabilityTasks] = await Promise.all([
      reminderApi.getTrainingSettings(browserTimeZone()),
      reminderApi.getNutritionSettings(browserTimeZone()),
      reminderApi.getMeasurementSettings(browserTimeZone()),
      planningApi.getProfile(),
      planningApi.getStrategy(),
      planningApi.listMeasurements(),
      portabilityApi.listTasks(),
    ]);
    form.enabled = settings.enabled;
    form.localTime = settings.localTime;
    form.timeZone = settings.timeZone;
    revision.value = settings.revision;
    Object.assign(nutritionReminderForm, { enabled: nutritionSettings.enabled, localTime: nutritionSettings.localTime, timeZone: nutritionSettings.timeZone });
    nutritionReminderRevision.value = nutritionSettings.revision;
    Object.assign(measurementReminderForm, { enabled: measurementSettings.enabled, intervalDays: measurementSettings.intervalDays, localTime: measurementSettings.localTime, timeZone: measurementSettings.timeZone });
    measurementReminderRevision.value = measurementSettings.revision;
    Object.assign(profileForm, {
      birthDate: profile.birthDate,
      sexCategory: profile.sexCategory,
      heightCm: profile.heightCm,
      pregnantOrBreastfeeding: profile.pregnantOrBreastfeeding,
      medicalNutritionCondition: profile.medicalNutritionCondition,
      specialBodyComposition: profile.specialBodyComposition,
      palCategory: profile.palCategory,
    });
    profileRevision.value = profile.revision;
    Object.assign(strategyForm, {
      weightStrategy: strategy.weightStrategy,
      macroPreference: strategy.macroPreference,
      regularExercise: strategy.regularExercise,
      trainingIntent: strategy.trainingIntent,
      targetWeightKg: strategy.targetWeightKg,
      targetDate: strategy.targetDate,
    });
    strategyRevision.value = strategy.revision;
    measurements.value = loadedMeasurements;
    portabilityTasks.value = loadedPortabilityTasks;
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : "暂时读取不了设置";
  } finally {
    loading.value = false;
  }
}

async function saveProfile() {
  profileSaving.value = true;
  errorMessage.value = "";
  try {
    const saved = await planningApi.updateProfile(profileRevision.value, profileForm);
    profileRevision.value = saved.revision;
    notice.value = "个人档案已保存；新的资料只影响今天及以后生成的参考。";
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : "暂时保存不了个人档案";
  } finally {
    profileSaving.value = false;
  }
}

function normalizeMacroPreference() {
  if (strategyForm.weightStrategy !== "lose" && strategyForm.macroPreference === "lower_fat") strategyForm.macroPreference = "balanced";
}

async function saveStrategy() {
  normalizeMacroPreference();
  strategySaving.value = true;
  errorMessage.value = "";
  try {
    const saved = await planningApi.updateStrategy(strategyRevision.value, strategyForm);
    strategyRevision.value = saved.revision;
    notice.value = "目标策略已保存；系统会重新生成今天的营养参考。";
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : "暂时保存不了目标策略";
  } finally {
    strategySaving.value = false;
  }
}

function editMeasurement(measurement: BodyMeasurement) {
  editingMeasurementId.value = measurement.id;
  measurementRevision.value = measurement.revision;
  measurementForm.localDate = measurement.localDate;
  measurementForm.weightKg = measurement.weightKg;
  measurementForm.waistCm = measurement.waistCm;
  measurementForm.note = measurement.note;
}

function resetMeasurementForm() {
  editingMeasurementId.value = null;
  measurementRevision.value = 0;
  Object.assign(measurementForm, { localDate: localDate(new Date()), weightKg: null, waistCm: null, note: null });
}

async function saveMeasurement() {
  if (measurementForm.weightKg === null) return;
  measurementSaving.value = true;
  errorMessage.value = "";
  const input = {
    measuredAt: editingMeasurementId.value === null ? new Date().toISOString() : new Date(`${measurementForm.localDate}T12:00:00`).toISOString(),
    localDate: measurementForm.localDate,
    timeZone: browserTimeZone(),
    weightKg: measurementForm.weightKg,
    waistCm: measurementForm.waistCm,
    note: measurementForm.note,
  };
  try {
    if (editingMeasurementId.value === null) await planningApi.createMeasurement(input);
    else await planningApi.updateMeasurement(editingMeasurementId.value, measurementRevision.value, input);
    measurements.value = await planningApi.listMeasurements();
    notice.value = editingMeasurementId.value === null ? "身体测量已记录。" : "误录的身体测量已修正，旧值仍可追溯。";
    resetMeasurementForm();
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : "暂时保存不了身体测量";
  } finally {
    measurementSaving.value = false;
  }
}

async function save() {
  saving.value = true;
  errorMessage.value = "";
  notice.value = "";
  try {
    const settings = await reminderApi.updateTrainingSettings(revision.value, form);
    revision.value = settings.revision;
    notice.value = settings.enabled ? `训练提醒已开启，将在有当日安排时于 ${settings.localTime} 提示` : "训练提醒已关闭";
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : "暂时保存不了设置";
  } finally {
    saving.value = false;
  }
}

async function saveNutritionReminder() {
  nutritionReminderSaving.value = true; errorMessage.value = "";
  try { const saved = await reminderApi.updateNutritionSettings(nutritionReminderRevision.value, nutritionReminderForm); nutritionReminderRevision.value = saved.revision; notice.value = saved.enabled ? `饮食提醒已开启，将在 ${saved.localTime} 根据当天记录提示` : "饮食提醒已关闭"; }
  catch (error) { errorMessage.value = error instanceof ApiError ? error.message : "暂时保存不了饮食提醒"; }
  finally { nutritionReminderSaving.value = false; }
}

async function saveMeasurementReminder() {
  measurementReminderSaving.value = true; errorMessage.value = "";
  try { const saved = await reminderApi.updateMeasurementSettings(measurementReminderRevision.value, measurementReminderForm); measurementReminderRevision.value = saved.revision; notice.value = saved.enabled ? `身体测量提醒已开启，默认每 ${saved.intervalDays} 天检查一次` : "身体测量提醒已关闭"; }
  catch (error) { errorMessage.value = error instanceof ApiError ? error.message : "暂时保存不了身体测量提醒"; }
  finally { measurementReminderSaving.value = false; }
}

async function refreshPortabilityTasks() {
  if (!portabilityTasks.value.some((task) => task.status === "pending" || task.status === "running")) return;
  try { portabilityTasks.value = await portabilityApi.listTasks(); } catch { /* A manual reload will surface persistent failures. */ }
}

async function requestExport() {
  exportSaving.value = true; errorMessage.value = "";
  try { const task = await portabilityApi.requestExport(); portabilityTasks.value = [task, ...portabilityTasks.value]; notice.value = "数据导出已在后台准备；完成后可在这里下载"; }
  catch (error) { errorMessage.value = error instanceof ApiError ? error.message : "暂时无法开始导出"; }
  finally { exportSaving.value = false; }
}

async function requestAccountDeletion() {
  if (!deletionForm.understood) { errorMessage.value = "请先确认你理解账号删除的范围"; return; }
  deletionSaving.value = true; errorMessage.value = "";
  try { await portabilityApi.requestAccountDeletion(deletionForm.confirmationUsername, deletionForm.password); sessionStore.clearLocalSession(); await router.replace({ name: "login", query: { accountDeletion: "requested" } }); }
  catch (error) { errorMessage.value = error instanceof ApiError ? error.message : "暂时无法提交账号删除"; }
  finally { deletionSaving.value = false; }
}

async function requestBrowserNotification() {
  if (typeof Notification === "undefined") return;
  browserNotification.value = await Notification.requestPermission();
}

async function generateProblemReport() {
  problemReportGenerating.value = true;
  problemReportNotice.value = "";
  try {
    problemReport.value = await buildProblemReport(problemDescription.value);
    problemReportNotice.value = "报告已生成。你可以先检查内容，再复制到问答中或下载为文件。";
  } finally {
    problemReportGenerating.value = false;
  }
}

async function copyProblemReport() {
  if (problemReport.value.length === 0) return;
  problemReportNotice.value = await copyText(problemReport.value)
    ? "问题报告已复制，可以直接粘贴到问答中。"
    : "浏览器没有允许自动复制，请在下方报告框中全选并复制。";
}

function downloadCurrentProblemReport() {
  if (problemReport.value.length === 0) return;
  downloadProblemReport(problemReport.value);
  problemReportNotice.value = "问题报告已下载为文本文件。";
}

function clearProblemDiagnostics() {
  clearDiagnosticEvents();
  problemReport.value = "";
  problemReportNotice.value = "近期前端日志已清空。";
}

onMounted(() => { void load(); portabilityTimer = window.setInterval(() => void refreshPortabilityTasks(), 2_000); });
onBeforeUnmount(() => { if (portabilityTimer !== undefined) window.clearInterval(portabilityTimer); });
</script>

<template>
  <div class="prototype-shell settings-page">
    <aside class="desktop-rail" aria-label="主要导航">
      <div class="brand-block"><span class="brand-mark" aria-hidden="true">EA</span><div><strong>Exercise App</strong><small>训练与饮食记录</small></div></div>
      <nav class="rail-nav"><button v-for="item in navigationItems" :key="item.id" class="nav-button" :class="{ 'is-active': item.id === 'settings' }" type="button" :aria-current="item.id === 'settings' ? 'page' : undefined" @click="openSection(item.id)"><span class="nav-button__short" aria-hidden="true">{{ item.shortLabel }}</span><span><strong>{{ item.label }}</strong><small>{{ item.description }}</small></span></button></nav>
      <p class="rail-note">提醒可以关闭，忽略也不会改变记录。</p>
    </aside>
    <div class="app-column">
      <header class="mobile-header"><strong class="mobile-brand">EA / 设置</strong><span>{{ sessionStore.account?.username }}</span></header>
      <main class="app-main">
        <header class="view-header"><div><p class="date-line">设置</p><h1>资料、提醒和数据</h1><p>每类提醒单独管理；训练提醒不会代替饮食提醒。</p></div></header>
        <p v-if="errorMessage" class="form-error" role="alert">{{ errorMessage }}</p>
        <p v-if="notice" class="training-notice" role="status">{{ notice }}</p>
        <section v-if="loading" class="work-panel training-empty"><strong>正在读取设置…</strong></section>
        <div v-else class="view-stack">
          <section class="work-panel" aria-labelledby="profile-settings-title">
            <div class="panel-heading"><div><h2 id="profile-settings-title">个人档案</h2><p>只填写公式真正需要的资料；缺少内容只会停止对应计算。</p></div><span class="status-chip">修订 {{ profileRevision }}</span></div>
            <form class="planning-form" @submit.prevent="saveProfile">
              <div class="field-grid">
                <label><span>出生日期</span><input v-model="profileForm.birthDate" type="date" /><small>当前个体公式覆盖 19–64 岁成人。</small></label>
                <label><span>能量公式分类</span><select v-model="profileForm.sexCategory"><option :value="null">暂不填写</option><option value="male">男性方程</option><option value="female">女性方程</option></select><small>仅用于选择官方方程，不作为身份称谓。</small></label>
                <label><span>身高（cm）</span><input v-model.number="profileForm.heightCm" type="number" min="80" max="250" step="0.1" placeholder="例如 175" /></label>
                <label><span>平常活动档位</span><select v-model="profileForm.palCategory"><option :value="null">还不确定</option><option value="inactive">Inactive · 大部分时间坐着</option><option value="low_active">Low active · 有少量日常移动</option><option value="active">Active · 规律移动或训练</option><option value="very_active">Very active · 大量规律活动</option></select><small>要综合工作、通勤和规律训练确认，不能只看某一天。</small></label>
              </div>
              <fieldset class="safety-fieldset"><legend>适用边界</legend>
                <label class="switch-row"><input v-model="profileForm.pregnantOrBreastfeeding" type="checkbox" /><span>当前处于孕期或哺乳期</span></label>
                <label class="switch-row"><input v-model="profileForm.medicalNutritionCondition" type="checkbox" /><span>有需要专业营养处理的疾病或健康状态</span></label>
                <label class="switch-row"><input v-model="profileForm.specialBodyComposition" type="checkbox" /><span>体成分明显特殊，不适合直接按体重计算运动蛋白质</span></label>
              </fieldset>
              <button class="action-button action-button--primary" type="submit" :disabled="profileSaving">{{ profileSaving ? '保存中…' : '保存个人档案' }}</button>
            </form>
          </section>

          <section class="work-panel" aria-labelledby="measurement-settings-title">
            <div class="panel-heading"><div><h2 id="measurement-settings-title">身体测量</h2><p>每次新增一条记录；修正误录不会制造一条假的身体变化。</p></div><span class="status-chip">{{ measurements.length }} 条</span></div>
            <form class="planning-form" @submit.prevent="saveMeasurement">
              <div class="field-grid">
                <label><span>测量日期</span><input v-model="measurementForm.localDate" type="date" required /></label>
                <label><span>体重（kg）</span><input v-model.number="measurementForm.weightKg" type="number" min="20" max="400" step="0.1" required placeholder="例如 70.5" /></label>
                <label><span>腰围（cm，可选）</span><input v-model.number="measurementForm.waistCm" type="number" min="30" max="300" step="0.1" /></label>
                <label><span>备注（可选）</span><input v-model="measurementForm.note" maxlength="500" placeholder="例如晨起空腹" /></label>
              </div>
              <div class="form-actions"><button class="action-button action-button--primary" type="submit" :disabled="measurementSaving">{{ measurementSaving ? '保存中…' : editingMeasurementId ? '保存修正' : '记录这次测量' }}</button><button v-if="editingMeasurementId" class="text-action" type="button" @click="resetMeasurementForm">取消修正</button></div>
            </form>
            <ul v-if="measurements.length" class="measurement-list">
              <li v-for="measurement in measurements" :key="measurement.id"><div><strong>{{ measurement.weightKg }} kg</strong><span>{{ measurement.localDate }}<template v-if="measurement.waistCm !== null"> · 腰围 {{ measurement.waistCm }} cm</template></span><small v-if="measurement.note">{{ measurement.note }}</small></div><button class="text-action" type="button" @click="editMeasurement(measurement)">修正</button></li>
            </ul>
            <p v-else class="data-note">还没有测量记录。未记录时不会猜测体重。</p>
          </section>

          <section class="work-panel" aria-labelledby="strategy-settings-title">
            <div class="panel-heading"><div><h2 id="strategy-settings-title">目标与营养策略</h2><p>你选择方向，系统按有依据的范围计算，不需要手填热量和宏量数字。</p></div><span class="status-chip">修订 {{ strategyRevision }}</span></div>
            <form class="planning-form" @submit.prevent="saveStrategy">
              <fieldset class="strategy-fieldset"><legend>体重策略</legend><div class="strategy-options">
                <label v-for="option in [{ value: 'maintain', label: '维持体重', description: '以维持能量参考为基础。' }, { value: 'lose', label: '减脂', description: '只在国家卫健委适用边界内自动计算。' }, { value: 'gain', label: '增重', description: '暂不使用没有依据的固定热量盈余。' }]" :key="option.value" class="strategy-option" :class="{ 'is-selected': strategyForm.weightStrategy === option.value }"><input v-model="strategyForm.weightStrategy" type="radio" name="weight-strategy" :value="option.value" @change="normalizeMacroPreference" /><span><strong>{{ option.label }}</strong><small>{{ option.description }}</small></span></label>
              </div></fieldset>
              <fieldset class="strategy-fieldset"><legend>宏量分配偏好</legend><div class="strategy-options"><label v-for="option in macroOptions" :key="option.value" class="strategy-option" :class="{ 'is-selected': strategyForm.macroPreference === option.value }"><input v-model="strategyForm.macroPreference" type="radio" name="macro-preference" :value="option.value" /><span><strong>{{ option.label }}</strong><small>{{ option.description }}</small></span></label></div></fieldset>
              <label class="switch-row"><input v-model="strategyForm.regularExercise" type="checkbox" /><span>当前有规律运动（用于判断运动蛋白质范围是否适用）</span></label>
              <div class="field-grid"><label><span>训练或体成分意图（可选）</span><input v-model="strategyForm.trainingIntent" maxlength="500" placeholder="例如增肌、提高力量、改善体态" /></label><template v-if="strategyForm.weightStrategy === 'gain'"><label><span>目标体重（kg，可选）</span><input v-model.number="strategyForm.targetWeightKg" type="number" min="20" max="400" step="0.1" /></label><label><span>目标日期（可选）</span><input v-model="strategyForm.targetDate" type="date" /></label></template></div>
              <button class="action-button action-button--primary" type="submit" :disabled="strategySaving">{{ strategySaving ? '保存中…' : '保存目标策略' }}</button>
            </form>
          </section>

          <section class="work-panel" aria-labelledby="training-reminder-settings-title">
            <div class="panel-heading"><div><h2 id="training-reminder-settings-title">训练提醒</h2><p>只有当天还有未开始的训练安排时，达到设定时间才会提示。</p></div><span class="status-chip">独立提醒</span></div>
            <form class="reminder-form" @submit.prevent="save">
              <label class="switch-row"><input v-model="form.enabled" type="checkbox" /><span>{{ form.enabled ? '已开启' : '已关闭' }}</span></label>
              <label><span>提醒时间</span><input v-model="form.localTime" type="time" required /></label>
              <label><span>时区</span><input v-model="form.timeZone" required maxlength="100" /></label>
              <button class="action-button action-button--primary" type="submit" :disabled="saving">{{ saving ? '保存中…' : '保存训练提醒' }}</button>
            </form>
            <div class="browser-notification-row">
              <div><strong>浏览器通知</strong><p>即使不授权，打开应用时仍会显示应用内提醒。</p></div>
              <button v-if="browserNotification === 'default'" class="action-button" type="button" @click="requestBrowserNotification">允许浏览器通知</button>
              <span v-else class="status-chip">{{ browserNotification === 'granted' ? '已允许' : browserNotification === 'denied' ? '已拒绝' : '不支持' }}</span>
            </div>
          </section>

          <section class="work-panel" aria-labelledby="nutrition-reminder-settings-title">
            <div class="panel-heading"><div><h2 id="nutrition-reminder-settings-title">饮食提醒</h2><p>只看当天饮食记录和剩余情况，不读取训练完成量。</p></div><span class="status-chip">独立提醒</span></div>
            <form class="reminder-form" @submit.prevent="saveNutritionReminder">
              <label class="switch-row"><input v-model="nutritionReminderForm.enabled" type="checkbox" /><span>{{ nutritionReminderForm.enabled ? '已开启' : '已关闭' }}</span></label>
              <label><span>提醒时间</span><input v-model="nutritionReminderForm.localTime" type="time" required /></label>
              <label><span>时区</span><input v-model="nutritionReminderForm.timeZone" required maxlength="100" /></label>
              <button class="action-button action-button--primary" type="submit" :disabled="nutritionReminderSaving">{{ nutritionReminderSaving ? '保存中…' : '保存饮食提醒' }}</button>
            </form>
            <p class="data-note">记录不完整时只提示“可能还有未记录内容”，不会把估算说成确定超标。</p>
          </section>

          <section class="work-panel" aria-labelledby="measurement-reminder-settings-title">
            <div class="panel-heading"><div><h2 id="measurement-reminder-settings-title">身体测量提醒</h2><p>默认每周柔性提醒一次；可以改周期、暂缓或关闭。</p></div><span class="status-chip">独立提醒</span></div>
            <form class="reminder-form" @submit.prevent="saveMeasurementReminder">
              <label class="switch-row"><input v-model="measurementReminderForm.enabled" type="checkbox" /><span>{{ measurementReminderForm.enabled ? '已开启' : '已关闭' }}</span></label>
              <label><span>间隔天数</span><input v-model.number="measurementReminderForm.intervalDays" type="number" min="1" max="365" required /></label>
              <label><span>提醒时间</span><input v-model="measurementReminderForm.localTime" type="time" required /></label>
              <label><span>时区</span><input v-model="measurementReminderForm.timeZone" required maxlength="100" /></label>
              <button class="action-button action-button--primary" type="submit" :disabled="measurementReminderSaving">{{ measurementReminderSaving ? '保存中…' : '保存测量提醒' }}</button>
            </form>
            <p class="data-note">忽略提醒不会阻断计算；系统继续使用最近一次有效体重，并显示它的日期。</p>
          </section>

          <section class="work-panel problem-report-panel" aria-labelledby="problem-report-title">
            <div class="panel-heading"><div><h2 id="problem-report-title">问题报告</h2><p>遇到问题时，把刚才的操作简单写下来，再生成一份可以直接发到问答里的报告。</p></div><span class="status-chip">只在本机生成</span></div>
            <label class="problem-description"><span>发生了什么（可选）</span><textarea v-model="problemDescription" rows="4" maxlength="2000" placeholder="例如：我在饮食页上传照片，进度到 100% 后一直没有出现分析结果。预期是几秒后看到候选营养。不要在这里粘贴密码或 Key。" /></label>
            <div class="form-actions">
              <button class="action-button action-button--primary" type="button" :disabled="problemReportGenerating" @click="generateProblemReport">{{ problemReportGenerating ? '正在检查运行状态…' : '生成问题报告' }}</button>
              <button v-if="problemReport" class="action-button" type="button" @click="copyProblemReport">复制报告</button>
              <button v-if="problemReport" class="action-button" type="button" @click="downloadCurrentProblemReport">下载 .txt</button>
              <button class="text-action" type="button" @click="clearProblemDiagnostics">清空近期日志</button>
            </div>
            <p v-if="problemReportNotice" class="data-note" role="status">{{ problemReportNotice }}</p>
            <label v-if="problemReport" class="problem-report-preview"><span>报告预览</span><textarea :value="problemReport" rows="16" readonly spellcheck="false" @focus="($event.target as HTMLTextAreaElement).select()" /></label>
            <p class="data-note">报告包含页面路径、浏览器环境、服务端健康状态、近期接口结果和未处理错误；自动收集部分不包含密码、Cookie、API Key、照片、请求内容或训练饮食明细，也不会自动上传。问题描述由你填写，分享前仍建议快速看一遍。</p>
          </section>

          <section class="work-panel" aria-labelledby="data-control-title">
            <div class="panel-heading"><div><h2 id="data-control-title">我的数据</h2><p>导出只包含结构化记录和照片生命周期，不包含密码、会话令牌或原图。</p></div><button class="action-button" type="button" :disabled="exportSaving" @click="requestExport">{{ exportSaving ? '正在提交…' : '准备 JSON 导出' }}</button></div>
            <ul v-if="portabilityTasks.filter((task) => task.type === 'data_export').length" class="measurement-list export-task-list">
              <li v-for="task in portabilityTasks.filter((value) => value.type === 'data_export')" :key="task.id"><div><strong>{{ task.status === 'succeeded' ? (task.downloadAvailable ? '导出已完成' : '导出已过期') : task.status === 'failed' ? '导出失败' : task.status === 'running' ? '正在生成导出' : '等待后台处理' }}</strong><span>{{ new Date(task.createdAt).toLocaleString('zh-CN') }}<template v-if="task.expiresAt"> · 保留至 {{ new Date(task.expiresAt).toLocaleString('zh-CN') }}</template></span><small v-if="task.lastErrorCode">错误：{{ task.lastErrorCode }}</small></div><a v-if="task.downloadAvailable" class="text-action" :href="portabilityApi.downloadUrl(task.id)" download>下载 JSON</a></li>
            </ul>
            <p v-else class="data-note">还没有导出记录。导出在后台生成，完成后保留有限时间。</p>
            <form v-if="!adminVisible" class="account-deletion-form" @submit.prevent="requestAccountDeletion">
              <div><strong>删除整个账号</strong><p>这会立即退出所有设备，并在后台删除档案、训练、饮食、分析任务和临时照片。完成后无法恢复；建议先下载导出。</p></div>
              <div class="field-grid"><label><span>输入当前用户名</span><input v-model="deletionForm.confirmationUsername" autocomplete="username" required /></label><label><span>当前密码</span><input v-model="deletionForm.password" type="password" autocomplete="current-password" required /></label></div>
              <label class="checkbox-row"><input v-model="deletionForm.understood" type="checkbox" />我理解这是整个账号的永久删除，不只是退出登录</label>
              <button class="action-button danger-action" type="submit" :disabled="deletionSaving">{{ deletionSaving ? '正在提交删除…' : '永久删除我的账号' }}</button>
            </form>
            <p v-else class="data-note">预置管理员账号不能在应用内删除，避免服务器失去唯一管理入口。</p>
          </section>
          <section class="settings-list" aria-label="后续设置">
            <article v-if="adminVisible"><div><strong>系统管理</strong><p>查看账号和运行状态，不读取其他用户的健康数据。</p></div><button class="text-action" type="button" @click="router.push({ name: 'admin' })">进入系统管理 →</button></article>
          </section>
        </div>
      </main>
      <nav class="mobile-dock" aria-label="主要导航"><button v-for="item in navigationItems" :key="item.id" class="dock-button" :class="{ 'is-active': item.id === 'settings' }" type="button" :aria-current="item.id === 'settings' ? 'page' : undefined" @click="openSection(item.id)"><span aria-hidden="true">{{ item.shortLabel }}</span><strong>{{ item.label }}</strong></button></nav>
    </div>
  </div>
</template>
