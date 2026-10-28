<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, reactive, ref, watch } from "vue";
import { returnToHistory } from "../support/history-return";
import { useRoute, useRouter } from "vue-router";

import { ApiError } from "../api/client";
import { nutritionApi, type ContributionInput, type Meal, type MealContribution, type MealContributionMode, type MealImageAnalysis, type NutritionDaySummary } from "../api/nutrition";
import { planningApi, type DailyPlanningReference } from "../api/planning";
import AppShell from "../app/AppShell.vue";
import MealFoodItem from "../features/nutrition/MealFoodItem.vue";
import FoodPicker from "../features/nutrition/FoodPicker.vue";
import MealPhotoPicker from "../features/nutrition/MealPhotoPicker.vue";
import MealThumbnail from "../features/nutrition/MealThumbnail.vue";
import AppIcon from "../components/AppIcon.vue";
import FoodArt from "../components/FoodArt.vue";
import ImageResultReplacement from "../features/nutrition/ImageResultReplacement.vue";
import RetainedMealPhoto from "../features/nutrition/RetainedMealPhoto.vue";
import { foodCatalogApi } from "../api/food-catalog";
import { newFoodPickerDraft, type FoodPickerDraft, type FoodReplacementTarget } from "../features/nutrition/food-picker-draft";
import type { PortionDraft } from "../features/nutrition/portion-draft";
import { formatFileSize, prepareMealImage, type PreparedMealImage } from "../features/nutrition/image-compression";
import { usePhotoIntakeStore } from "../stores/photo-intake";
import MealReviewPhoto from "../features/nutrition/MealReviewPhoto.vue";

interface ContributionForm { mode: MealContributionMode; label: string; portionAmount: string; portionUnit: string; basisDescription: string; energyKcal: string; proteinGrams: string; carbohydrateGrams: string; fatGrams: string; replaceExisting: boolean; saveAsTemplate: boolean; }
interface ImageAdoptionForm { mode: "whole_meal" | "supplement"; label: string; portionAmount: string; portionUnit: string; basisDescription: string; energyKcal: string; proteinGrams: string; carbohydrateGrams: string; fatGrams: string; replaceExisting: boolean; deleteOriginal: boolean; }
const emptyContribution = (): ContributionForm => ({ mode: "item", label: "", portionAmount: "", portionUnit: "g", basisDescription: "", energyKcal: "", proteinGrams: "", carbohydrateGrams: "", fatGrams: "", replaceExisting: false, saveAsTemplate: false });

const route = useRoute();
const router = useRouter();
const photoIntake = usePhotoIntakeStore();
const quickPhotoPicker = ref<InstanceType<typeof MealPhotoPicker> | null>(null);
const focusedMealId = ref<string | null>(null);
const incomingPhotoDate = ref<string | null>(null);
const selectedDate = ref(typeof route.query.date === "string" ? route.query.date : localDate(new Date()));
const loading = ref(true);
const saving = ref(false);
const errorMessage = ref("");
const notice = ref("");
const automaticPhotos = ref<boolean | null>(null);
async function loadPhotoSettings() {
  try { automaticPhotos.value = (await nutritionApi.photoSettings()).automatic; }
  catch { automaticPhotos.value = null; errorMessage.value = "识别设置暂时读取不了，请重新读取后上传；手工记录不受影响。"; }
}
async function imageFoodsSaved(meal: Meal, analysis: MealImageAnalysis) {
  analysesByMeal[meal.id] = (analysesByMeal[meal.id] ?? []).map(item => item.id === analysis.id ? analysis : item);
  await selectionsSaved(meal);
  notice.value = analysis.replacement?.undone ? "已撤销这次替换，原食物已恢复" : "照片食物已保存，未选择替换的内容仍保留";
}
async function imageFoodsRefreshed(meal: Meal, analysis: MealImageAnalysis) {
  analysesByMeal[meal.id] = (analysesByMeal[meal.id] ?? []).map(item => item.id === analysis.id ? analysis : item);
  if (meal.localDate === selectedDate.value) meals.value = meals.value.map(value => value.id === meal.id ? meal : value);
  try { await refreshSummary(); } catch { errorMessage.value = "餐食已重新读取，汇总暂时刷新不了。"; }
}
const reference = ref<DailyPlanningReference | null>(null);
const summary = ref<NutritionDaySummary | null>(null);
const meals = ref<Meal[]>([]);
const portionDrafts = reactive<Record<string, PortionDraft>>({});
const portionSavingIds = reactive(new Set<string>());
const portionRequestInFlight = computed(() => portionSavingIds.size > 0);
const orphanedPortionDrafts = computed(() => loading.value ? [] : Object.values(portionDrafts).filter(draft =>
  !meals.value.some(meal => meal.id === draft.meal.id && meal.contributions.some(item => item.id === draft.item.id))));
function startPortionDraft(meal: Meal, item: MealContribution) {
  if (saving.value || portionRequestInFlight.value) return;
  portionDrafts[item.id] ??= { meal, item, amount: item.portionAmount?.toString() ?? "", error: "" };
}
function cancelPortionDraft(id: string) {
  if (!portionSavingIds.has(id)) delete portionDrafts[id];
}
async function savePortionDraft(id: string) {
  const draft = portionDrafts[id];
  if (!draft || saving.value || portionRequestInFlight.value || String(draft.amount).trim() === "") return;
  portionSavingIds.add(id);
  draft.error = "";
  try {
    const saved = await nutritionApi.changePortion(draft.meal, draft.item, Number(draft.amount));
    if (portionDrafts[id] === draft) delete portionDrafts[id];
    await portionSaved(saved);
  } catch (cause) {
    if (portionDrafts[id] === draft) draft.error = cause instanceof ApiError ? cause.message : "份量暂时保存不了，输入已保留。";
  } finally { portionSavingIds.delete(id); }
}
async function returnToPortionDate(id: string) {
  const draft = portionDrafts[id];
  if (!draft || loading.value || saving.value || portionRequestInFlight.value || uploadingMealId.value !== null || actingAnalysisId.value !== null) return;
  const date = draft.meal.localDate;
  creatingMeal.value = false;
  selectedDate.value = date;
  await changeDate();
  if (!pageActive || route.name !== "nutrition" || selectedDate.value !== date || portionDrafts[id] !== draft) return;
  const owner = meals.value.find(meal => meal.id === draft.meal.id && meal.contributions.some(item => item.id === id));
  if (!owner) return;
  openMeals[owner.id] = true;
  focusedMealId.value = owner.id;
  await nextTick();
  const input = document.getElementById(`meal-food-${id}`)?.querySelector<HTMLInputElement>('.portion-editor input');
  input?.focus({ preventScroll: true });
  input?.scrollIntoView({ block: "nearest" });
}
const foodPickerDrafts = reactive<Record<string, FoodPickerDraft>>({});
function foodPickerDraft(mealId: string): FoodPickerDraft { return foodPickerDrafts[mealId] ??= newFoodPickerDraft(); }
const foodReplacementDrafts = reactive<Record<string, { target: FoodReplacementTarget; picker: FoodPickerDraft }>>({});
async function startFoodReplacement(meal: Meal, item: MealContribution) {
  const current = foodReplacementDrafts[meal.id];
  if (current && current.target.id !== item.id && !window.confirm("放弃当前尚未保存的替换选择，改为替换这项食物？")) return;
  if (!current || current.target.id !== item.id) foodReplacementDrafts[meal.id] = {
    target: { id: item.id, label: item.label, revision: item.revision }, picker: { ...newFoodPickerDraft(), open: true, mealRevision: meal.revision },
  };
  await nextTick();
  document.getElementById(`food-replacement-${meal.id}`)?.scrollIntoView({ block: "nearest" });
}
async function foodReplacementSaved(meal: Meal) {
  delete foodReplacementDrafts[meal.id];
  await selectionsSaved(meal);
  notice.value = "这一项食物已替换，其他食物保留，营养已按新基准计算";
}
async function foodReplacementRefreshed(meal: Meal) {
  if (meal.localDate === selectedDate.value) meals.value = meals.value.map(item => item.id === meal.id ? meal : item);
  try { await refreshSummary(); } catch { errorMessage.value = "餐食已重新读取，汇总暂时刷新不了。"; }
}
async function selectionsSaved(meal: Meal) {
  if (meal.localDate === selectedDate.value) meals.value = meals.value.map((value) => value.id === meal.id ? meal : value);
  notice.value = "所选食物已保存，份量与营养已同步计算";
  try { await refreshSummary(); } catch { errorMessage.value = "食物已保存，汇总暂时刷新不了，请不要重复添加。"; }
}
const creatingMeal = ref(false);
const newMealFoods = ref<FoodPickerDraft>({ ...newFoodPickerDraft(), open: true });
const pendingManualMeal = ref<Meal | undefined>();
const manualCreationUnknown = ref(false);
async function createManualMeal(): Promise<Meal> {
  if (pendingManualMeal.value) return pendingManualMeal.value;
  if (manualCreationUnknown.value) throw new Error("Check the meal list before another creation");
  if (!/^\d{2}:\d{2}$/.test(mealForm.time)) throw new Error("Invalid time");
  manualCreationUnknown.value = true;
  try {
    const meal = await nutritionApi.createMeal({ occurredAt: new Date(`${selectedDate.value}T${mealForm.time}:00`).toISOString(), localDate: selectedDate.value, timeZone: browserTimeZone(), name: nullableText(mealForm.name), note: nullableText(mealForm.note) });
    pendingManualMeal.value = meal;
    manualCreationUnknown.value = false;
    meals.value = [meal, ...meals.value];
    return meal;
  } catch (cause) {
    if (cause instanceof ApiError && cause.status >= 400 && cause.status < 500) manualCreationUnknown.value = false;
    errorMessage.value = manualCreationUnknown.value
      ? "餐食建立结果尚未确认。为避免重复，已暂停再次建立；请重新读取餐食列表核对，再选择要继续添加的餐食。"
      : cause instanceof ApiError ? cause.message : "餐食尚未保存，请检查时间后重试。";
    throw cause;
  }
}
async function manualFoodsSaved(meal: Meal) {
  await selectionsSaved(meal);
  openMeals[meal.id] = true;
  focusedMealId.value = meal.id;
  creatingMeal.value = false;
  pendingManualMeal.value = undefined;
  newMealFoods.value = { ...newFoodPickerDraft(), open: true };
  mealForm.name = ""; mealForm.note = "";
  await nextTick();
  scrollToMealContent(document.getElementById(`meal-${meal.id}`));
}
async function resolveUnknownCreation() {
  if (!window.confirm("将重新读取这一天。请核对是否已建立餐食；未保存的食物选择会保留，可转到已有餐食继续添加。")) return;
  await load(true);
}
function continueInMeal(meal: Meal) {
  pendingManualMeal.value = meal;
  manualCreationUnknown.value = false;
  newMealFoods.value.mealRevision = meal.revision;
}
const mealNameInput = ref<HTMLInputElement | null>(null);
const quickMealImage = ref<PreparedMealImage | undefined>();
const preparingImage = ref(false);
const editingContributionId = ref<string | null>(null);
const mealForm = reactive({ name: "", time: currentTime(), note: "" });
const contributionForms = reactive<Record<string, ContributionForm>>({});
const analysesByMeal = reactive<Record<string, MealImageAnalysis[]>>({});
const imageSelections = ref<Record<string, PreparedMealImage | undefined>>({});
const uploadProgress = reactive<Record<string, number>>({});
const imageForms = reactive<Record<string, ImageAdoptionForm>>({});
const uploadingMealId = ref<string | null>(null);
const actingAnalysisId = ref<string | null>(null);

const composerIntent = ref<"photo" | "food">("photo");
const openMeals = reactive<Record<string, boolean>>({});
const visibleCorrection = computed(() => !creatingMeal.value && meals.value.some(meal => openMeals[meal.id]
  && (!focusedMealId.value || focusedMealId.value === meal.id) && meal.contributions.some(item => item.id === editingContributionId.value)));
async function resumeCorrection() {
  const owner = meals.value.find(meal => meal.contributions.some(item => item.id === editingContributionId.value));
  if (!owner) {
    if (!orphanedCorrection.value) return;
    creatingMeal.value = false;
    await nextTick();
    orphanedCorrectionPanel.value?.focus();
    orphanedCorrectionPanel.value?.scrollIntoView({ block: "nearest" });
    return;
  }
  creatingMeal.value = false; openMeals[owner.id] = true; focusedMealId.value = owner.id;
  await nextTick();
  document.querySelector<HTMLElement>('.contribution-form')?.scrollIntoView({block:'nearest'});
}
const photoPanels = reactive<Record<string, boolean>>({});
const correctionBases = reactive<Record<string, { meal: Meal; item: MealContribution }>>({});
const orphanedCorrectionPanel = ref<HTMLElement | null>(null);
const orphanedCorrection = computed(() => {
  if (!editingContributionId.value || meals.value.some(meal => meal.contributions.some(item => item.id === editingContributionId.value))) return null;
  const base = Object.values(correctionBases).find(value => value.item.id === editingContributionId.value);
  const form = base && contributionForms[base.meal.id];
  return base && form ? { meal: base.meal, item: base.item, form } : null;
});
async function returnToCorrectionDate() {
  const correction = orphanedCorrection.value;
  if (!correction || loading.value || saving.value || portionRequestInFlight.value || uploadingMealId.value !== null || actingAnalysisId.value !== null) return;
  const date = correction.meal.localDate, contributionId = correction.item.id;
  creatingMeal.value = false;
  selectedDate.value = date;
  await changeDate();
  if (!pageActive || route.name !== "nutrition" || selectedDate.value !== date || editingContributionId.value !== contributionId) return;
  await resumeCorrection();
  document.querySelector<HTMLInputElement>('.contribution-form input')?.focus({ preventScroll: true });
}
const metadataDrafts = reactive<Record<string, { base: Meal; date: string; time: string; name: string; note: string }>>({});
const nutrients = [
  { key: "energyKcal", label: "能量", unit: "kcal" },
  { key: "proteinGrams", label: "蛋白质", unit: "g" },
  { key: "carbohydrateGrams", label: "碳水", unit: "g" },
  { key: "fatGrams", label: "脂肪", unit: "g" },
] as const;
function recordedValue(key: typeof nutrients[number]["key"]) {
  const value = summary.value?.[key];
  return value ? value.recorded : null;
}
function targetValue(key: typeof nutrients[number]["key"]) {
  return key === "energyKcal" ? reference.value?.result.targetEnergyKcal ?? null : reference.value?.result[key] ?? null;
}
function mealNutrient(meal: Meal, key: typeof nutrients[number]["key"]) {
  const known = meal.contributions.map(item => item[key]).filter((value): value is number => value !== null);
  if (!known.length) return "未知";
  const sum = Math.round(known.reduce((a,b) => a+b, 0) * 1000) / 1000;
  return `${known.length < meal.contributions.length ? "部分 " : ""}${sum}`;
}
function startMetadata(meal: Meal) {
  metadataDrafts[meal.id] ??= { base: meal, date: meal.localDate, time: displayTime(meal.occurredAt), name: meal.name ?? "", note: meal.note ?? "" };
}
async function saveMetadata(meal: Meal) {
  const draft = metadataDrafts[meal.id]; if (!draft || saving.value) return;
  saving.value = true; errorMessage.value = "";
  try {
    const sameMoment = draft.date === draft.base.localDate && draft.time === displayTime(draft.base.occurredAt);
    const saved = await nutritionApi.updateMeal(meal.id, draft.base.revision, {
      occurredAt: sameMoment ? draft.base.occurredAt : new Date(`${draft.date}T${draft.time}:00`).toISOString(),
      localDate: draft.date, timeZone: sameMoment ? draft.base.timeZone : browserTimeZone(),
      name: nullableText(draft.name), note: nullableText(draft.note),
    });
    delete metadataDrafts[meal.id];
    meals.value = meals.value.map(item => item.id === meal.id ? saved : item).filter(item => item.localDate === selectedDate.value).sort((a,b) => b.occurredAt.localeCompare(a.occurredAt));
    notice.value = saved.localDate === selectedDate.value ? "餐食信息已保存" : `餐食已移至 ${saved.localDate}，原日期不再重复计入`;
    try { await refreshSummary(); } catch { errorMessage.value = "餐食已保存，汇总暂时刷新不了，请不要重复保存。"; }
    await returnToHistory(route, router);
  } catch (cause) { errorMessage.value = cause instanceof ApiError ? cause.message : "餐食信息暂时保存不了，填写的内容已保留。"; }
  finally { saving.value = false; }
}

let pollTimer: number | undefined;
let pollInFlight = false;
let loadGeneration = 0;

function localDate(date: Date): string { const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date).map((part) => [part.type, part.value])); return `${values.year}-${values.month}-${values.day}`; }
function currentTime(): string { return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()); }
function browserTimeZone(): string { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; }
function nullableText(value: string): string | null { const clean = value.trim(); return clean.length === 0 ? null : clean; }
function nullableNumber(value: string | number): number | null { if (typeof value === "number") return value; const clean = value.trim(); return clean.length === 0 ? null : Number(clean); }
function formFor(mealId: string): ContributionForm { contributionForms[mealId] ??= emptyContribution(); return contributionForms[mealId]!; }
function rawContributionInput(form: ContributionForm): ContributionInput { return { mode: form.mode, label: form.label, portionAmount: nullableNumber(form.portionAmount), portionUnit: nullableText(form.portionUnit), basisDescription: nullableText(form.basisDescription), energyKcal: nullableNumber(form.energyKcal), proteinGrams: nullableNumber(form.proteinGrams), carbohydrateGrams: nullableNumber(form.carbohydrateGrams), fatGrams: nullableNumber(form.fatGrams) }; }
function displayTime(value: string): string { return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
function nutrientText(value: number | null, unit: string): string { const factor = unit === 'kcal' ? 1 : 10; return value === null ? "未知" : `${Math.round(value * factor) / factor} ${unit}`; }
function contributionForAnalysis(meal: Meal, analysisId: string): MealContribution | undefined { return meal.contributions.find((value) => value.sourceAnalysisId === analysisId); }
function reviewAnalysis(meal: Meal): MealImageAnalysis | undefined {
  const values = analysesByMeal[meal.id] ?? [];
  return values.find(value => value.imageAvailable && contributionForAnalysis(meal, value.id))
    ?? values.find(value => value.imageAvailable) ?? values[0];
}
function toggleMeal(meal: Meal) {
  const opening = !openMeals[meal.id];
  for (const key of Object.keys(openMeals)) openMeals[key] = false;
  openMeals[meal.id] = opening;
  focusedMealId.value = opening ? meal.id : null;
}
function showMealList() { for (const key of Object.keys(openMeals)) openMeals[key] = false; focusedMealId.value = null; }
function cancelCorrection(meal: Meal) { editingContributionId.value = null; delete correctionBases[meal.id]; contributionForms[meal.id] = emptyContribution(); errorMessage.value = ''; }
function analysisStatus(value: MealImageAnalysis, meal: Meal): string {
  if (value.status === "waiting") return "照片已保存，尚未识别";
  const contribution = contributionForAnalysis(meal, value.id);
  if (value.candidate?.foods !== undefined) return contribution ? "照片估算" : "识别完成";
  if (contribution || value.adoptedAt !== null) return "照片估算";
  return value.status === "pending" ? "排队中" : value.status === "running" ? "分析中" : value.status === "succeeded" ? "识别完成" : value.status === "failed" ? "分析失败" : "已取消";
}
function confidenceLabel(value: "low" | "medium" | "high"): string { return value === "high" ? "较高" : value === "medium" ? "一般" : "较低"; }
function imageAnalysisFailureText(code: string | null, imageAvailable: boolean): string {
  const preserved = imageAvailable ? "原图仍在，已有食物未改动。" : "已有食物记录仍保留。";
  if (code === "deepseek_call_preparation_failed") return `本次准备的请求未发送给识别服务，调用前记录保存失败，已停止自动处理。${preserved}`;
  if (code === "deepseek_call_recording_failed") return `这次识别未能完整保存，已停止自动重试。识别服务可能已处理请求，${preserved}`;
  if (code === "deepseek_request_cancelled") return `这次识别已停止，未发出后续请求。${preserved}请查看当前照片与餐食状态。`;
  if (!imageAvailable) return "这次识别没有完成；已有食物记录仍保留。";
  if (code === "analysis_interrupted") return "上次识别意外中断，已有食物未改动；原图仍在，可以重新分析。";
  if (code === "queue_wait_expired") return "这张照片等待处理过久，已有食物未改动；原图仍在，可以重新分析。";
  if (code === "deepseek_timeout") return "识别等待超时，原图仍在，可以重新分析。";
  if (code === "deepseek_rate_limited" || code === "deepseek_overloaded" || code === "deepseek_server_error" || code === "deepseek_server_unavailable" || code === "deepseek_network_error") return "识别服务暂时繁忙，系统已自动尝试恢复；原图仍在，可以稍后重新分析。";
  if (code === "deepseek_authentication_failed" || code === "deepseek_insufficient_balance") return "识别服务配置当前不可用，原图仍在；你可以先手工记录，管理员处理后再试。";
  if (code === "deepseek_invalid_request" || code === "deepseek_invalid_parameters") return "当前识别模型与请求配置不匹配，原图仍在；你可以先手工记录。";
  if (code === "deepseek_empty_content" || code === "deepseek_invalid_json" || code === "deepseek_invalid_response" || code === "deepseek_invalid_candidate" || code === "deepseek_output_truncated") return "模型这次没有返回可安全采用的完整结果，原图仍在，可以重新分析。";
  return "这次没有分析成功，原图仍在，可以重新分析。";
}
function imageFormFor(analysis: MealImageAnalysis, meal: Meal): ImageAdoptionForm {
  const existing = imageForms[analysis.id];
  if (existing !== undefined) return existing;
  const candidate = analysis.candidate;
  const current = contributionForAnalysis(meal, analysis.id);
  const form: ImageAdoptionForm = { mode: current?.mode === "supplement" ? "supplement" : "whole_meal", label: current?.label ?? candidate?.title ?? "照片估算", portionAmount: current?.portionAmount?.toString() ?? "", portionUnit: current?.portionUnit ?? "", basisDescription: current?.basisDescription ?? candidate?.uncertaintyNote ?? "按照片中可见盛取量估算", energyKcal: current?.energyKcal?.toString() ?? candidate?.energyKcal?.toString() ?? "", proteinGrams: current?.proteinGrams?.toString() ?? candidate?.proteinGrams?.toString() ?? "", carbohydrateGrams: current?.carbohydrateGrams?.toString() ?? candidate?.carbohydrateGrams?.toString() ?? "", fatGrams: current?.fatGrams?.toString() ?? candidate?.fatGrams?.toString() ?? "", replaceExisting: current === undefined && meal.contributions.length > 0, deleteOriginal: false };
  imageForms[analysis.id] = form;
  return form;
}

function clearRecord<T>(record: Record<string, T>) {
  for (const key of Object.keys(record)) delete record[key];
}

let photoDraftGeneration = 0;
function resetDateScopedState() {
  photoDraftGeneration++;
  focusedMealId.value = null;
  reference.value = null;
  summary.value = null;
  meals.value = [];
  creatingMeal.value = false;
  pendingManualMeal.value = undefined;
  manualCreationUnknown.value = false;
  newMealFoods.value = { ...newFoodPickerDraft(), open: true };
  quickMealImage.value = undefined;
  mealForm.name = "";
  mealForm.time = currentTime();
  mealForm.note = "";
  clearRecord(analysesByMeal);
  clearRecord(uploadProgress);
  clearRecord(imageForms);
  imageSelections.value = {};
}

async function loadImageAnalyses(mealId: string, expectedDate = selectedDate.value) {
  try {
    const values = await nutritionApi.listImageAnalyses(mealId);
    if (selectedDate.value === expectedDate) analysesByMeal[mealId] = values;
  }
  catch (error) { if (error instanceof ApiError && error.code === "image_analysis_unavailable") return; throw error; }
}

async function pollImageAnalyses() {
  if (pollInFlight) return;
  const polledDate = selectedDate.value;
  const activeMealIds = meals.value.filter((meal) => (analysesByMeal[meal.id] ?? []).some((value) => value.status === "pending" || value.status === "running")).map((meal) => meal.id);
  if (activeMealIds.length === 0) return;
  pollInFlight = true;
  const activeAnalysisIds = new Set(activeMealIds.flatMap((mealId) => (analysesByMeal[mealId] ?? []).filter((value) => value.status === "pending" || value.status === "running").map((value) => value.id)));
  try {
    await Promise.all(activeMealIds.map((mealId) => loadImageAnalyses(mealId, polledDate)));
    if (selectedDate.value !== polledDate) return;
    const completed = activeMealIds.some((mealId) => (analysesByMeal[mealId] ?? []).some((value) => activeAnalysisIds.has(value.id) && value.status === "succeeded"));
    if (completed) {
      const refreshedMeals = await nutritionApi.listMeals(polledDate, polledDate);
      if (selectedDate.value !== polledDate) return;
      meals.value = refreshedMeals;
      await refreshSummary(polledDate);
    }
  } catch (error) {
    if (selectedDate.value !== polledDate) return;
    console.error("Image analysis refresh failed", error);
    errorMessage.value = error instanceof ApiError ? `${error.message}；照片分析状态稍后会再次刷新。` : "照片分析状态暂时刷新不了，稍后会再次尝试。";
  } finally {
    pollInFlight = false;
  }
}

async function load(preserveDraft = false) {
  const requestedDate = selectedDate.value;
  const generation = ++loadGeneration;
  if (!preserveDraft) loading.value = true;
  errorMessage.value = ""; notice.value = "";
  if (!preserveDraft) resetDateScopedState();
  const results = await Promise.allSettled([
      planningApi.getDailyReference(requestedDate, browserTimeZone()), nutritionApi.getDaySummary(requestedDate, browserTimeZone()), nutritionApi.listMeals(requestedDate, requestedDate),
  ] as const);
  if (generation !== loadGeneration || selectedDate.value !== requestedDate) return;
  const [referenceResult, summaryResult, mealsResult] = results;
  if (referenceResult.status === "fulfilled") reference.value = referenceResult.value;
  if (summaryResult.status === "fulfilled") summary.value = summaryResult.value;
  if (mealsResult.status === "fulfilled") {
    meals.value = mealsResult.value;
    for (const meal of mealsResult.value) formFor(meal.id);
    const analysisResults = await Promise.allSettled(mealsResult.value.map((meal) => loadImageAnalyses(meal.id, requestedDate)));
    if (generation !== loadGeneration || selectedDate.value !== requestedDate) return;
    if (analysisResults.some((result) => result.status === "rejected")) {
      errorMessage.value = "餐食已载入，但部分照片分析状态暂时读取不了。";
    }
  }
  const failed = results.find((result) => result.status === "rejected");
  if (failed?.status === "rejected") {
    console.error("Nutrition page loaded partially", failed.reason);
    const detail = failed.reason instanceof ApiError ? failed.reason.message : "部分饮食内容暂时读取不了";
    errorMessage.value = `${detail}；其他可用内容已保留，可以稍后重试。`;
  }
  loading.value = false;
}

async function changeDate() { await router.replace({ name: "nutrition", query: selectedDate.value === localDate(new Date()) ? {} : { date: selectedDate.value } }); await load(); }
async function openMealComposer(intent: "photo" | "food" = "photo", source?: "camera" | "gallery") {
  composerIntent.value = quickMealImage.value ? "photo" : intent;
  creatingMeal.value = true;
  // Keep the picker mounted so the native selector opens within the original user gesture.
  if (source && !quickMealImage.value) quickPhotoPicker.value?.pick(source);
  await nextTick();
  document.querySelector<HTMLElement>(".quick-meal-panel")?.focus({ preventScroll: true });
  scrollToMealContent(document.querySelector(".quick-meal-panel"));
}

function scrollToMealContent(element: Element | null) {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  element?.scrollIntoView({ behavior: reduceMotion ? "instant" : "smooth", block: "start" });
}

function closeMealComposer() {
  creatingMeal.value = false;
}

async function createMeal() {
  if (saving.value || preparingImage.value || composerIntent.value === "food") return;
  if (quickMealImage.value && automaticPhotos.value === null) { errorMessage.value = "请先重新读取识别设置，再上传照片。"; return; }
  saving.value = true;
  errorMessage.value = "";
  const selectedImage = quickMealImage.value;
  let saved: Meal;
  try {
    saved = await nutritionApi.createMeal({ occurredAt: new Date(`${selectedDate.value}T${mealForm.time}:00`).toISOString(), localDate: selectedDate.value, timeZone: browserTimeZone(), name: nullableText(mealForm.name), note: nullableText(mealForm.note) });
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : "暂时保存不了这顿饭";
    saving.value = false;
    return;
  }

  meals.value = [saved, ...meals.value];
  openMeals[saved.id] = true;
  focusedMealId.value = saved.id;
  photoPanels[saved.id] = selectedImage !== undefined || composerIntent.value === "photo";
  formFor(saved.id);
  creatingMeal.value = false;
  mealForm.name = "";
  mealForm.note = "";
  quickMealImage.value = undefined;
  if (selectedImage !== undefined) {
    imageSelections.value = { ...imageSelections.value, [saved.id]: selectedImage };
    notice.value = "餐次已建立，正在上传照片";
  } else {
    notice.value = "餐次已建立，可以继续填写吃了什么";
  }

  try {
    await refreshSummary();
  } catch (error) {
    console.error("Nutrition summary refresh after meal creation failed", error);
    errorMessage.value = "餐次已经保存，但当天汇总暂时刷新不了；请不要重复建立，稍后重新打开这一天即可。";
  }
  await nextTick();
  scrollToMealContent(document.getElementById(`meal-${saved.id}`));
  try {
    if (selectedImage !== undefined) await uploadMealImage(saved);
  } finally {
    saving.value = false;
  }
}

async function selectQuickMealImage(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file === undefined) return;
  await prepareQuickMealImage(file);
}
let imagePreparation: Promise<void> | undefined;
async function prepareQuickMealImage(file: File) {
  await prepareSelectedImage(file, prepared => { quickMealImage.value = prepared; });
}
async function prepareSelectedImage(file: File, apply: (prepared: PreparedMealImage | undefined) => void) {
  const date = selectedDate.value, generation = photoDraftGeneration;
  const currentDraft = () => date === selectedDate.value && generation === photoDraftGeneration;
  preparingImage.value = true;
  errorMessage.value = "";
  const work = (imagePreparation ?? Promise.resolve()).then(async () => {
    try { const prepared = await prepareMealImage(file); if (currentDraft()) apply(prepared); }
    catch (error) {
      console.error('Meal image preparation failed', error);
      if (currentDraft()) { apply(undefined); errorMessage.value = '这张照片暂时无法处理，请换一张 JPEG、PNG 或 WebP 图片。'; }
    }
  });
  imagePreparation = work;
  try { await work; } finally { if (imagePreparation === work) { imagePreparation = undefined; preparingImage.value = false; } }
}

async function selectMealImage(mealId: string, event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file === undefined) return;
  await prepareSelectedImage(file, prepared => { imageSelections.value = { ...imageSelections.value, [mealId]: prepared }; });
}

async function uploadMealImage(meal: Meal) {
  if (uploadingMealId.value !== null || preparingImage.value) return;
  if (automaticPhotos.value === null) { errorMessage.value = "请先重新读取识别设置，再上传照片。"; return; }
  const selected = imageSelections.value[meal.id];
  if (selected === undefined) { errorMessage.value = "请先选择或拍摄一张餐食照片"; return; }
  uploadingMealId.value = meal.id; errorMessage.value = "";
  uploadProgress[meal.id] = 0;
  try {
    const analysis = await nutritionApi.uploadMealImage(meal.id, selected.file, (percent) => { uploadProgress[meal.id] = percent; });
    analysesByMeal[meal.id] = [analysis, ...(analysesByMeal[meal.id] ?? [])];
    imageSelections.value = { ...imageSelections.value, [meal.id]: undefined };
    notice.value = analysis.status === "waiting" ? "照片已保存，尚未发送给识别服务；你可以在这餐中手动发起识别。" : analysis.status === "failed" ? "照片已保存，但识别未能发起；可在原餐食重试，无需重新上传。" : "照片已上传；识别完成后会按食物计入，你可以直接修改份量。已有记录不会被覆盖";
  } catch (error) { errorMessage.value = error instanceof ApiError ? error.message : "照片暂时上传不了"; }
  finally { uploadingMealId.value = null; delete uploadProgress[meal.id]; }
}

async function retryImageAnalysis(mealId: string, analysis: MealImageAnalysis) {
  if (actingAnalysisId.value !== null) return;
  const confirmation = analysis.lastErrorCode === "deepseek_call_recording_failed"
    ? "识别服务可能已处理这次请求，重新分析可能再次计费，是否继续？"
    : "将这张照片发送给识别服务，估算食物与营养。已有食物和修正不会自动覆盖，是否继续？";
  if (!window.confirm(confirmation)) return;
  actingAnalysisId.value = analysis.id; errorMessage.value = "";
  try {
    const saved = analysis.status === "succeeded" ? await nutritionApi.reanalyze(analysis.id, analysis.revision) : await nutritionApi.retryImageAnalysis(analysis.id, analysis.revision);
    await loadImageAnalyses(mealId, selectedDate.value);
    notice.value = saved.status === "failed" ? "照片仍保留，但识别未能发起，请稍后重试。" : "已提交识别，可以离开页面稍后查看";
  } catch (error) { errorMessage.value = error instanceof ApiError ? error.message : "暂时无法重试"; }
  finally { actingAnalysisId.value = null; }
}

async function adoptImageAnalysis(meal: Meal, analysis: MealImageAnalysis) {
  const form = imageFormFor(analysis, meal);
  actingAnalysisId.value = analysis.id; errorMessage.value = "";
  try {
    const saved = await nutritionApi.adoptImageAnalysis(analysis.id, { analysisRevision: analysis.revision, mealRevision: meal.revision, mode: form.mode, label: form.label, portionAmount: nullableNumber(form.portionAmount), portionUnit: nullableText(form.portionUnit), basisDescription: nullableText(form.basisDescription), energyKcal: nullableNumber(form.energyKcal), proteinGrams: nullableNumber(form.proteinGrams), carbohydrateGrams: nullableNumber(form.carbohydrateGrams), fatGrams: nullableNumber(form.fatGrams), replaceExisting: form.replaceExisting, deleteOriginal: form.deleteOriginal });
    meals.value = meals.value.map((value) => value.id === saved.meal.id ? saved.meal : value);
    analysesByMeal[meal.id] = (analysesByMeal[meal.id] ?? []).map((value) => value.id === saved.analysis.id ? saved.analysis : value);
    await refreshSummary(); notice.value = "这份照片估算已确认；修正前的暂定值仍可追溯";
  } catch (error) { errorMessage.value = error instanceof ApiError ? error.message : "暂时采用不了这次估算"; }
  finally { actingAnalysisId.value = null; }
}

async function portionSaved(saved: Meal) {
  if (saved.localDate !== selectedDate.value) return;
  meals.value = meals.value.map((meal) => meal.id === saved.id ? saved : meal);
  notice.value = "份量和营养已同步更新";
  try { await refreshSummary(saved.localDate); }
  catch { errorMessage.value = "份量已保存，但当天汇总暂时刷新不了，请不要重复保存。"; }
}
async function favoriteFood(meal: Meal, item: MealContribution) {
  if (saving.value) return;
  saving.value = true; errorMessage.value = "";
  try {
    await foodCatalogApi.favoriteMealFood(meal.id, item.id);
    notice.value = "已设为常用，下次可以单独添加这项食物";
  } catch (cause) { errorMessage.value = cause instanceof ApiError ? cause.message : "暂时设不了常用，请稍后重试"; }
  finally { saving.value = false; }
}

async function saveContribution(meal: Meal, existing?: MealContribution) {
  const form = formFor(meal.id); saving.value = true; errorMessage.value = "";
  const base = correctionBases[meal.id];
  if (!existing || !base || base.item.id !== existing.id) { saving.value = false; return; }
  try {
    const input = rawContributionInput(form);
    const saved = await nutritionApi.updateContribution(meal.id, existing.id, base.meal.revision, base.item.revision, input, false);
    meals.value = meals.value.map((value) => value.id === saved.id ? saved : value);
    contributionForms[meal.id] = emptyContribution(); editingContributionId.value = null; delete correctionBases[meal.id]; notice.value = "食物已修正，当天营养已更新";
    try { await refreshSummary(); } catch { errorMessage.value = "食物已保存，汇总暂时刷新不了，请不要重复保存。"; }
    await returnToHistory(route, router);
  } catch (error) { console.error("Nutrition contribution save failed", error); errorMessage.value = error instanceof ApiError ? error.message : "暂时保存不了这条营养记录"; }
  finally { saving.value = false; }
}

function editContribution(meal: Meal, value: MealContribution) {
  if (editingContributionId.value === value.id) return;
  if (editingContributionId.value !== null) {
    errorMessage.value = "请先保存或取消正在修正的食物，再修改其他食物。";
    void nextTick(() => document.querySelector<HTMLElement>('.form-error')?.scrollIntoView({block:'nearest'}));
    return;
  }
  correctionBases[meal.id] = { meal, item: value };
  contributionForms[meal.id] = { mode: value.mode, label: value.label, portionAmount: value.portionAmount?.toString() ?? "", portionUnit: value.portionUnit ?? "", basisDescription: value.basisDescription ?? "", energyKcal: value.energyKcal?.toString() ?? "", proteinGrams: value.proteinGrams?.toString() ?? "", carbohydrateGrams: value.carbohydrateGrams?.toString() ?? "", fatGrams: value.fatGrams?.toString() ?? "", replaceExisting: false, saveAsTemplate: false };
  editingContributionId.value = value.id;
}
async function deleteContribution(meal: Meal, value: MealContribution) { if (!window.confirm(`从当前汇总中移除“${value.label}”？旧值仍保留在修订记录中。`)) return; saving.value = true; try { const saved = await nutritionApi.deleteContribution(meal.id, value.id, meal.revision, value.revision); meals.value = meals.value.map((item) => item.id === saved.id ? saved : item); if (editingContributionId.value === value.id) { editingContributionId.value = null; delete correctionBases[meal.id]; } await refreshSummary(); notice.value = "这项内容已从当前汇总移除"; } catch (error) { errorMessage.value = error instanceof ApiError ? error.message : "暂时移除不了这项内容"; } finally { saving.value = false; } }
async function deleteMeal(meal: Meal) { if (!window.confirm("删除整顿饭？它会从当天汇总中排除，相关照片将被永久删除，不能恢复。")) return; saving.value = true; try { await nutritionApi.deleteMeal(meal.id, meal.revision); meals.value = meals.value.filter((value) => value.id !== meal.id); delete analysesByMeal[meal.id]; if (pendingManualMeal.value?.id === meal.id) { pendingManualMeal.value = undefined; newMealFoods.value.mealRevision = null; } if (meal.contributions.some(item => item.id === editingContributionId.value)) editingContributionId.value = null; delete correctionBases[meal.id]; delete metadataDrafts[meal.id]; await refreshSummary(); notice.value = "这顿饭已从当前汇总中排除"; } catch (error) { errorMessage.value = error instanceof ApiError ? error.message : "暂时删除不了这顿饭"; } finally { saving.value = false; } }
async function refreshSummary(expectedDate = selectedDate.value) {
  const refreshed = await nutritionApi.getDaySummary(expectedDate, browserTimeZone());
  if (selectedDate.value === expectedDate) summary.value = refreshed;
}
let requestedActionRun: symbol | null = null;
const acceptingIncomingPhoto = ref(false);
function activeAction(path: string, activation: number) { return pageActive && route.name === 'nutrition' && route.fullPath === path && activationVersion === activation; }
async function acceptIncomingPhoto() {
  const date = incomingPhotoDate.value;
  if (!date || acceptingIncomingPhoto.value || !window.confirm('放弃当前未保存的记餐输入，改记新照片？已经保存的餐食不受影响。')) return;
  acceptingIncomingPhoto.value = true;
  const path = route.fullPath, activation = activationVersion;
  try {
  if (imagePreparation) await imagePreparation;
  if (!activeAction(path, activation)) return;
  const file = photoIntake.peek(date);
  if (!file) { incomingPhotoDate.value = null; return; }
  selectedDate.value = date;
  await load();
  if (!activeAction(path, activation)) return;
  incomingPhotoDate.value = null;
  await openMealComposer('photo');
  if (!activeAction(path, activation)) return;
  photoIntake.take(date);
  await prepareQuickMealImage(file);
  if (!activeAction(path, activation)) return;
  await router.replace({ name:'nutrition', query:{date} });
  } finally { acceptingIncomingPhoto.value = false; }
}
function cancelIncomingPhoto() {
  if (acceptingIncomingPhoto.value) return;
  if (incomingPhotoDate.value) photoIntake.take(incomingPhotoDate.value);
  incomingPhotoDate.value = null;
}
async function handleRequestedAction() {
  if (!pageActive || route.name !== "nutrition" || requestedActionRun) return;
  const run = Symbol('photo-entry'), path = route.fullPath, activation = activationVersion;
  requestedActionRun = run;
  const current = () => requestedActionRun === run && activeAction(path, activation);
  try {
  if (typeof route.query.mealId === "string") {
    if (meals.value.some(meal => meal.id === route.query.mealId)) {
      openMeals[route.query.mealId] = true;
      focusedMealId.value = route.query.mealId;
    } else { focusedMealId.value = null; notice.value = '这顿饭已改期或删除，当前显示这一天的餐食。'; }
    await nextTick();
    if (!current()) return;
    scrollToMealContent(document.getElementById(`meal-${route.query.mealId}`));
  }
  const requested = route.query.action === 'new-meal' || route.query.action === 'photo';
  if (!requested && (route.query.mealId || !photoIntake.pendingDate())) return;
  if (imagePreparation) await imagePreparation;
  if (!current()) return;
  const requestedDate = requested ? (typeof route.query.date === 'string' ? route.query.date : localDate(new Date())) : photoIntake.pendingDate() ?? selectedDate.value;
  const incomingPhoto = photoIntake.peek(requestedDate);
  const hasDraft = quickMealImage.value || newMealFoods.value.selected.length || mealForm.name.trim() || mealForm.note.trim() || pendingManualMeal.value || manualCreationUnknown.value;
  if (incomingPhoto && hasDraft) {
    incomingPhotoDate.value = requestedDate;
    creatingMeal.value = true;
    const { action: _action, ...query } = route.query;
    await router.replace({ name:'nutrition', query:{...query, date:selectedDate.value} });
    return;
  }
  if (incomingPhoto && requestedDate !== selectedDate.value) { selectedDate.value = requestedDate; await load(); if (!current()) return; }
  await openMealComposer(incomingPhoto || route.query.action === "photo" ? "photo" : "food");
  if (!current()) return;
  if (incomingPhoto) { photoIntake.take(selectedDate.value); await prepareQuickMealImage(incomingPhoto); }
  if (!current()) return;
  const { action: _action, ...query } = route.query;
  await router.replace({ name: "nutrition", query: { ...query, date: selectedDate.value } });
  } finally { if (requestedActionRun === run) requestedActionRun = null; }
}

watch(() => route.query.date, (value) => {
  if (route.name !== "nutrition" || creatingMeal.value) return;
  const next = typeof value === "string" ? value : localDate(new Date());
  if (next !== selectedDate.value) { selectedDate.value = next; void load(); }
});
watch(() => route.query.action, () => { void handleRequestedAction(); });
watch(meals, values => { if (focusedMealId.value && !values.some(meal => meal.id === focusedMealId.value)) focusedMealId.value = null; });
let pageActive = false;
let activationVersion = 0;
function stopPolling() { pageActive = false; activationVersion++; requestedActionRun = null; if (pollTimer !== undefined) window.clearInterval(pollTimer); pollTimer = undefined; }
onActivated(async () => {
  const activation = ++activationVersion;
  pageActive = true;
  await load(true);
  if (!pageActive || activation !== activationVersion) return;
  await loadPhotoSettings();
  if (!pageActive || activation !== activationVersion) return;
  await handleRequestedAction();
  if (!pageActive || activation !== activationVersion) return;
  if (pollTimer === undefined) pollTimer = window.setInterval(() => void pollImageAnalyses(), 2_000);
});
onDeactivated(stopPolling);
onBeforeUnmount(stopPolling);
</script>


<template>
  <AppShell page-class="nutrition-page" rail-note="记录吃了什么，查看已记录的营养。">
    <header v-show="!creatingMeal" class="view-header">
      <div><h1>饮食</h1><p>记录吃了什么，查看当天营养。</p></div>
      <nav class="view-header-actions nutrition-header-actions" aria-label="饮食快捷操作">
        <label class="date-picker">查看日期<input v-model="selectedDate" type="date" :disabled="saving || portionRequestInFlight || uploadingMealId !== null || actingAnalysisId !== null" @change="changeDate" /></label>
      </nav>
    </header>
    <p v-if="errorMessage && !visibleCorrection" class="form-error" role="alert">{{ errorMessage }} <button v-if="automaticPhotos === null" class="text-action" type="button" @click="loadPhotoSettings">重新读取设置</button><button v-if="editingContributionId" class="text-action" type="button" @click="resumeCorrection">继续未保存的修改</button></p>
    <section v-if="orphanedCorrection" ref="orphanedCorrectionPanel" class="work-panel" tabindex="-1" aria-labelledby="orphaned-correction-title">
      <h2 id="orphaned-correction-title">未保存的食物修正</h2>
      <p v-if="orphanedCorrection.meal.localDate !== selectedDate">这份修改属于 {{ orphanedCorrection.meal.localDate }}，输入已保留。</p>
      <p v-else>原食物已不在当前记录中，无法保存到原食物。放弃这份修改后可继续修正其他食物。</p>
      <p class="field-help">原记录：{{ orphanedCorrection.meal.localDate }} · {{ orphanedCorrection.meal.name ?? '餐食' }} · {{ orphanedCorrection.item.label }}</p>
      <dl class="retained-correction-values" aria-label="保留的修正输入">
        <div><dt>食物名称</dt><dd>{{ orphanedCorrection.form.label || '未填写' }}</dd></div>
        <div v-for="metric in nutrients" :key="metric.key">
          <dt>{{ metric.label }} {{ metric.unit }}</dt><dd>{{ orphanedCorrection.form[metric.key] === '' ? '未填写' : orphanedCorrection.form[metric.key] }}</dd>
        </div>
      </dl>
      <div class="row-actions retained-correction-actions">
        <button v-if="orphanedCorrection.meal.localDate !== selectedDate" class="action-button" type="button" :aria-label="`返回 ${orphanedCorrection.meal.localDate} 继续修改`" :disabled="loading || saving || portionRequestInFlight || uploadingMealId !== null || actingAnalysisId !== null" @click="returnToCorrectionDate">返回原日期</button>
        <button class="text-action" type="button" :disabled="saving" @click="cancelCorrection(orphanedCorrection.meal)">放弃未保存的修改</button>
      </div>
    </section>
    <section v-for="draft in orphanedPortionDrafts" :key="draft.item.id" class="work-panel" :aria-label="`未保存的份量：${draft.item.label}`">
      <h2>{{ draft.item.label }}的未保存份量</h2>
      <p v-if="draft.meal.localDate !== selectedDate">这份修改属于 {{ draft.meal.localDate }}，输入已保留。</p>
      <p v-else>原食物已不在当前记录中，无法保存这份份量；你可以查看或放弃修改。</p>
      <p class="field-help">原记录：{{ draft.meal.localDate }} · {{ draft.meal.name ?? '餐食' }} · {{ draft.item.label }}</p>
      <dl class="retained-correction-values"><div><dt>份量 {{ draft.item.portionUnit }}</dt><dd>{{ String(draft.amount).trim() === '' ? '未填写' : draft.amount }}</dd></div></dl>
      <p v-if="draft.error" class="field-help">{{ draft.error }}</p>
      <div class="row-actions retained-correction-actions">
        <button v-if="draft.meal.localDate !== selectedDate" class="action-button" type="button" :aria-label="`返回 ${draft.meal.localDate} 继续修改${draft.item.label}份量`" :disabled="loading || saving || portionRequestInFlight || uploadingMealId !== null || actingAnalysisId !== null" @click="returnToPortionDate(draft.item.id)">返回原日期</button>
        <button class="text-action" type="button" :disabled="saving || portionSavingIds.has(draft.item.id)" @click="cancelPortionDraft(draft.item.id)">放弃这份份量修改</button>
      </div>
    </section>
    <section v-if="incomingPhotoDate" class="work-panel" aria-label="处理新选照片"><p>新照片用于 {{ incomingPhotoDate }}。当前未保存的记餐仍保留，请先选择要继续哪一餐。</p><div class="row-actions"><button class="action-button" type="button" :disabled="preparingImage || saving || acceptingIncomingPhoto" @click="acceptIncomingPhoto">放弃当前草稿，使用新照片</button><button class="text-action" type="button" :disabled="acceptingIncomingPhoto" @click="cancelIncomingPhoto">取消新照片，保留当前草稿</button></div></section>
    <p v-if="notice" class="form-notice" role="status">{{ notice }}</p>
    <p v-if="preparingImage" class="field-help" role="status">正在准备照片，请稍候…</p>
    <section v-if="loading" class="work-panel training-empty"><strong>正在读取这一天…</strong></section>
    <div v-else class="view-stack">
      <section v-show="!creatingMeal" class="recommendation-panel nutrition-overview" :class="{ 'nutrition-overview--compact': focusedMealId }" aria-labelledby="nutrition-overview-title">
        <div class="panel-heading"><h2 id="nutrition-overview-title"><AppIcon name="food" />当天营养</h2><span class="field-help">已记录</span></div>
        <div class="hero-energy"><dl><dt>能量</dt><dd>{{ nutrientText(recordedValue('energyKcal'), 'kcal') }}</dd><span class="field-help">每日参考 {{ targetValue('energyKcal') === null ? '暂不可用' : nutrientText(targetValue('energyKcal'), 'kcal') }}</span></dl><FoodArt kind="rice" /></div>
        <dl class="macro-grid">
          <div v-for="metric in nutrients.slice(1)" :key="metric.key">
            <dt>{{ metric.label }}</dt><dd>{{ nutrientText(recordedValue(metric.key), metric.unit) }}</dd>
          </div>
        </dl>
        <p class="field-help" v-if="summary?.mealCount === 0">尚未记录餐食。</p>
        <p class="field-help" v-else-if="summary && nutrients.some(metric => !summary![metric.key].complete)">部分食物有未知营养，合计仅包含已知数值。</p>
        <details v-if="reference" class="reference-details"><summary>参考说明与计算依据</summary>
          <p v-for="metric in nutrients.slice(1)" :key="metric.key">{{ metric.label }}每日参考 {{ targetValue(metric.key) === null ? '暂不可用' : nutrientText(targetValue(metric.key), metric.unit) }}</p>
          <p v-for="message in reference.result.messages" :key="message">{{ message }}</p>
          <p>方法 {{ reference.methodVersion }}</p><p v-for="limitation in reference.result.limitations" :key="limitation">{{ limitation }}</p>
        </details>
      </section>
      <div v-show="!creatingMeal" class="form-actions nutrition-record-actions" role="group" aria-label="记录餐食">
        <button class="primary-button" type="button" aria-label="拍照记一餐" :disabled="saving" @click="openMealComposer('photo', 'camera')"><AppIcon name="camera" />拍照</button>
        <button class="action-button" type="button" aria-label="相册记一餐" :disabled="saving" @click="openMealComposer('photo', 'gallery')"><AppIcon name="image" />相册</button>
        <button class="text-action" type="button" :disabled="saving" @click="openMealComposer('food')"><AppIcon name="plus" />手动添加食物</button>
      </div>
      <section v-show="creatingMeal" tabindex="-1" class="work-panel quick-meal-panel" aria-labelledby="quick-meal-title">
        <div class="panel-heading"><h2 id="quick-meal-title">快速记餐</h2><button class="text-action" type="button" :disabled="saving" @click="closeMealComposer">收起</button></div>
        <form class="inline-form meal-create-form" @submit.prevent="createMeal">
          <fieldset :disabled="saving || preparingImage || uploadingMealId !== null || (composerIntent === 'food' && !!pendingManualMeal)">
            <details class="compact-metadata">
              <summary><AppIcon name="calendar" />{{ selectedDate }} · {{ mealForm.time }}<span>{{ mealForm.name || '修改信息' }}</span></summary>
              <div class="compact-metadata-fields">
                <label>用餐时间<input v-model="mealForm.time" type="time" required /></label>
                <label>餐次名称（可选）<input ref="mealNameInput" v-model="mealForm.name" maxlength="100" placeholder="例如：午饭" /></label>
                <label>备注（可选）<input v-model="mealForm.note" maxlength="1000" placeholder="例如：公司食堂" /></label>
              </div>
            </details>
            <MealPhotoPicker v-show="composerIntent === 'photo'" ref="quickPhotoPicker" :file="quickMealImage?.file" :disabled="saving || preparingImage" @change="selectQuickMealImage" />
            <small v-if="quickMealImage"><template v-if="quickMealImage.compressed">已压缩 {{ formatFileSize(quickMealImage.originalBytes) }} → {{ formatFileSize(quickMealImage.uploadBytes) }}</template><template v-else>保持原图 {{ formatFileSize(quickMealImage.uploadBytes) }}</template></small>
            <button v-if="quickMealImage" class="text-action" type="button" @click="quickMealImage = undefined">移除待上传照片</button>
            <button v-if="composerIntent === 'photo'" class="primary-button" type="submit">{{ quickMealImage ? '保存这餐并上传' : '保存这餐' }}</button>
          </fieldset>
        </form>
        <template v-if="composerIntent === 'food'">
          <p v-if="pendingManualMeal" class="field-help">餐食已建立，当前只重试保存食物。名称和时间可在保存后修改。</p>
          <div v-if="manualCreationUnknown" class="form-error" role="alert">
            <p>建立结果待确认，不会自动重复建立。</p>
            <button type="button" class="text-action" :disabled="saving" @click="resolveUnknownCreation">重新读取餐食列表</button>
            <button v-for="meal in meals" :key="meal.id" type="button" class="text-action" :disabled="saving" @click="continueInMeal(meal)">继续添加到 {{ meal.name ?? '餐食' }} · {{ displayTime(meal.occurredAt) }}</button>
          </div>
          <FoodPicker standalone :meal="pendingManualMeal" :create-meal="createManualMeal" :draft="newMealFoods" :disabled="saving || manualCreationUnknown" @busy="saving = $event" @saved="manualFoodsSaved" />
        </template>
      </section>
      <section v-show="!creatingMeal" class="work-panel meal-log" aria-labelledby="meal-log-title">
        <div class="panel-heading"><h2 id="meal-log-title">{{ focusedMealId ? '核对这顿饭' : '这一天吃了什么' }}</h2><span class="status-chip">{{ meals.length }} 餐</span></div>
        <button v-if="focusedMealId" type="button" class="text-action meal-list-return" @click="showMealList"><AppIcon name="back" />返回当天餐食</button>
        <p v-if="!meals.length" class="field-help">还没有餐食记录。</p>
        <article v-for="meal in meals" v-show="!focusedMealId || focusedMealId === meal.id" :id="`meal-${meal.id}`" :key="meal.id" class="meal-card" :class="{ 'meal-card--open': openMeals[meal.id] }">
          <header><div><MealThumbnail :analysis-id="(analysesByMeal[meal.id] ?? []).find(item => item.imageAvailable)?.id" /><div class="meal-card-title"><strong>{{ meal.name ?? '餐食' }}</strong><span>{{ displayTime(meal.occurredAt) }}</span></div></div><button class="text-action" type="button" :aria-expanded="!!openMeals[meal.id]" @click="toggleMeal(meal)">{{ openMeals[meal.id] ? '收起餐食' : '打开餐食' }}</button><details class="meal-card-menu"><summary aria-label="餐食操作"><AppIcon name="more" /></summary><button class="text-action danger-text" type="button" :disabled="saving" @click="deleteMeal(meal)"><AppIcon name="trash" />删除整顿</button></details></header>
          <p class="meal-summary">{{ meal.contributions.map(item => item.label).join('、') || '还未添加食物' }}</p>
          <p class="meal-summary">{{ nutrients.map(metric => `${metric.label} ${mealNutrient(meal, metric.key)} ${metric.unit}`).join(' · ') }}</p>
          <p v-if="(analysesByMeal[meal.id] ?? []).some(analysis => analysis.status === 'pending' || analysis.status === 'running')" class="field-help" role="status">照片识别中，可以稍后回来查看。</p>
          <div v-show="openMeals[meal.id]" class="meal-content">
            <section v-if="reviewAnalysis(meal)" class="meal-review" aria-label="照片与当前食物核对">
              <MealReviewPhoto :analysis="reviewAnalysis(meal)!" />
              <p v-if="meal.contributions.length" class="meal-save-state"><AppIcon name="check" />已保存<template v-if="meal.contributions.some(item => item.source === 'model_adopted')"> · 照片估算</template></p>
              <p v-if="reviewAnalysis(meal)?.candidate?.uncertaintyNote" class="field-help">{{ reviewAnalysis(meal)?.candidate?.uncertaintyNote }}</p>
            </section>
            <div class="row-actions"><button class="text-action" type="button" :disabled="saving" @click="startMetadata(meal)">修改餐食信息</button><button class="text-action" type="button" :aria-expanded="!!photoPanels[meal.id]" :aria-controls="`meal-recognition-details-${meal.id}`" @click="photoPanels[meal.id] = !photoPanels[meal.id]">{{ photoPanels[meal.id] ? '收起识别详情' : '识别详情' }}</button></div>
            <p v-if="meal.note">{{ meal.note }}</p>
            <form v-if="metadataDrafts[meal.id]" class="meal-metadata-form" aria-label="修改餐食信息" @submit.prevent="saveMetadata(meal)">
              <fieldset :disabled="saving">
                <div class="form-row"><label>餐食日期<input v-model="metadataDrafts[meal.id]!.date" type="date" required /></label><label>餐食时间<input v-model="metadataDrafts[meal.id]!.time" type="time" required /></label></div>
                <label>餐食名称<input v-model="metadataDrafts[meal.id]!.name" maxlength="100" /></label><label>餐食说明<input v-model="metadataDrafts[meal.id]!.note" maxlength="1000" /></label>
                <div class="row-actions"><button class="primary-button" type="submit">保存餐食信息</button><button class="text-action" type="button" @click="delete metadataDrafts[meal.id]">取消修改</button></div>
              </fieldset>
            </form>
            <ul v-if="meal.contributions.length" class="meal-items">
              <MealFoodItem v-for="item in meal.contributions" :key="item.id" :meal="meal" :item="item" :draft="portionDrafts[item.id]" :saving="portionSavingIds.has(item.id)" :disabled="saving || portionRequestInFlight" @start-portion="startPortionDraft(meal, item)" @save-portion="savePortionDraft(item.id)" @cancel-portion="cancelPortionDraft(item.id)" @edit="editContribution(meal, item)" @replace="startFoodReplacement(meal, item)" @remove="deleteContribution(meal, item)" @favorite="favoriteFood(meal, item)">
                <form v-if="item.id === editingContributionId" class="contribution-form" aria-label="修正食物" @submit.prevent="saveContribution(meal, item)">
                  <fieldset :disabled="saving">
                    <p v-if="errorMessage" class="form-error" role="alert">{{ errorMessage }}</p>
                    <label>食物名称<input v-model="formFor(meal.id).label" required /></label>
                    <p class="field-help">改成另一种食物请使用“换食物”，营养会按新基准换算。</p>
                    <details><summary>修正已知营养</summary><p class="field-help">未知营养留空，调整食用量请使用“改份量”。</p><div class="form-row nutrient-inputs"><label>能量 kcal<input v-model="formFor(meal.id).energyKcal" type="number" min="0" step="any" /></label><label>蛋白质 g<input v-model="formFor(meal.id).proteinGrams" type="number" min="0" step="any" /></label><label>碳水 g<input v-model="formFor(meal.id).carbohydrateGrams" type="number" min="0" step="any" /></label><label>脂肪 g<input v-model="formFor(meal.id).fatGrams" type="number" min="0" step="any" /></label></div></details>
                    <div class="row-actions"><button class="primary-button" type="submit">保存修正</button><button class="text-action" type="button" @click="cancelCorrection(meal)">取消修改</button></div>
                  </fieldset>
                </form>
              </MealFoodItem>
            </ul>
            <FoodPicker v-if="foodReplacementDrafts[meal.id]" :id="`food-replacement-${meal.id}`" :key="foodReplacementDrafts[meal.id]!.target.id" :meal="meal" :draft="foodReplacementDrafts[meal.id]!.picker" :replacement="foodReplacementDrafts[meal.id]!.target" :disabled="saving" @busy="saving = $event" @saved="foodReplacementSaved" @refreshed="foodReplacementRefreshed" @cancel="delete foodReplacementDrafts[meal.id]" />
            <FoodPicker :meal="meal" :draft="foodPickerDraft(meal.id)" :disabled="saving" @busy="saving = $event" @saved="selectionsSaved" />
              <section v-show="photoPanels[meal.id]" :id="`meal-recognition-details-${meal.id}`" class="meal-image-panel" :aria-labelledby="`meal-image-${meal.id}`">
                <div class="meal-image-panel__heading">
                  <div>
                    <strong :id="`meal-image-${meal.id}`">拍照估算</strong>
                    <span>{{ automaticPhotos === null ? '正在读取识别设置；读取完成后可以上传照片。' : automaticPhotos ? '照片上传后自动识别，已有记录不会被覆盖。' : '照片先保存到这餐，需要时再手动发起识别。' }}</span>
                  </div>
                </div>
                <details class="meal-upload-disclosure" :open="!(analysesByMeal[meal.id]?.length) || !!imageSelections[meal.id]"><summary>添加餐食照片</summary><div class="image-upload-row">
                  <MealPhotoPicker :file="imageSelections[meal.id]?.file" :disabled="preparingImage || uploadingMealId !== null" @change="selectMealImage(meal.id, $event)" />
                  <span class="selected-file"><template v-if="imageSelections[meal.id]">{{ imageSelections[meal.id]!.file.name }} · <template v-if="imageSelections[meal.id]!.compressed">已压缩 {{ formatFileSize(imageSelections[meal.id]!.originalBytes) }} → {{ formatFileSize(imageSelections[meal.id]!.uploadBytes) }}</template><template v-else>保持原图 {{ formatFileSize(imageSelections[meal.id]!.uploadBytes) }}</template></template><template v-else>还没有选择照片</template></span>
                  <button class="action-button" type="button" :disabled="preparingImage || uploadingMealId !== null || automaticPhotos === null" @click="uploadMealImage(meal)">{{ uploadingMealId === meal.id ? '正在上传…' : automaticPhotos ? '上传并识别' : '上传照片' }}</button>
                </div></details>
                <div v-if="uploadingMealId === meal.id" class="upload-progress" role="status"><progress max="100" :value="uploadProgress[meal.id] ?? 0"></progress><span>已上传 {{ uploadProgress[meal.id] ?? 0 }}%</span></div>
                <div v-if="(analysesByMeal[meal.id] ?? []).length" class="image-analysis-list">
                  <article v-for="analysis in analysesByMeal[meal.id] ?? []" :key="analysis.id" class="image-analysis-card">
                    <header>
                      <div><strong>{{ analysis.candidate?.title ?? '餐食照片' }}</strong></div>
                      <span class="status-chip" :data-tone="analysis.status === 'failed' ? 'danger' : analysis.status === 'succeeded' ? 'accent' : undefined">{{ analysisStatus(analysis, meal) }}</span>
                    </header>
                    <RetainedMealPhoto :analysis="analysis" @deleted="loadImageAnalyses(meal.id)" />
                    <p v-if="analysis.status === 'pending' || analysis.status === 'running'" class="field-help">正在分析，可以稍后回来查看。</p>
                    <div v-else-if="analysis.status === 'waiting' || analysis.status === 'cancelled'">
                      <p class="field-help">{{ analysis.imageAvailable ? '照片已保存在这餐，尚未发起新的识别。' : '原图已不可用，请重新选择照片；已有记录仍保留。' }}</p>
                      <button v-if="analysis.imageAvailable" type="button" class="action-button" :disabled="actingAnalysisId !== null" @click="retryImageAnalysis(meal.id, analysis)">识别这张照片</button>
                    </div>
                    <div v-else-if="analysis.status === 'failed'" class="analysis-failure">
                      <p>{{ imageAnalysisFailureText(analysis.lastErrorCode, analysis.imageAvailable) }}</p>
                      <button v-if="analysis.imageAvailable" class="action-button" type="button" :disabled="actingAnalysisId === analysis.id" @click="retryImageAnalysis(meal.id, analysis)">重新分析</button><p v-else class="field-help">原图已不可用，请重新选择照片；已有食物记录不受影响。</p>
                    </div>
                    <div v-else-if="analysis.candidate?.foods !== undefined" class="analysis-result">
                      <p v-if="!analysis.candidate.foods.length" class="field-help">这次没有识别到可记录的食物，可以手工添加或重新识别；原有记录不变。</p>
                      <p v-else-if="contributionForAnalysis(meal, analysis.id)" class="field-help">已按食物计入这餐，可直接改份量或移除。照片估算可能有偏差。</p>
                      <p v-else class="field-help">这顿饭已有记录或曾被修改，识别结果没有覆盖你的内容。</p>
                      <details><summary>查看原始识别结果</summary>
                        <ul class="observed-foods"><li v-for="(food, index) in analysis.candidate.foods" :key="index"><strong>{{ food.label }}</strong><span>{{ food.portionAmount ?? '份量未知' }} {{ food.portionUnit ?? '' }}</span></li></ul>
                        <p class="field-help">{{ analysis.candidate.uncertaintyNote }}</p>
                      </details>
                      <ImageResultReplacement v-if="analysis.candidate.foods.length" :meal="meal" :analysis="analysis" :disabled="saving || actingAnalysisId !== null" @busy="saving = $event" @saved="imageFoodsSaved" @refreshed="imageFoodsRefreshed" />
                      <button v-if="analysis.imageAvailable" type="button" class="text-action" :disabled="saving || actingAnalysisId !== null" @click="retryImageAnalysis(meal.id, analysis)">重新识别这张照片</button>
                      <p v-else class="field-help">原图已不可用，不能重新识别；已保存的结果仍可查看和使用。</p>
                    </div>
                    <details v-else-if="analysis.candidate !== null" class="analysis-result"><summary>旧照片结果与修正</summary>
                      <div class="analysis-observations">
                        <span>识别把握：{{ confidenceLabel(analysis.candidate.confidence) }}</span>
                      </div>
                      <ul v-if="analysis.candidate.observedFoods.length" class="observed-foods">
                        <li v-for="food in analysis.candidate.observedFoods" :key="`${food.label}-${food.estimatedPortion}`"><strong>{{ food.label }}</strong><span>{{ food.estimatedPortion ?? '份量未知' }}</span><small v-if="food.note">{{ food.note }}</small></li>
                      </ul>
                      <p class="uncertainty-note">{{ analysis.candidate.uncertaintyNote }}</p>
                      <ul v-if="analysis.candidate.assumptions.length" class="assumption-list"><li v-for="assumption in analysis.candidate.assumptions" :key="assumption">{{ assumption }}</li></ul>
                      <form v-if="analysis.adoptedAt === null" class="image-adoption-form" @submit.prevent="adoptImageAnalysis(meal, analysis)">
                        <div class="form-row">
                          <label>计入方式<select v-model="imageFormFor(analysis, meal).mode"><option value="whole_meal">作为整餐总量</option><option value="supplement">补充未覆盖项</option></select></label>
                          <label>名称<input v-model="imageFormFor(analysis, meal).label" required /></label>
                          <label>估算基准<input v-model="imageFormFor(analysis, meal).basisDescription" /></label>
                        </div>
                        <div class="form-row nutrient-inputs">
                          <label>能量 kcal<input v-model="imageFormFor(analysis, meal).energyKcal" type="number" min="0" step="any" /></label>
                          <label>蛋白质 g<input v-model="imageFormFor(analysis, meal).proteinGrams" type="number" min="0" step="any" /></label>
                          <label>碳水 g<input v-model="imageFormFor(analysis, meal).carbohydrateGrams" type="number" min="0" step="any" /></label>
                          <label>脂肪 g<input v-model="imageFormFor(analysis, meal).fatGrams" type="number" min="0" step="any" /></label>
                        </div>
                        <div class="form-row form-options">
                          <label class="checkbox-row"><input v-model="imageFormFor(analysis, meal).replaceExisting" type="checkbox" />替代这顿饭当前已有的营养内容</label>
                          <label class="checkbox-row"><input v-model="imageFormFor(analysis, meal).deleteOriginal" type="checkbox" />采用后删除原图</label>
                          <button class="primary-button" type="submit" :disabled="actingAnalysisId === analysis.id">{{ contributionForAnalysis(meal, analysis.id)?.reviewStatus === 'tentative' ? '确认这些数值' : '按这些数值计入' }}</button>
                        </div>
                        <p class="field-help">确认前请检查份量和烹调油。留空表示暂时未知。</p>
                      </form>
                      <p v-else class="form-notice">这份结果已按你确认的数值计入。原始估算仍保留用于追溯。</p>
                    </details>
                  </article>
                </div>
              </section>

          </div>
        </article>
      </section>
    </div>
  </AppShell>
</template>

<style scoped>
.meal-summary { font-size: .9rem; line-height: 1.6; overflow-wrap: anywhere; }
.meal-content { display: grid; gap: .75rem; }
.meal-metadata-form, .contribution-form { padding-block: .75rem; }
fieldset { border: 0; padding: 0; margin: 0; display: grid; gap: .75rem; min-width: 0; }
.nutrition-record-actions { justify-content: flex-start; }
.nutrition-overview { gap: .65rem; padding: 1rem; }
.nutrition-overview .metric-list > div { padding-block: .5rem; }
.nutrition-overview dd { font-size: 1.15rem; }
.nutrition-overview .metric-list > div > span { font-size: .85rem; }
.retained-correction-values { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .75rem; margin: 0; }
.retained-correction-values > div:first-child { grid-column: 1 / -1; }
.retained-correction-values dt { font-size: .85rem; color: var(--color-muted); }
.retained-correction-values dd { margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
.retained-correction-actions { flex-wrap: wrap; justify-content: flex-start; gap: .5rem; }
.retained-correction-actions > button { flex-shrink: 0; max-width: 100%; }
</style>
