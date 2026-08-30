<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";

import { ApiError } from "../api/client";
import AppShell from "../app/AppShell.vue";
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
import { useSessionStore } from "../stores/session";
const route = useRoute();
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
const trainingReminderAvailable = ref(false);
const nutritionReminderAvailable = ref(false);
const measurementReminderAvailable = ref(false);
const profileAvailable = ref(false);
const strategyAvailable = ref(false);
const measurementsAvailable = ref(false);
const portabilityAvailable = ref(false);
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
  targetWeightKg: null as number | null,
  targetDate: null as string | null,
});
const measurements = ref<BodyMeasurement[]>([]);
const portabilityTasks = ref<PortabilityTask[]>([]);
const deletionForm = reactive({ confirmationUsername: "", password: "", understood: false });
let portabilityTimer: number | undefined;
const editingMeasurementId = ref<string | null>(null);
const measurementRevision = ref(0);
const measurementForm = reactive({ localDate: localDate(new Date()), weightKg: null as number | null, waistCm: null as number | null, note: null as string | null });
const adminVisible = computed(() => sessionStore.account?.role === "admin");
type SettingsSection = "profile" | "measurement" | "strategy" | "reminders" | "data";
const settingsSections: readonly SettingsSection[] = ["profile", "measurement", "strategy", "reminders", "data"];
const selectedSection = computed<SettingsSection | null>(() => {
  const value = route.params.section;
  return typeof value === "string" && settingsSections.includes(value as SettingsSection) ? value as SettingsSection : null;
});
const setupRequested = computed(() => route.params.section === "setup");
const setupActive = ref(false);
const setupStep = ref(0);
const setupSteps = [
  { id: "profile", label: "基础资料" },
  { id: "measurement", label: "身体数据" },
  { id: "strategy", label: "目标方向" },
  { id: "reminders", label: "提醒" },
] as const;
const setupSaving = computed(() => profileSaving.value || measurementSaving.value || strategySaving.value || saving.value || nutritionReminderSaving.value || measurementReminderSaving.value);
const enabledReminderCount = computed(() => [form.enabled, nutritionReminderForm.enabled, measurementReminderForm.enabled].filter(Boolean).length);
const latestMeasurement = computed(() => measurements.value[0] ?? null);
const sectionTitle = computed(() => ({
  profile: "基础资料",
  measurement: "身体测量",
  strategy: "目标与营养",
  reminders: "提醒",
  data: "数据与账号",
}[selectedSection.value ?? "profile"]));
const weightStrategyLabel = computed(() => ({ maintain: "维持体重", lose: "减脂", gain: "增重" }[strategyForm.weightStrategy]));
const macroOptions = computed(() => [
  { value: "balanced" as const, label: "均衡分配", description: "按常规比例分配三大营养素。" },
  { value: "high_protein" as const, label: "偏高蛋白", description: "适合健康且有规律运动的人。" },
  ...(strategyForm.weightStrategy === "lose" ? [{ value: "lower_fat" as const, label: "减脂期较低脂肪", description: "脂肪取建议范围的较低值。" }] : []),
]);

function localDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function openDatePicker(event: MouseEvent) {
  const label = event.currentTarget as HTMLLabelElement;
  const input = label.querySelector<HTMLInputElement>('input[type="date"]');
  if (input === null || input.disabled || event.target === input) return;
  input.focus({ preventScroll: true });
  try {
    input.showPicker?.();
  } catch {
    // Some browsers only allow the native picker from the input itself.
  }
}

async function load() {
  loading.value = true;
  errorMessage.value = "";
  const results = await Promise.allSettled([
      reminderApi.getTrainingSettings(browserTimeZone()),
      reminderApi.getNutritionSettings(browserTimeZone()),
      reminderApi.getMeasurementSettings(browserTimeZone()),
      planningApi.getProfile(),
      planningApi.getStrategy(),
      planningApi.listMeasurements(),
      portabilityApi.listTasks(),
  ] as const);
  const [settingsResult, nutritionSettingsResult, measurementSettingsResult, profileResult, strategyResult, measurementsResult, portabilityResult] = results;
  if (settingsResult.status === "fulfilled") {
    const settings = settingsResult.value;
    form.enabled = settings.enabled;
    form.localTime = settings.localTime;
    form.timeZone = settings.timeZone;
    revision.value = settings.revision;
    trainingReminderAvailable.value = true;
  }
  if (nutritionSettingsResult.status === "fulfilled") {
    const nutritionSettings = nutritionSettingsResult.value;
    Object.assign(nutritionReminderForm, { enabled: nutritionSettings.enabled, localTime: nutritionSettings.localTime, timeZone: nutritionSettings.timeZone });
    nutritionReminderRevision.value = nutritionSettings.revision;
    nutritionReminderAvailable.value = true;
  }
  if (measurementSettingsResult.status === "fulfilled") {
    const measurementSettings = measurementSettingsResult.value;
    Object.assign(measurementReminderForm, { enabled: measurementSettings.enabled, intervalDays: measurementSettings.intervalDays, localTime: measurementSettings.localTime, timeZone: measurementSettings.timeZone });
    measurementReminderRevision.value = measurementSettings.revision;
    measurementReminderAvailable.value = true;
  }
  if (profileResult.status === "fulfilled") {
    const profile = profileResult.value;
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
    profileAvailable.value = true;
  }
  if (strategyResult.status === "fulfilled") {
    const strategy = strategyResult.value;
    Object.assign(strategyForm, {
      weightStrategy: strategy.weightStrategy,
      macroPreference: strategy.macroPreference,
      regularExercise: strategy.regularExercise,
      targetWeightKg: strategy.targetWeightKg,
      targetDate: strategy.targetDate,
    });
    strategyRevision.value = strategy.revision;
    strategyAvailable.value = true;
  }
  if (measurementsResult.status === "fulfilled") {
    measurements.value = measurementsResult.value;
    measurementsAvailable.value = true;
  }
  if (portabilityResult.status === "fulfilled") {
    portabilityTasks.value = portabilityResult.value;
    portabilityAvailable.value = true;
  }
  const failed = results.find((result) => result.status === "rejected");
  if (failed?.status === "rejected") {
    console.error("Settings page loaded partially", failed.reason);
    const detail = failed.reason instanceof ApiError ? failed.reason.message : "部分设置暂时读取不了";
    errorMessage.value = `${detail}；未载入的表单已禁止保存，其他设置仍可使用。`;
  }
  const pristine = profileRevision.value === 0 && strategyRevision.value === 0 && measurements.value.length === 0;
  setupActive.value = setupRequested.value || (selectedSection.value === null && pristine);
  loading.value = false;
}

async function saveProfile(): Promise<boolean> {
  profileSaving.value = true;
  errorMessage.value = "";
  try {
    const saved = await planningApi.updateProfile(profileRevision.value, profileForm);
    profileRevision.value = saved.revision;
    notice.value = "基础资料已保存。";
    return true;
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : "暂时保存不了个人档案";
    return false;
  } finally {
    profileSaving.value = false;
  }
}

function normalizeMacroPreference() {
  if (strategyForm.weightStrategy !== "lose" && strategyForm.macroPreference === "lower_fat") strategyForm.macroPreference = "balanced";
}

async function saveStrategy(): Promise<boolean> {
  normalizeMacroPreference();
  strategySaving.value = true;
  errorMessage.value = "";
  try {
    const saved = await planningApi.updateStrategy(strategyRevision.value, { ...strategyForm, trainingIntent: null });
    strategyRevision.value = saved.revision;
    notice.value = "目标方向已保存。";
    return true;
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : "暂时保存不了目标策略";
    return false;
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

async function saveMeasurement(): Promise<boolean> {
  if (measurementForm.weightKg === null) return true;
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
    return true;
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : "暂时保存不了身体测量";
    return false;
  } finally {
    measurementSaving.value = false;
  }
}

async function save(): Promise<boolean> {
  saving.value = true;
  errorMessage.value = "";
  notice.value = "";
  try {
    const settings = await reminderApi.updateTrainingSettings(revision.value, form);
    revision.value = settings.revision;
    notice.value = settings.enabled ? `训练提醒已开启，将在有当日安排时于 ${settings.localTime} 提示` : "训练提醒已关闭";
    return true;
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : "暂时保存不了设置";
    return false;
  } finally {
    saving.value = false;
  }
}

async function saveNutritionReminder(): Promise<boolean> {
  nutritionReminderSaving.value = true; errorMessage.value = "";
  try { const saved = await reminderApi.updateNutritionSettings(nutritionReminderRevision.value, nutritionReminderForm); nutritionReminderRevision.value = saved.revision; notice.value = saved.enabled ? `饮食提醒已开启，将在 ${saved.localTime} 根据当天记录提示` : "饮食提醒已关闭"; return true; }
  catch (error) { errorMessage.value = error instanceof ApiError ? error.message : "暂时保存不了饮食提醒"; return false; }
  finally { nutritionReminderSaving.value = false; }
}

async function saveMeasurementReminder(): Promise<boolean> {
  measurementReminderSaving.value = true; errorMessage.value = "";
  try { const saved = await reminderApi.updateMeasurementSettings(measurementReminderRevision.value, measurementReminderForm); measurementReminderRevision.value = saved.revision; notice.value = saved.enabled ? `身体测量提醒已开启，每 ${saved.intervalDays} 天检查一次` : "身体测量提醒已关闭"; return true; }
  catch (error) { errorMessage.value = error instanceof ApiError ? error.message : "暂时保存不了身体测量提醒"; return false; }
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

function openSettingsSection(section: SettingsSection | "setup") {
  if (section === "setup") {
    setupActive.value = true;
    setupStep.value = 0;
  }
  void router.push({ name: "settings", params: { section } });
}

function returnToSettings() {
  setupActive.value = false;
  void router.push({ name: "settings" });
}

async function advanceSetup(): Promise<void> {
  let saved = true;
  if (setupStep.value === 0) saved = await saveProfile();
  if (setupStep.value === 1) saved = await saveMeasurement();
  if (setupStep.value === 2) saved = await saveStrategy();
  if (setupStep.value === 3) {
    const results = await Promise.all([save(), saveNutritionReminder(), saveMeasurementReminder()]);
    saved = results.every(Boolean);
  }
  if (!saved) return;
  if (setupStep.value < setupSteps.length - 1) {
    setupStep.value += 1;
    notice.value = "";
    return;
  }
  setupActive.value = false;
  setupStep.value = 0;
  notice.value = "设置完成，以后可以按项目单独修改。";
  await router.replace({ name: "settings" });
}

function previousSetupStep() {
  if (setupStep.value > 0) setupStep.value -= 1;
}

function skipSetup() {
  void router.push({ name: "today" });
}

onMounted(() => { void load(); portabilityTimer = window.setInterval(() => void refreshPortabilityTasks(), 2_000); });
onBeforeUnmount(() => { if (portabilityTimer !== undefined) window.clearInterval(portabilityTimer); });
</script>

<template>
  <AppShell page-class="settings-page" rail-note="资料、提醒和数据都在这里。">
        <header class="view-header settings-header">
          <div v-if="setupActive"><p class="date-line">首次设置 · {{ setupStep + 1 }}/{{ setupSteps.length }}</p><h1>{{ setupSteps[setupStep]!.label }}</h1><p>按顺序检查一遍，以后可以只改其中一项。</p></div>
          <div v-else-if="selectedSection !== null"><p class="date-line">设置</p><h1>{{ sectionTitle }}</h1><p>只修改这部分，其他设置不会改变。</p></div>
          <div v-else><p class="date-line">设置</p><h1>设置</h1><p>选择要修改的内容。</p></div>
          <button v-if="!setupActive && selectedSection !== null" class="action-button" type="button" @click="returnToSettings">返回设置</button>
          <button v-else-if="!setupActive" class="action-button" type="button" @click="openSettingsSection('setup')">按步骤检查</button>
          <button v-else class="text-action" type="button" @click="skipSetup">以后再设置</button>
        </header>
        <p v-if="errorMessage" class="form-error" role="alert">{{ errorMessage }}</p>
        <p v-if="notice" class="training-notice" role="status">{{ notice }}</p>
        <section v-if="loading" class="work-panel training-empty"><strong>正在读取设置…</strong></section>
        <div v-else class="view-stack">
          <ol v-if="setupActive" class="setup-progress" aria-label="设置进度">
            <li v-for="(step, index) in setupSteps" :key="step.id" :class="{ 'is-current': index === setupStep, 'is-done': index < setupStep }"><span>{{ index + 1 }}</span><strong>{{ step.label }}</strong></li>
          </ol>

          <section v-if="!setupActive && selectedSection === null" class="settings-overview" aria-label="设置项目">
            <button type="button" @click="openSettingsSection('profile')"><span><strong>基础资料</strong><small>{{ profileRevision > 0 ? '已填写' : '待补充' }} · 出生日期、性别、身高和活动水平</small></span><b aria-hidden="true">›</b></button>
            <button type="button" @click="openSettingsSection('measurement')"><span><strong>身体测量</strong><small>{{ latestMeasurement ? `${latestMeasurement.weightKg} kg · ${latestMeasurement.localDate}` : '还没有体重记录' }}</small></span><b aria-hidden="true">›</b></button>
            <button type="button" @click="openSettingsSection('strategy')"><span><strong>目标与营养</strong><small>{{ weightStrategyLabel }} · 系统据此计算每日参考</small></span><b aria-hidden="true">›</b></button>
            <button type="button" @click="openSettingsSection('reminders')"><span><strong>提醒</strong><small>已开启 {{ enabledReminderCount }} 项</small></span><b aria-hidden="true">›</b></button>
            <button type="button" @click="openSettingsSection('data')"><span><strong>数据与账号</strong><small>导出记录或管理账号</small></span><b aria-hidden="true">›</b></button>
            <button type="button" @click="router.push({ name: 'feedback' })"><span><strong>Bug 反馈</strong><small>生成可以复制或下载的问题报告</small></span><b aria-hidden="true">›</b></button>
            <button v-if="adminVisible" type="button" @click="router.push({ name: 'admin' })"><span><strong>系统管理</strong><small>查看账号和运行状态</small></span><b aria-hidden="true">›</b></button>
          </section>

          <section v-if="setupActive ? setupStep === 0 : selectedSection === 'profile'" class="work-panel" aria-labelledby="profile-settings-title">
            <div class="panel-heading"><div><h2 id="profile-settings-title">基础资料</h2><p>这些资料用于选择合适的能量计算方法。</p></div></div>
            <p v-if="!profileAvailable" class="field-help">个人档案尚未载入，当前不能保存，以免覆盖原有资料。</p><form class="planning-form" @submit.prevent="saveProfile">
              <div class="field-grid">
                <label class="date-field--clickable" @click="openDatePicker"><span>出生日期</span><input v-model="profileForm.birthDate" type="date" /><small>当前计算方法适用于 19–64 岁成人。</small></label>
                <label><span>性别</span><select v-model="profileForm.sexCategory"><option :value="null">请选择</option><option value="male">男</option><option value="female">女</option></select><small>系统会据此选择适用的能量计算公式。</small></label>
                <label><span>身高（cm）</span><input v-model.number="profileForm.heightCm" type="number" min="80" max="250" step="0.1" placeholder="例如 175" /></label>
                <label><span>日常活动水平</span><select v-model="profileForm.palCategory"><option :value="null">还不确定</option><option value="inactive">久坐为主</option><option value="low_active">有少量日常活动</option><option value="active">经常活动或训练</option><option value="very_active">活动量很大</option></select><small>综合工作、通勤和长期训练情况选择。</small></label>
              </div>
              <fieldset class="safety-fieldset"><legend>适用边界</legend>
                <label class="switch-row"><input v-model="profileForm.pregnantOrBreastfeeding" type="checkbox" /><span>当前处于孕期或哺乳期</span></label>
                <label class="switch-row"><input v-model="profileForm.medicalNutritionCondition" type="checkbox" /><span>有需要专业营养处理的疾病或健康状态</span></label>
                <label class="switch-row"><input v-model="profileForm.specialBodyComposition" type="checkbox" /><span>体成分明显特殊，不适合直接按体重计算运动蛋白质</span></label>
              </fieldset>
              <button v-if="!setupActive" class="action-button action-button--primary" type="submit" :disabled="profileSaving || !profileAvailable">{{ profileSaving ? '保存中…' : '保存基础资料' }}</button>
            </form>
          </section>

          <section v-if="setupActive ? setupStep === 1 : selectedSection === 'measurement'" class="work-panel" aria-labelledby="measurement-settings-title">
            <div class="panel-heading"><div><h2 id="measurement-settings-title">身体测量</h2><p>记录体重和腰围，误录可以直接修正。</p></div><span class="status-chip">{{ measurements.length }} 条</span></div>
            <p v-if="!measurementsAvailable" class="field-help">身体测量记录尚未载入，当前不能新增或修正。</p><form class="planning-form" @submit.prevent="saveMeasurement">
              <div class="field-grid">
                <label><span>测量日期</span><input v-model="measurementForm.localDate" type="date" required /></label>
                <label><span>体重（kg）</span><input v-model.number="measurementForm.weightKg" type="number" min="20" max="400" step="0.1" required placeholder="例如 70.5" /></label>
                <label><span>腰围（cm，可选）</span><input v-model.number="measurementForm.waistCm" type="number" min="30" max="300" step="0.1" /></label>
                <label><span>备注（可选）</span><input v-model="measurementForm.note" maxlength="500" placeholder="例如晨起空腹" /></label>
              </div>
              <div v-if="!setupActive" class="form-actions"><button class="action-button action-button--primary" type="submit" :disabled="measurementSaving || !measurementsAvailable">{{ measurementSaving ? '保存中…' : editingMeasurementId ? '保存修正' : '记录这次测量' }}</button><button v-if="editingMeasurementId" class="text-action" type="button" @click="resetMeasurementForm">取消修正</button></div>
            </form>
            <ul v-if="!setupActive && measurements.length" class="measurement-list">
              <li v-for="measurement in measurements" :key="measurement.id"><div><strong>{{ measurement.weightKg }} kg</strong><span>{{ measurement.localDate }}<template v-if="measurement.waistCm !== null"> · 腰围 {{ measurement.waistCm }} cm</template></span><small v-if="measurement.note">{{ measurement.note }}</small></div><button class="text-action" type="button" @click="editMeasurement(measurement)">修正</button></li>
            </ul>
            <p v-else-if="!setupActive" class="data-note">还没有测量记录。</p>
          </section>

          <section v-if="setupActive ? setupStep === 2 : selectedSection === 'strategy'" class="work-panel" aria-labelledby="strategy-settings-title">
            <div class="panel-heading"><div><h2 id="strategy-settings-title">目标与营养</h2><p>选择当前方向，系统按已核验的方法计算每日参考。</p></div></div>
            <p v-if="!strategyAvailable" class="field-help">目标策略尚未载入，当前不能保存，以免覆盖原有选择。</p><form class="planning-form" @submit.prevent="saveStrategy">
              <fieldset class="strategy-fieldset"><legend>体重策略</legend><div class="strategy-options">
                <label v-for="option in [{ value: 'maintain', label: '维持体重', description: '以当前体重的维持能量为参考。' }, { value: 'lose', label: '减脂', description: '在官方建议适用时计算能量缺口。' }, { value: 'gain', label: '增重', description: '先提供维持参考，再结合记录调整。' }]" :key="option.value" class="strategy-option" :class="{ 'is-selected': strategyForm.weightStrategy === option.value }"><input v-model="strategyForm.weightStrategy" type="radio" name="weight-strategy" :value="option.value" @change="normalizeMacroPreference" /><span><strong>{{ option.label }}</strong><small>{{ option.description }}</small></span></label>
              </div></fieldset>
              <fieldset class="strategy-fieldset"><legend>宏量分配偏好</legend><div class="strategy-options"><label v-for="option in macroOptions" :key="option.value" class="strategy-option" :class="{ 'is-selected': strategyForm.macroPreference === option.value }"><input v-model="strategyForm.macroPreference" type="radio" name="macro-preference" :value="option.value" /><span><strong>{{ option.label }}</strong><small>{{ option.description }}</small></span></label></div></fieldset>
              <label class="switch-row"><input v-model="strategyForm.regularExercise" type="checkbox" /><span>目前有规律运动</span></label>
              <div v-if="strategyForm.weightStrategy === 'gain'" class="field-grid"><label><span>目标体重（kg，可选）</span><input v-model.number="strategyForm.targetWeightKg" type="number" min="20" max="400" step="0.1" /></label><label><span>目标日期（可选）</span><input v-model="strategyForm.targetDate" type="date" /></label></div>
              <button v-if="!setupActive" class="action-button action-button--primary" type="submit" :disabled="strategySaving || !strategyAvailable">{{ strategySaving ? '保存中…' : '保存目标与营养' }}</button>
            </form>
          </section>

          <section v-if="setupActive ? setupStep === 3 : selectedSection === 'reminders'" class="work-panel" aria-labelledby="training-reminder-settings-title">
            <div class="panel-heading"><div><h2 id="training-reminder-settings-title">训练提醒</h2><p>当天有未开始的训练安排时提醒。</p></div></div>
            <p v-if="!trainingReminderAvailable" class="field-help">训练提醒设置尚未载入，当前不能保存。</p><form class="reminder-form" @submit.prevent="save">
              <label class="switch-row"><input v-model="form.enabled" type="checkbox" /><span>{{ form.enabled ? '已开启' : '已关闭' }}</span></label>
              <label><span>提醒时间</span><input v-model="form.localTime" type="time" required /></label>
              <label><span>时区</span><input v-model="form.timeZone" required maxlength="100" /></label>
              <button v-if="!setupActive" class="action-button action-button--primary" type="submit" :disabled="saving || !trainingReminderAvailable">{{ saving ? '保存中…' : '保存训练提醒' }}</button>
            </form>
            <div class="browser-notification-row">
              <div><strong>浏览器通知</strong><p>即使不授权，打开应用时仍会显示应用内提醒。</p></div>
              <button v-if="browserNotification === 'default'" class="action-button" type="button" @click="requestBrowserNotification">允许浏览器通知</button>
              <span v-else class="status-chip">{{ browserNotification === 'granted' ? '已允许' : browserNotification === 'denied' ? '已拒绝' : '不支持' }}</span>
            </div>
          </section>

          <section v-if="setupActive ? setupStep === 3 : selectedSection === 'reminders'" class="work-panel" aria-labelledby="nutrition-reminder-settings-title">
            <div class="panel-heading"><div><h2 id="nutrition-reminder-settings-title">饮食提醒</h2><p>根据当天的饮食记录和剩余量提醒。</p></div></div>
            <p v-if="!nutritionReminderAvailable" class="field-help">饮食提醒设置尚未载入，当前不能保存。</p><form class="reminder-form" @submit.prevent="saveNutritionReminder">
              <label class="switch-row"><input v-model="nutritionReminderForm.enabled" type="checkbox" /><span>{{ nutritionReminderForm.enabled ? '已开启' : '已关闭' }}</span></label>
              <label><span>提醒时间</span><input v-model="nutritionReminderForm.localTime" type="time" required /></label>
              <label><span>时区</span><input v-model="nutritionReminderForm.timeZone" required maxlength="100" /></label>
              <button v-if="!setupActive" class="action-button action-button--primary" type="submit" :disabled="nutritionReminderSaving || !nutritionReminderAvailable">{{ nutritionReminderSaving ? '保存中…' : '保存饮食提醒' }}</button>
            </form>
            <p class="data-note">记录不完整时，提醒会注明还有内容未记录。</p>
          </section>

          <section v-if="setupActive ? setupStep === 3 : selectedSection === 'reminders'" class="work-panel" aria-labelledby="measurement-reminder-settings-title">
            <div class="panel-heading"><div><h2 id="measurement-reminder-settings-title">身体测量提醒</h2><p>按设定周期提醒更新体重等资料。</p></div></div>
            <p v-if="!measurementReminderAvailable" class="field-help">身体测量提醒设置尚未载入，当前不能保存。</p><form class="reminder-form" @submit.prevent="saveMeasurementReminder">
              <label class="switch-row"><input v-model="measurementReminderForm.enabled" type="checkbox" /><span>{{ measurementReminderForm.enabled ? '已开启' : '已关闭' }}</span></label>
              <label><span>间隔天数</span><input v-model.number="measurementReminderForm.intervalDays" type="number" min="1" max="365" required /></label>
              <label><span>提醒时间</span><input v-model="measurementReminderForm.localTime" type="time" required /></label>
              <label><span>时区</span><input v-model="measurementReminderForm.timeZone" required maxlength="100" /></label>
              <button v-if="!setupActive" class="action-button action-button--primary" type="submit" :disabled="measurementReminderSaving || !measurementReminderAvailable">{{ measurementReminderSaving ? '保存中…' : '保存测量提醒' }}</button>
            </form>
            <p class="data-note">没有新记录时，系统继续使用最近一次有效体重。</p>
          </section>

          <section v-if="!setupActive && selectedSection === 'data'" class="work-panel" aria-labelledby="data-control-title">
            <div class="panel-heading"><div><h2 id="data-control-title">我的数据</h2><p>导出只包含结构化记录和照片生命周期，不包含密码、会话令牌或原图。</p></div><button class="action-button" type="button" :disabled="exportSaving || !portabilityAvailable" @click="requestExport">{{ exportSaving ? '正在提交…' : '准备 JSON 导出' }}</button></div>
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
          <section v-if="setupActive" class="setup-navigation" aria-label="设置步骤操作">
            <button v-if="setupStep > 0" class="action-button" type="button" :disabled="setupSaving" @click="previousSetupStep">上一步</button>
            <span v-else aria-hidden="true"></span>
            <button class="action-button action-button--primary" type="button" :disabled="setupSaving" @click="advanceSetup">{{ setupSaving ? '正在保存…' : setupStep === setupSteps.length - 1 ? '完成设置' : '下一步' }}</button>
          </section>
        </div>
  </AppShell>
</template>
