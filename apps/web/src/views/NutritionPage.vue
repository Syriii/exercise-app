<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

import { ApiError } from "../api/client";
import { nutritionApi, type ContributionInput, type DietPlan, type DietPlanInput, type FoodSearchResult, type Meal, type MealContribution, type MealContributionMode, type MealImageAnalysis, type NutritionDaySummary, type PersonalFoodTemplate, type PublicFoodSearchResult } from "../api/nutrition";
import { planningApi, type DailyPlanningReference } from "../api/planning";
import AppShell from "../app/AppShell.vue";
import { type AppSection } from "../app/modules";
import { formatFileSize, prepareMealImage, type PreparedMealImage } from "../features/nutrition/image-compression";

interface ContributionForm { mode: MealContributionMode; label: string; portionAmount: string; portionUnit: string; basisDescription: string; energyKcal: string; proteinGrams: string; carbohydrateGrams: string; fatGrams: string; replaceExisting: boolean; saveAsTemplate: boolean; }
interface ImageAdoptionForm { mode: "whole_meal" | "supplement"; label: string; portionAmount: string; portionUnit: string; basisDescription: string; energyKcal: string; proteinGrams: string; carbohydrateGrams: string; fatGrams: string; replaceExisting: boolean; deleteOriginal: boolean; }
interface DietPlanForm { dateFrom: string; dateTo: string; title: string; note: string; entries: Array<{ localDate: string; mealName: string; foodPlan: string; note: string }>; }
const emptyContribution = (): ContributionForm => ({ mode: "item", label: "", portionAmount: "", portionUnit: "g", basisDescription: "", energyKcal: "", proteinGrams: "", carbohydrateGrams: "", fatGrams: "", replaceExisting: false, saveAsTemplate: false });

const route = useRoute();
const router = useRouter();
const selectedDate = ref(typeof route.query.date === "string" ? route.query.date : localDate(new Date()));
const loading = ref(true);
const saving = ref(false);
const coverageSaving = ref(false);
const errorMessage = ref("");
const notice = ref("");
const reference = ref<DailyPlanningReference | null>(null);
const summary = ref<NutritionDaySummary | null>(null);
const meals = ref<Meal[]>([]);
const recentMeals = ref<Meal[]>([]);
const templates = ref<PersonalFoodTemplate[]>([]);
const dietPlans = ref<DietPlan[]>([]);
const editingDietPlanId = ref<string | null>(null);
const dietPlanForm = ref<DietPlanForm | null>(null);
const creatingMeal = ref(false);
const mealNameInput = ref<HTMLInputElement | null>(null);
const quickMealImage = ref<PreparedMealImage | undefined>();
const editingContributionId = ref<string | null>(null);
const mealForm = reactive({ name: "", time: currentTime(), note: "" });
const contributionForms = reactive<Record<string, ContributionForm>>({});
const foodSearchQueries = reactive<Record<string, string>>({});
const foodSearchResults = reactive<Record<string, FoodSearchResult[]>>({});
const publicFoodSearchResults = reactive<Record<string, PublicFoodSearchResult[]>>({});
const publicFoodSearchErrors = reactive<Record<string, string>>({});
const publicFoodPortions = reactive<Record<string, string>>({});
const recentSelections = reactive<Record<string, string[]>>({});
const searchingMealId = ref<string | null>(null);
const quickAddingMealId = ref<string | null>(null);
const managingTemplates = ref(false);
const editingTemplateId = ref<string | null>(null);
const templateForm = ref<ContributionForm | null>(null);
const analysesByMeal = reactive<Record<string, MealImageAnalysis[]>>({});
const imageSelections = ref<Record<string, PreparedMealImage | undefined>>({});
const uploadProgress = reactive<Record<string, number>>({});
const imageForms = reactive<Record<string, ImageAdoptionForm>>({});
const uploadingMealId = ref<string | null>(null);
const actingAnalysisId = ref<string | null>(null);
let pollTimer: number | undefined;
let pollInFlight = false;
let loadGeneration = 0;

function localDate(date: Date): string { const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date).map((part) => [part.type, part.value])); return `${values.year}-${values.month}-${values.day}`; }
function shiftLocalDate(value: string, days: number): string { const date = new Date(`${value}T12:00:00`); date.setDate(date.getDate() + days); return localDate(date); }
function currentTime(): string { return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()); }
function browserTimeZone(): string { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; }
function nullableText(value: string): string | null { const clean = value.trim(); return clean.length === 0 ? null : clean; }
function nullableNumber(value: string | number): number | null { if (typeof value === "number") return value; const clean = value.trim(); return clean.length === 0 ? null : Number(clean); }
function openSection(section: AppSection) { void router.push({ name: section }); }
function formFor(mealId: string): ContributionForm { contributionForms[mealId] ??= emptyContribution(); return contributionForms[mealId]!; }
function contributionInput(form: ContributionForm): ContributionInput { return { mode: form.mode, label: form.label, portionAmount: nullableNumber(form.portionAmount), portionUnit: nullableText(form.portionUnit), basisDescription: nullableText(form.basisDescription), energyKcal: nullableNumber(form.energyKcal), proteinGrams: nullableNumber(form.proteinGrams), carbohydrateGrams: nullableNumber(form.carbohydrateGrams), fatGrams: nullableNumber(form.fatGrams) }; }
function dietPlanInput(form: DietPlanForm): DietPlanInput { return { dateFrom: form.dateFrom, dateTo: form.dateTo, title: form.title, note: nullableText(form.note), entries: form.entries.map((entry) => ({ localDate: nullableText(entry.localDate), mealName: nullableText(entry.mealName), foodPlan: entry.foodPlan, note: nullableText(entry.note) })) }; }
function displayTime(value: string): string { return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
function displayRecentMeal(meal: Meal): string { const date = meal.localDate === shiftLocalDate(selectedDate.value, -1) ? "昨天" : new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(new Date(`${meal.localDate}T12:00:00`)); return `${date} · ${meal.name ?? '未命名餐次'} · ${displayTime(meal.occurredAt)}`; }
function modeLabel(mode: MealContributionMode): string { return mode === "whole_meal" ? "整餐总量" : mode === "supplement" ? "补充项" : "食物"; }
function nutrientText(value: number | null, unit: string): string { return value === null ? "未知" : `${value} ${unit}`; }
function remainingText(value: number | null, unit: string): string { if (value === null) return "—"; return value >= 0 ? `${value} ${unit}` : `超出 ${Math.abs(value)} ${unit}`; }
function contributionForAnalysis(meal: Meal, analysisId: string): MealContribution | undefined { return meal.contributions.find((value) => value.sourceAnalysisId === analysisId); }
function analysisStatus(value: MealImageAnalysis, meal: Meal): string {
  const contribution = contributionForAnalysis(meal, value.id);
  if (contribution?.reviewStatus === "tentative") return "暂定计入";
  if (value.adoptedAt !== null || contribution?.reviewStatus === "confirmed") return "已确认";
  return value.status === "pending" ? "排队中" : value.status === "running" ? "分析中" : value.status === "succeeded" ? "候选待处理" : value.status === "failed" ? "分析失败" : "已取消";
}
function confidenceLabel(value: "low" | "medium" | "high"): string { return value === "high" ? "较高" : value === "medium" ? "一般" : "较低"; }
function imageAnalysisFailureText(code: string | null): string {
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
  const form: ImageAdoptionForm = { mode: current?.mode === "supplement" ? "supplement" : "whole_meal", label: current?.label ?? candidate?.title ?? "照片估算", portionAmount: current?.portionAmount?.toString() ?? "", portionUnit: current?.portionUnit ?? "", basisDescription: current?.basisDescription ?? candidate?.uncertaintyNote ?? "按照片中可见盛取量估算", energyKcal: current?.energyKcal?.toString() ?? candidate?.energyKcal?.toString() ?? "", proteinGrams: current?.proteinGrams?.toString() ?? candidate?.proteinGrams?.toString() ?? "", carbohydrateGrams: current?.carbohydrateGrams?.toString() ?? candidate?.carbohydrateGrams?.toString() ?? "", fatGrams: current?.fatGrams?.toString() ?? candidate?.fatGrams?.toString() ?? "", replaceExisting: current === undefined && meal.contributions.length > 0, deleteOriginal: true };
  imageForms[analysis.id] = form;
  return form;
}

function clearRecord<T>(record: Record<string, T>) {
  for (const key of Object.keys(record)) delete record[key];
}

function resetDateScopedState() {
  reference.value = null;
  summary.value = null;
  meals.value = [];
  recentMeals.value = [];
  dietPlans.value = [];
  editingDietPlanId.value = null;
  dietPlanForm.value = null;
  creatingMeal.value = false;
  quickMealImage.value = undefined;
  editingContributionId.value = null;
  mealForm.name = "";
  mealForm.time = currentTime();
  mealForm.note = "";
  clearRecord(contributionForms);
  clearRecord(foodSearchQueries);
  clearRecord(foodSearchResults);
  clearRecord(publicFoodSearchResults);
  clearRecord(publicFoodSearchErrors);
  clearRecord(publicFoodPortions);
  clearRecord(recentSelections);
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

async function load() {
  const requestedDate = selectedDate.value;
  const generation = ++loadGeneration;
  loading.value = true; errorMessage.value = ""; notice.value = "";
  resetDateScopedState();
  const results = await Promise.allSettled([
      planningApi.getDailyReference(requestedDate, browserTimeZone()), nutritionApi.getDaySummary(requestedDate, browserTimeZone()), nutritionApi.listMeals(requestedDate, requestedDate), nutritionApi.listFoodTemplates(), nutritionApi.listDietPlans(requestedDate, requestedDate), nutritionApi.listMeals(shiftLocalDate(requestedDate, -14), shiftLocalDate(requestedDate, -1)),
  ] as const);
  if (generation !== loadGeneration || selectedDate.value !== requestedDate) return;
  const [referenceResult, summaryResult, mealsResult, templatesResult, dietPlansResult, recentMealsResult] = results;
  if (referenceResult.status === "fulfilled") reference.value = referenceResult.value;
  if (summaryResult.status === "fulfilled") summary.value = summaryResult.value;
  if (templatesResult.status === "fulfilled") templates.value = templatesResult.value;
  if (dietPlansResult.status === "fulfilled") dietPlans.value = dietPlansResult.value;
  if (recentMealsResult.status === "fulfilled") {
    recentMeals.value = recentMealsResult.value
      .map((meal) => ({ ...meal, contributions: meal.contributions.filter((item) => item.mode === "item" && item.reviewStatus === "confirmed") }))
      .filter((meal) => meal.contributions.length > 0)
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
      .slice(0, 8);
  }
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
function startDietPlan(plan?: DietPlan) {
  editingDietPlanId.value = plan?.id ?? null;
  dietPlanForm.value = plan === undefined
    ? { dateFrom: selectedDate.value, dateTo: selectedDate.value, title: "", note: "", entries: [] }
    : { dateFrom: plan.dateFrom, dateTo: plan.dateTo, title: plan.title, note: plan.note ?? "", entries: plan.entries.map((entry) => ({ localDate: entry.localDate ?? "", mealName: entry.mealName ?? "", foodPlan: entry.foodPlan, note: entry.note ?? "" })) };
}
function addDietPlanEntry() { dietPlanForm.value?.entries.push({ localDate: "", mealName: "", foodPlan: "", note: "" }); }
async function saveDietPlan() {
  const form = dietPlanForm.value; if (form === null) return;
  saving.value = true; errorMessage.value = "";
  try {
    const existing = dietPlans.value.find((value) => value.id === editingDietPlanId.value);
    const saved = existing === undefined ? await nutritionApi.createDietPlan(dietPlanInput(form)) : await nutritionApi.updateDietPlan(existing.id, existing.revision, dietPlanInput(form));
    dietPlans.value = existing === undefined ? [saved, ...dietPlans.value] : dietPlans.value.map((value) => value.id === saved.id ? saved : value);
    dietPlanForm.value = null; editingDietPlanId.value = null; notice.value = existing === undefined ? "饮食安排已保存" : "饮食安排已更新";
  } catch (error) { errorMessage.value = error instanceof ApiError ? error.message : "暂时保存不了饮食安排"; }
  finally { saving.value = false; }
}
async function archiveDietPlan(plan: DietPlan) {
  if (!window.confirm(`归档“${plan.title}”？实际饮食记录不会受影响。`)) return;
  saving.value = true;
  try { await nutritionApi.archiveDietPlan(plan.id, plan.revision); dietPlans.value = dietPlans.value.filter((value) => value.id !== plan.id); notice.value = "饮食安排已归档，实际记录没有改变"; }
  catch (error) { errorMessage.value = error instanceof ApiError ? error.message : "暂时归档不了饮食安排"; }
  finally { saving.value = false; }
}

async function openMealComposer() {
  creatingMeal.value = true;
  await nextTick();
  document.querySelector(".quick-meal-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  mealNameInput.value?.focus();
}

function closeMealComposer() {
  creatingMeal.value = false;
  quickMealImage.value = undefined;
}

async function createMeal() {
  if (saving.value) return;
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
  document.getElementById(`meal-${saved.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  try {
    if (selectedImage !== undefined) await uploadMealImage(saved);
  } finally {
    saving.value = false;
  }
}

async function selectQuickMealImage(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file === undefined) {
    quickMealImage.value = undefined;
    return;
  }
  errorMessage.value = "";
  try {
    quickMealImage.value = await prepareMealImage(file);
  } catch (error) {
    console.error("Quick meal image preparation failed", error);
    quickMealImage.value = undefined;
    errorMessage.value = "这张照片暂时无法处理，请换一张 JPEG、PNG 或 WebP 图片。";
  }
}

async function selectMealImage(mealId: string, event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file === undefined) {
    imageSelections.value = { ...imageSelections.value, [mealId]: undefined };
    return;
  }
  errorMessage.value = "";
  try {
    const prepared = await prepareMealImage(file);
    imageSelections.value = { ...imageSelections.value, [mealId]: prepared };
  } catch (error) {
    console.error("Meal image preparation failed", error);
    imageSelections.value = { ...imageSelections.value, [mealId]: undefined };
    errorMessage.value = "这张照片暂时无法处理，请换一张 JPEG、PNG 或 WebP 图片。";
  }
}

async function uploadMealImage(meal: Meal) {
  const selected = imageSelections.value[meal.id];
  if (selected === undefined) { errorMessage.value = "请先选择或拍摄一张餐食照片"; return; }
  uploadingMealId.value = meal.id; errorMessage.value = "";
  uploadProgress[meal.id] = 0;
  try {
    const analysis = await nutritionApi.uploadMealImage(meal.id, selected.file, (percent) => { uploadProgress[meal.id] = percent; });
    analysesByMeal[meal.id] = [analysis, ...(analysesByMeal[meal.id] ?? [])];
    imageSelections.value = { ...imageSelections.value, [meal.id]: undefined };
    notice.value = "照片已上传；没有现有营养值时，分析完成后会先按暂定值计入，之后仍可核对或修正";
  } catch (error) { errorMessage.value = error instanceof ApiError ? error.message : "照片暂时上传不了"; }
  finally { uploadingMealId.value = null; delete uploadProgress[meal.id]; }
}

async function retryImageAnalysis(mealId: string, analysis: MealImageAnalysis) {
  actingAnalysisId.value = analysis.id; errorMessage.value = "";
  try {
    const saved = await nutritionApi.retryImageAnalysis(analysis.id, analysis.revision);
    analysesByMeal[mealId] = (analysesByMeal[mealId] ?? []).map((value) => value.id === saved.id ? saved : value);
    notice.value = "已重新提交分析";
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

async function saveContribution(meal: Meal, existing?: MealContribution) {
  const form = formFor(meal.id); saving.value = true; errorMessage.value = "";
  try {
    const input = contributionInput(form);
    const saved = existing === undefined ? await nutritionApi.addContribution(meal.id, meal.revision, input, form.replaceExisting) : await nutritionApi.updateContribution(meal.id, existing.id, meal.revision, existing.revision, input, form.replaceExisting);
    meals.value = meals.value.map((value) => value.id === saved.id ? saved : value);
    if (form.saveAsTemplate && form.mode === "item") templates.value = sortTemplates([...templates.value, await nutritionApi.createFoodTemplate(input)]);
    contributionForms[meal.id] = emptyContribution(); editingContributionId.value = null; notice.value = existing === undefined ? "这项食物已计入当天剩余量" : "营养记录已修正，旧值仍可追溯"; await refreshSummary();
  } catch (error) { console.error("Nutrition contribution save failed", error); errorMessage.value = error instanceof ApiError ? error.message : "暂时保存不了这条营养记录"; }
  finally { saving.value = false; }
}

function editContribution(meal: Meal, value: MealContribution) { contributionForms[meal.id] = { mode: value.mode, label: value.label, portionAmount: value.portionAmount?.toString() ?? "", portionUnit: value.portionUnit ?? "", basisDescription: value.basisDescription ?? "", energyKcal: value.energyKcal?.toString() ?? "", proteinGrams: value.proteinGrams?.toString() ?? "", carbohydrateGrams: value.carbohydrateGrams?.toString() ?? "", fatGrams: value.fatGrams?.toString() ?? "", replaceExisting: false, saveAsTemplate: false }; editingContributionId.value = value.id; }
function useTemplate(mealId: string, templateId: string) { const value = templates.value.find((item) => item.id === templateId); if (value === undefined) return; contributionForms[mealId] = { mode: "item", label: value.label, portionAmount: value.portionAmount?.toString() ?? "", portionUnit: value.portionUnit ?? "", basisDescription: value.basisDescription ?? "", energyKcal: value.energyKcal?.toString() ?? "", proteinGrams: value.proteinGrams?.toString() ?? "", carbohydrateGrams: value.carbohydrateGrams?.toString() ?? "", fatGrams: value.fatGrams?.toString() ?? "", replaceExisting: false, saveAsTemplate: false }; editingContributionId.value = null; }
function sortTemplates(values: PersonalFoodTemplate[]): PersonalFoodTemplate[] { return [...values].sort((left, right) => left.label.localeCompare(right.label, "zh-CN")); }
function foodSnapshotInput(value: PersonalFoodTemplate | FoodSearchResult | MealContribution): ContributionInput { return { mode: "item", label: value.label, portionAmount: value.portionAmount, portionUnit: value.portionUnit, basisDescription: value.basisDescription, energyKcal: value.energyKcal, proteinGrams: value.proteinGrams, carbohydrateGrams: value.carbohydrateGrams, fatGrams: value.fatGrams }; }
function selectionKey(targetMealId: string, sourceMealId: string): string { return `${targetMealId}:${sourceMealId}`; }
function selectedRecentCount(targetMealId: string, sourceMealId: string): number { return recentSelections[selectionKey(targetMealId, sourceMealId)]?.length ?? 0; }
function isRecentSelected(targetMealId: string, sourceMealId: string, contributionId: string): boolean { return recentSelections[selectionKey(targetMealId, sourceMealId)]?.includes(contributionId) ?? false; }
function toggleRecentSelection(targetMealId: string, sourceMealId: string, contributionId: string, checked: boolean) {
  const key = selectionKey(targetMealId, sourceMealId);
  const current = recentSelections[key] ?? [];
  recentSelections[key] = checked ? [...new Set([...current, contributionId])] : current.filter((id) => id !== contributionId);
}
async function addFoodSnapshot(targetMealId: string, value: PersonalFoodTemplate | FoodSearchResult | MealContribution): Promise<Meal> {
  const current = meals.value.find((meal) => meal.id === targetMealId);
  if (current === undefined) throw new Error("target meal is no longer available");
  const saved = await nutritionApi.addContribution(current.id, current.revision, foodSnapshotInput(value), false);
  meals.value = meals.value.map((meal) => meal.id === saved.id ? saved : meal);
  return saved;
}
async function quickAddFood(meal: Meal, value: PersonalFoodTemplate | FoodSearchResult) {
  if (saving.value) return;
  saving.value = true; quickAddingMealId.value = meal.id; errorMessage.value = "";
  try {
    await addFoodSnapshot(meal.id, value);
    notice.value = `已把“${value.label}”加入这顿饭；需要时可以继续修正份量`;
    try { await refreshSummary(); }
    catch (error) { console.error("Nutrition summary refresh after quick food reuse failed", error); errorMessage.value = "食物已经加入，但当天汇总暂时刷新不了；请不要重复添加，稍后重新打开这一天即可。"; }
  } catch (error) { errorMessage.value = error instanceof ApiError ? error.message : "暂时加入不了这项食物"; }
  finally { saving.value = false; quickAddingMealId.value = null; }
}
async function addRecentFoods(targetMeal: Meal, sourceMeal: Meal) {
  if (saving.value) return;
  const key = selectionKey(targetMeal.id, sourceMeal.id);
  const selectedIds = recentSelections[key] ?? [];
  const selected = sourceMeal.contributions.filter((item) => selectedIds.includes(item.id));
  if (selected.length === 0) return;
  saving.value = true; quickAddingMealId.value = targetMeal.id; errorMessage.value = "";
  let added = 0;
  try {
    for (const item of selected) {
      await addFoodSnapshot(targetMeal.id, item);
      added += 1;
      recentSelections[key] = (recentSelections[key] ?? []).filter((id) => id !== item.id);
    }
    notice.value = `已从“${sourceMeal.name ?? '最近一餐'}”加入 ${added} 项，可以继续补充今天不同的食物`;
  } catch (error) {
    const detail = error instanceof ApiError ? error.message : "暂时加入不了剩余食物";
    errorMessage.value = added === 0 ? detail : `已成功加入 ${added} 项；其余项目仍保持选中。${detail}`;
  } finally {
    if (added > 0) {
      try { await refreshSummary(); }
      catch (error) { console.error("Nutrition summary refresh after recent food reuse failed", error); errorMessage.value ||= "食物已经加入，但当天汇总暂时刷新不了；请不要重复添加。"; }
    }
    saving.value = false; quickAddingMealId.value = null;
  }
}
function startTemplateEdit(value: PersonalFoodTemplate) {
  editingTemplateId.value = value.id;
  templateForm.value = { mode: "item", label: value.label, portionAmount: value.portionAmount?.toString() ?? "", portionUnit: value.portionUnit ?? "", basisDescription: value.basisDescription ?? "", energyKcal: value.energyKcal?.toString() ?? "", proteinGrams: value.proteinGrams?.toString() ?? "", carbohydrateGrams: value.carbohydrateGrams?.toString() ?? "", fatGrams: value.fatGrams?.toString() ?? "", replaceExisting: false, saveAsTemplate: false };
}
function cancelTemplateEdit() { editingTemplateId.value = null; templateForm.value = null; }
async function saveFoodTemplate(value: PersonalFoodTemplate) {
  if (templateForm.value === null || saving.value) return;
  saving.value = true; errorMessage.value = "";
  try {
    const saved = await nutritionApi.updateFoodTemplate(value.id, value.revision, contributionInput(templateForm.value));
    templates.value = sortTemplates(templates.value.map((item) => item.id === saved.id ? saved : item));
    cancelTemplateEdit(); notice.value = "常用食物已更新；以前的餐食记录没有改变";
  } catch (error) { errorMessage.value = error instanceof ApiError ? error.message : "暂时更新不了这个常用食物"; }
  finally { saving.value = false; }
}
async function removeFoodTemplate(value: PersonalFoodTemplate) {
  if (!window.confirm(`删除常用食物“${value.label}”？已经加入历史餐食的记录不会改变。`)) return;
  saving.value = true; errorMessage.value = "";
  try {
    await nutritionApi.deleteFoodTemplate(value.id, value.revision);
    templates.value = templates.value.filter((item) => item.id !== value.id);
    for (const mealId of Object.keys(foodSearchResults)) foodSearchResults[mealId] = (foodSearchResults[mealId] ?? []).filter((item) => item.id !== `template:${value.id}`);
    if (editingTemplateId.value === value.id) cancelTemplateEdit();
    notice.value = "常用食物已删除；历史餐食保持不变";
  } catch (error) { errorMessage.value = error instanceof ApiError ? error.message : "暂时删除不了这个常用食物"; }
  finally { saving.value = false; }
}
function publicFoodKey(mealId: string, resultId: string): string { return `${mealId}:${resultId}`; }
function scaledNutrient(value: number | null, factor: number): string { return value === null ? "" : (Math.round(value * factor * 10) / 10).toString(); }
function usePublicFoodResult(mealId: string, value: PublicFoodSearchResult) {
  const grams = Number(publicFoodPortions[publicFoodKey(mealId, value.id)] ?? "100");
  if (!Number.isFinite(grams) || grams <= 0 || grams > 10_000) { errorMessage.value = "实际重量需要填写 0–10000 g 之间的数字"; return; }
  const factor = grams / value.basisAmount;
  const displayLabel = (value.brand === null ? value.label : `${value.label}（${value.brand}）`).slice(0, 100);
  contributionForms[mealId] = {
    mode: "item",
    label: displayLabel,
    portionAmount: grams.toString(),
    portionUnit: "g",
    basisDescription: `Open Food Facts · 每 100 g · 条码 ${value.barcode} · 按 ${grams} g 换算；社区数据，请核对包装标签`,
    energyKcal: scaledNutrient(value.energyKcal, factor),
    proteinGrams: scaledNutrient(value.proteinGrams, factor),
    carbohydrateGrams: scaledNutrient(value.carbohydrateGrams, factor),
    fatGrams: scaledNutrient(value.fatGrams, factor),
    replaceExisting: false,
    saveAsTemplate: false,
  };
  editingContributionId.value = null;
  errorMessage.value = "";
  notice.value = `已按 ${grams} g 换算“${value.label}”，请核对包装标签后再计入`;
}
async function searchFoods(mealId: string) {
  if (searchingMealId.value !== null) return;
  const query = (foodSearchQueries[mealId] ?? "").trim();
  searchingMealId.value = mealId; errorMessage.value = ""; publicFoodSearchErrors[mealId] = "";
  const [personalResult, publicResult] = await Promise.allSettled([
    nutritionApi.searchFoods(query, selectedDate.value),
    query.length >= 2 ? nutritionApi.searchPublicFoods(query) : Promise.resolve([] as PublicFoodSearchResult[]),
  ]);
  if (personalResult.status === "fulfilled") foodSearchResults[mealId] = personalResult.value;
  else { foodSearchResults[mealId] = []; errorMessage.value = personalResult.reason instanceof ApiError ? personalResult.reason.message : "暂时搜索不了个人记录"; }
  if (publicResult.status === "fulfilled") {
    publicFoodSearchResults[mealId] = publicResult.value;
    for (const result of publicResult.value) publicFoodPortions[publicFoodKey(mealId, result.id)] ??= "100";
  } else {
    publicFoodSearchResults[mealId] = [];
    publicFoodSearchErrors[mealId] = publicResult.reason instanceof ApiError ? publicResult.reason.message : "公开包装食品暂时搜索不了；个人记录和手工录入仍可使用。";
  }
  if (query.length > 0 && query.length < 2) publicFoodSearchErrors[mealId] = "至少输入 2 个字符，才会同时搜索公开包装食品。";
  searchingMealId.value = null;
}
function useFoodSearchResult(mealId: string, value: FoodSearchResult) { contributionForms[mealId] = { mode: "item", label: value.label, portionAmount: value.portionAmount?.toString() ?? "", portionUnit: value.portionUnit ?? "", basisDescription: value.basisDescription ?? "", energyKcal: value.energyKcal?.toString() ?? "", proteinGrams: value.proteinGrams?.toString() ?? "", carbohydrateGrams: value.carbohydrateGrams?.toString() ?? "", fatGrams: value.fatGrams?.toString() ?? "", replaceExisting: false, saveAsTemplate: false }; editingContributionId.value = null; notice.value = `已带入“${value.label}”，确认份量和营养后再计入`; }
async function deleteContribution(meal: Meal, value: MealContribution) { if (!window.confirm(`从当前汇总中移除“${value.label}”？旧值仍保留在修订记录中。`)) return; saving.value = true; try { const saved = await nutritionApi.deleteContribution(meal.id, value.id, meal.revision, value.revision); meals.value = meals.value.map((item) => item.id === saved.id ? saved : item); await refreshSummary(); notice.value = "这项内容已从当前汇总移除"; } catch (error) { errorMessage.value = error instanceof ApiError ? error.message : "暂时移除不了这项内容"; } finally { saving.value = false; } }
async function deleteMeal(meal: Meal) { if (!window.confirm("删除整顿饭？它会从当天汇总中排除。")) return; saving.value = true; try { await nutritionApi.deleteMeal(meal.id, meal.revision); meals.value = meals.value.filter((value) => value.id !== meal.id); delete analysesByMeal[meal.id]; await refreshSummary(); notice.value = "这顿饭已从当前汇总中排除"; } catch (error) { errorMessage.value = error instanceof ApiError ? error.message : "暂时删除不了这顿饭"; } finally { saving.value = false; } }
async function refreshSummary(expectedDate = selectedDate.value) {
  const refreshed = await nutritionApi.getDaySummary(expectedDate, browserTimeZone());
  if (selectedDate.value === expectedDate) summary.value = refreshed;
}
async function setCoverage(event: Event) {
  const confirmed = (event.target as HTMLInputElement).checked;
  const expectedDate = selectedDate.value;
  coverageSaving.value = true;
  errorMessage.value = "";
  try {
    await nutritionApi.setCoverage(expectedDate, confirmed);
    if (selectedDate.value === expectedDate && summary.value?.localDate === expectedDate) {
      summary.value = { ...summary.value, coverageConfirmed: confirmed };
    }
  } catch (error) {
    if (selectedDate.value === expectedDate) {
      errorMessage.value = error instanceof ApiError ? error.message : "暂时保存不了全天覆盖状态";
    }
  } finally {
    coverageSaving.value = false;
  }
}

async function handleRequestedAction() {
  if (route.query.action !== "new-meal") return;
  await openMealComposer();
  await router.replace({ name: "nutrition", query: selectedDate.value === localDate(new Date()) ? {} : { date: selectedDate.value } });
}

watch(() => route.query.date, (value) => { const next = typeof value === "string" ? value : localDate(new Date()); if (next !== selectedDate.value) { selectedDate.value = next; void load(); } });
watch(() => route.query.action, () => { void handleRequestedAction(); });
onMounted(async () => { await load(); await handleRequestedAction(); pollTimer = window.setInterval(() => void pollImageAnalyses(), 2_000); });
onBeforeUnmount(() => { if (pollTimer !== undefined) window.clearInterval(pollTimer); });
</script>

<template>
  <AppShell page-class="nutrition-page" rail-note="记录每一餐，随时看今天还可以吃多少。">
        <header class="view-header"><div><p class="date-line">按天记录</p><h1>饮食</h1><p>记录每一餐，查看当天剩余。</p></div><nav class="view-header-actions nutrition-header-actions" aria-label="饮食快捷操作"><button class="action-button action-button--primary" type="button" @click="openMealComposer">快速记餐</button><label class="date-picker">查看日期<input v-model="selectedDate" type="date" :disabled="saving || coverageSaving || uploadingMealId !== null || actingAnalysisId !== null" @change="changeDate" /></label></nav></header>
        <p v-if="errorMessage" class="form-error" role="alert">{{ errorMessage }}</p><p v-if="notice" class="form-notice" role="status">{{ notice }}</p>
        <section v-if="loading" class="work-panel training-empty"><strong>正在读取这一天…</strong></section>
        <div v-else class="view-stack">
          <section v-if="creatingMeal" class="work-panel quick-meal-panel" aria-labelledby="quick-meal-title">
            <div class="panel-heading"><div><h2 id="quick-meal-title">快速记餐</h2><p>可以直接拍照，也可以先建立餐次后手工填写。</p></div><button class="text-action" type="button" @click="closeMealComposer">取消</button></div>
            <form class="inline-form meal-create-form" @submit.prevent="createMeal">
              <label>餐次名称（可选）<input ref="mealNameInput" v-model="mealForm.name" placeholder="例如：午饭" /></label>
              <label>用餐时间<input v-model="mealForm.time" type="time" required /></label>
              <label>备注（可选）<input v-model="mealForm.note" placeholder="例如：食堂二楼或少吃了一半" /></label>
              <label class="quick-meal-photo"><span>餐食照片（可选）</span><input type="file" accept="image/jpeg,image/png,image/gif,image/webp" capture="environment" @change="selectQuickMealImage" /><small v-if="quickMealImage">{{ quickMealImage.file.name }} · <template v-if="quickMealImage.compressed">已压缩 {{ formatFileSize(quickMealImage.originalBytes) }} → {{ formatFileSize(quickMealImage.uploadBytes) }}</template><template v-else>保持原图 {{ formatFileSize(quickMealImage.uploadBytes) }}</template></small><small v-else>食堂餐可以在这里直接拍照</small></label>
              <button class="primary-button" :disabled="saving || uploadingMealId !== null" type="submit">{{ quickMealImage ? '建立餐次并上传' : '建立餐次' }}</button>
            </form>
          </section>
          <section class="recommendation-panel" aria-labelledby="daily-reference-title">
            <div class="panel-heading"><div><h2 id="daily-reference-title">系统参考</h2><p>{{ selectedDate }} · 按个人档案、目标和日常活动计算</p></div><button class="text-action" type="button" @click="openSection('settings')">档案与策略 →</button></div>
            <dl class="metric-list"><div><dt>能量</dt><dd>{{ reference?.result.targetEnergyKcal ?? '—' }}<small> kcal</small></dd></div><div><dt>蛋白质</dt><dd>{{ reference?.result.proteinGrams ?? '—' }}<small> g</small></dd></div><div><dt>碳水</dt><dd>{{ reference?.result.carbohydrateGrams ?? '—' }}<small> g</small></dd></div><div><dt>脂肪</dt><dd>{{ reference?.result.fatGrams ?? '—' }}<small> g</small></dd></div></dl>
            <p v-if="reference?.result.status !== 'ready'" class="field-help">补充出生日期、性别、身高和体重后生成参考。</p>
            <div v-else class="reference-messages"><p v-for="message in reference.result.messages" :key="message">{{ message }}</p></div>
            <details v-if="reference" class="reference-details"><summary>计算依据</summary><p>方法 {{ reference.methodVersion }}</p><p v-for="limitation in reference.result.limitations" :key="limitation">{{ limitation }}</p></details>
          </section>
          <section class="work-panel diet-plan-panel" aria-labelledby="diet-plan-title">
            <div class="panel-heading"><div><h2 id="diet-plan-title">我的饮食安排</h2><p>提前写下准备怎么吃，实际摄入仍以餐食记录为准。</p></div><button class="action-button" type="button" @click="dietPlanForm === null ? startDietPlan() : (dietPlanForm = null)">{{ dietPlanForm === null ? '新建安排' : '取消' }}</button></div>
            <form v-if="dietPlanForm" class="diet-plan-form" @submit.prevent="saveDietPlan">
              <div class="field-grid"><label><span>名称</span><input v-model="dietPlanForm.title" required maxlength="100" placeholder="例如：这周食堂安排" /></label><label><span>开始日期</span><input v-model="dietPlanForm.dateFrom" type="date" required /></label><label><span>结束日期</span><input v-model="dietPlanForm.dateTo" type="date" required /></label></div>
              <label><span>整体原则（可选）</span><textarea v-model="dietPlanForm.note" maxlength="1000" placeholder="例如：优先清淡做法，每餐先找蔬菜"></textarea></label>
              <div v-if="dietPlanForm.entries.length" class="diet-plan-entries"><article v-for="(entry, index) in dietPlanForm.entries" :key="index"><div class="field-grid"><label><span>指定日期（留空表示整个范围）</span><input v-model="entry.localDate" type="date" :min="dietPlanForm.dateFrom" :max="dietPlanForm.dateTo" /></label><label><span>餐次（可选）</span><input v-model="entry.mealName" maxlength="50" placeholder="例如：午饭" /></label></div><label><span>准备怎么吃</span><input v-model="entry.foodPlan" required maxlength="500" placeholder="例如：米饭半份、鸡腿一份、青菜一份" /></label><label><span>备注（可选）</span><input v-model="entry.note" maxlength="300" /></label><button class="text-action danger-text" type="button" @click="dietPlanForm.entries.splice(index, 1)">移除这条</button></article></div>
              <div class="form-actions"><button class="text-action" type="button" @click="addDietPlanEntry">添加餐次或食物安排 →</button><button class="primary-button" type="submit" :disabled="saving">保存饮食安排</button></div>
            </form>
            <div v-if="dietPlans.length" class="diet-plan-list"><article v-for="plan in dietPlans" :key="plan.id"><header><div><strong>{{ plan.title }}</strong><span>{{ plan.dateFrom === plan.dateTo ? plan.dateFrom : `${plan.dateFrom} 至 ${plan.dateTo}` }}</span></div><span class="row-actions"><button class="text-action" type="button" @click="startDietPlan(plan)">编辑</button><button class="text-action danger-text" type="button" @click="archiveDietPlan(plan)">归档</button></span></header><p v-if="plan.note">{{ plan.note }}</p><ul v-if="plan.entries.filter((entry) => entry.localDate === null || entry.localDate === selectedDate).length"><li v-for="entry in plan.entries.filter((value) => value.localDate === null || value.localDate === selectedDate)" :key="entry.id"><strong>{{ entry.mealName ?? (entry.localDate === null ? '范围内原则' : '当天安排') }}</strong><span>{{ entry.foodPlan }}</span><small v-if="entry.note">{{ entry.note }}</small></li></ul><small v-else>这份计划覆盖今天，但没有为今天单列餐次；可按整体原则执行。</small></article></div>
            <p v-else-if="dietPlanForm === null" class="empty-copy">今天没有适用的饮食安排。</p>
          </section>
          <section class="balance-panel" aria-labelledby="remaining-title"><div class="panel-heading"><div><h2 id="remaining-title">还可以吃</h2><p>系统参考减去当前记录，负数表示已经超出。</p></div><span class="status-chip">{{ summary?.coverageConfirmed ? '全天已记全' : meals.length === 0 ? '尚未记餐' : '可能未记全' }}</span></div><dl class="metric-list"><div><dt>能量</dt><dd>{{ remainingText(summary?.energyKcal.remaining ?? null, 'kcal') }}</dd><span>{{ meals.length === 0 ? '尚未记录餐食' : `已记录 ${nutrientText(summary?.energyKcal.recorded ?? null, 'kcal')} · ${summary?.energyKcal.complete ? '数值完整' : '有未知值'}` }}</span></div><div><dt>蛋白质</dt><dd>{{ remainingText(summary?.proteinGrams.remaining ?? null, 'g') }}</dd><span>{{ meals.length === 0 ? '尚未记录餐食' : `已记录 ${nutrientText(summary?.proteinGrams.recorded ?? null, 'g')} · ${summary?.proteinGrams.complete ? '数值完整' : '有未知值'}` }}</span></div><div><dt>碳水</dt><dd>{{ remainingText(summary?.carbohydrateGrams.remaining ?? null, 'g') }}</dd><span>{{ meals.length === 0 ? '尚未记录餐食' : `已记录 ${nutrientText(summary?.carbohydrateGrams.recorded ?? null, 'g')} · ${summary?.carbohydrateGrams.complete ? '数值完整' : '有未知值'}` }}</span></div><div><dt>脂肪</dt><dd>{{ remainingText(summary?.fatGrams.remaining ?? null, 'g') }}</dd><span>{{ meals.length === 0 ? '尚未记录餐食' : `已记录 ${nutrientText(summary?.fatGrams.recorded ?? null, 'g')} · ${summary?.fatGrams.complete ? '数值完整' : '有未知值'}` }}</span></div></dl><label class="checkbox-row"><input type="checkbox" :checked="summary?.coverageConfirmed" :disabled="coverageSaving" @change="setCoverage" />今天吃过的内容都已记录</label></section>
          <section class="work-panel meal-log" aria-labelledby="meal-log-title"><div class="panel-heading"><div><h2 id="meal-log-title">这一天吃了什么</h2><p>{{ meals.length === 0 ? '还没有餐食记录。' : `共 ${meals.length} 顿；每项营养都可以留空未知。` }}</p></div><button class="action-button" type="button" @click="openMealComposer">记一顿</button></div>
            <section v-if="templates.length" class="food-template-manager" aria-label="管理我的常用食物">
              <div class="panel-heading"><div><strong>我的常用食物 · {{ templates.length }} 项</strong><p>修改或删除模板不会改变已经记录的餐食。</p></div><button class="text-action" type="button" @click="managingTemplates = !managingTemplates">{{ managingTemplates ? '收起管理' : '管理常用食物' }}</button></div>
              <ul v-if="managingTemplates" class="template-manager-list">
                <li v-for="item in templates" :key="item.id">
                  <form v-if="editingTemplateId === item.id && templateForm" class="template-edit-form" @submit.prevent="saveFoodTemplate(item)">
                    <div class="form-row"><label>名称<input v-model="templateForm.label" required /></label><label>份量<input v-model="templateForm.portionAmount" type="number" min="0" step="any" /></label><label>单位<input v-model="templateForm.portionUnit" /></label><label>估算基准<input v-model="templateForm.basisDescription" /></label></div>
                    <div class="form-row nutrient-inputs"><label>能量 kcal<input v-model="templateForm.energyKcal" type="number" min="0" step="any" /></label><label>蛋白质 g<input v-model="templateForm.proteinGrams" type="number" min="0" step="any" /></label><label>碳水 g<input v-model="templateForm.carbohydrateGrams" type="number" min="0" step="any" /></label><label>脂肪 g<input v-model="templateForm.fatGrams" type="number" min="0" step="any" /></label></div>
                    <span class="row-actions"><button class="primary-button" type="submit" :disabled="saving">保存常用食物</button><button class="text-action" type="button" @click="cancelTemplateEdit">取消</button></span>
                  </form>
                  <template v-else><div><strong>{{ item.label }}</strong><span>{{ item.portionAmount ?? '份量未知' }} {{ item.portionUnit ?? '' }} · {{ nutrientText(item.energyKcal, 'kcal') }}</span></div><span class="row-actions"><button class="text-action" type="button" @click="startTemplateEdit(item)">编辑</button><button class="text-action danger-text" type="button" @click="removeFoodTemplate(item)">删除</button></span></template>
                </li>
              </ul>
            </section>
            <article v-for="meal in meals" :id="`meal-${meal.id}`" :key="meal.id" class="meal-card"><header><div><strong>{{ meal.name ?? '未命名餐次' }}</strong><span>{{ displayTime(meal.occurredAt) }}</span></div><button class="text-action danger-text" type="button" @click="deleteMeal(meal)">删除整顿</button></header>
              <section class="meal-quick-add" :aria-labelledby="`quick-add-${meal.id}`">
                <div class="meal-quick-add__heading"><div><strong :id="`quick-add-${meal.id}`">快速添加食物</strong><span>常用食物可直接加入；最近餐食可以只选其中相同的部分。</span></div></div>
                <div v-if="templates.length" class="quick-food-group">
                  <strong>我的常用食物</strong>
                  <ul class="quick-food-list">
                    <li v-for="item in templates" :key="item.id"><div><strong>{{ item.label }}</strong><small>{{ item.portionAmount ?? '份量未知' }} {{ item.portionUnit ?? '' }} · {{ nutrientText(item.energyKcal, 'kcal') }}</small></div><span class="row-actions"><button class="text-action" type="button" :aria-label="`直接加入${item.label}`" :disabled="quickAddingMealId === meal.id" @click="quickAddFood(meal, item)">直接加入</button><button class="text-action" type="button" :aria-label="`调整后加入${item.label}`" @click="useTemplate(meal.id, item.id)">调整后加入</button></span></li>
                  </ul>
                </div>
                <div v-if="recentMeals.length" class="recent-meal-group">
                  <div><strong>从最近一餐选择</strong><span>只勾选今天仍然相同的食物。</span></div>
                  <details v-for="(sourceMeal, sourceIndex) in recentMeals" :key="sourceMeal.id" class="recent-meal-card" :open="sourceIndex === 0">
                    <summary><strong>{{ displayRecentMeal(sourceMeal) }}</strong><small>{{ sourceMeal.contributions.length }} 项可复用</small></summary>
                    <ul>
                      <li v-for="item in sourceMeal.contributions" :key="item.id"><label><input type="checkbox" :checked="isRecentSelected(meal.id, sourceMeal.id, item.id)" @change="toggleRecentSelection(meal.id, sourceMeal.id, item.id, ($event.target as HTMLInputElement).checked)" /><span><strong>{{ item.label }}</strong><small>{{ item.portionAmount ?? '份量未知' }} {{ item.portionUnit ?? '' }} · {{ nutrientText(item.energyKcal, 'kcal') }}</small></span></label></li>
                    </ul>
                    <button class="action-button" type="button" :disabled="selectedRecentCount(meal.id, sourceMeal.id) === 0 || quickAddingMealId === meal.id" @click="addRecentFoods(meal, sourceMeal)">加入选中的 {{ selectedRecentCount(meal.id, sourceMeal.id) }} 项</button>
                  </details>
                </div>
                <p v-if="templates.length === 0 && recentMeals.length === 0" class="empty-copy">还没有可复用的食物；先在下方录入一项，并勾选保存为常用食物。</p>
              </section>
              <section class="meal-image-panel" :aria-labelledby="`meal-image-${meal.id}`">
                <div class="meal-image-panel__heading">
                  <div>
                    <strong :id="`meal-image-${meal.id}`">拍照估算</strong>
                    <span>分析结果可以先预览，确认后再计入当天。</span>
                  </div>
                  <span class="status-chip">原图采用后可删除</span>
                </div>
                <div class="image-upload-row">
                  <label class="file-picker">
                    <span>拍照或选图</span>
                    <input type="file" accept="image/jpeg,image/png,image/gif,image/webp" capture="environment" @change="selectMealImage(meal.id, $event)" />
                  </label>
                  <span class="selected-file"><template v-if="imageSelections[meal.id]">{{ imageSelections[meal.id]!.file.name }} · <template v-if="imageSelections[meal.id]!.compressed">已压缩 {{ formatFileSize(imageSelections[meal.id]!.originalBytes) }} → {{ formatFileSize(imageSelections[meal.id]!.uploadBytes) }}</template><template v-else>保持原图 {{ formatFileSize(imageSelections[meal.id]!.uploadBytes) }}</template></template><template v-else>还没有选择照片</template></span>
                  <button class="action-button" type="button" :disabled="uploadingMealId === meal.id" @click="uploadMealImage(meal)">{{ uploadingMealId === meal.id ? '正在上传…' : '上传并分析' }}</button>
                </div>
                <div v-if="uploadingMealId === meal.id" class="upload-progress" role="status"><progress max="100" :value="uploadProgress[meal.id] ?? 0"></progress><span>已上传 {{ uploadProgress[meal.id] ?? 0 }}%</span></div>
                <div v-if="(analysesByMeal[meal.id] ?? []).length" class="image-analysis-list">
                  <article v-for="analysis in analysesByMeal[meal.id] ?? []" :key="analysis.id" class="image-analysis-card">
                    <header>
                      <div><strong>{{ analysis.candidate?.title ?? '餐食照片' }}</strong><span>{{ analysisStatus(analysis, meal) }}</span></div>
                      <span class="status-chip" :data-tone="analysis.status === 'failed' ? 'danger' : analysis.status === 'succeeded' ? 'accent' : undefined">{{ analysisStatus(analysis, meal) }}</span>
                    </header>
                    <p v-if="analysis.status === 'pending' || analysis.status === 'running'" class="field-help">正在分析，可以稍后回来查看。</p>
                    <div v-else-if="analysis.status === 'failed'" class="analysis-failure">
                      <p>{{ imageAnalysisFailureText(analysis.lastErrorCode) }}</p>
                      <button class="action-button" type="button" :disabled="actingAnalysisId === analysis.id" @click="retryImageAnalysis(meal.id, analysis)">重新分析</button>
                    </div>
                    <div v-else-if="analysis.candidate !== null" class="analysis-result">
                      <div class="analysis-observations">
                        <span>识别把握：{{ confidenceLabel(analysis.candidate.confidence) }}</span>
                        <span>模型：{{ analysis.model }}</span>
                        <span>规则：{{ analysis.promptVersion }}</span>
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
                    </div>
                  </article>
                </div>
              </section>
              <ul v-if="meal.contributions.length" class="meal-items"><li v-for="item in meal.contributions" :key="item.id"><div><strong>{{ item.label }}</strong><span>{{ modeLabel(item.mode) }} · {{ item.portionAmount ?? '份量未知' }} {{ item.portionUnit ?? '' }} · {{ item.reviewStatus === 'tentative' ? '照片估算，待确认' : '已确认' }}</span><small>{{ nutrientText(item.energyKcal, 'kcal') }} · 蛋白质 {{ nutrientText(item.proteinGrams, 'g') }} · 碳水 {{ nutrientText(item.carbohydrateGrams, 'g') }} · 脂肪 {{ nutrientText(item.fatGrams, 'g') }}</small></div><span class="row-actions"><button class="text-action" type="button" @click="editContribution(meal, item)">{{ item.reviewStatus === 'tentative' ? '核对并确认' : '修正' }}</button><button class="text-action danger-text" type="button" @click="deleteContribution(meal, item)">{{ item.reviewStatus === 'tentative' ? '拒绝' : '移除' }}</button></span></li></ul><p v-else class="empty-copy">还没有填写这顿饭吃了什么。</p>
              <section class="meal-food-search" :aria-labelledby="`food-search-${meal.id}`">
                <div><strong :id="`food-search-${meal.id}`">搜索个人记录和公开包装食品</strong><span>个人常用与最近 90 天记录优先；输入至少 2 个字符后，也会搜索公开包装食品。</span></div>
                <form class="food-search-row" @submit.prevent="searchFoods(meal.id)">
                  <label><span>食物或菜名</span><input v-model="foodSearchQueries[meal.id]" placeholder="留空查看最近使用" /></label>
                  <button class="action-button" type="submit" :disabled="searchingMealId === meal.id">{{ searchingMealId === meal.id ? '搜索中…' : '搜索' }}</button>
                </form>
                <div v-if="foodSearchResults[meal.id]?.length" class="food-search-group">
                  <strong>我的个人记录</strong>
                  <ul class="food-results">
                  <li v-for="result in foodSearchResults[meal.id]" :key="result.id">
                    <div><strong>{{ result.label }}</strong><span>{{ result.source === 'personal_template' ? '我的常用' : '最近吃过' }} · {{ result.portionAmount ?? '份量未知' }} {{ result.portionUnit ?? '' }}</span><small>{{ nutrientText(result.energyKcal, 'kcal') }} · 蛋白质 {{ nutrientText(result.proteinGrams, 'g') }} · 碳水 {{ nutrientText(result.carbohydrateGrams, 'g') }} · 脂肪 {{ nutrientText(result.fatGrams, 'g') }}</small></div>
                    <span class="row-actions"><button class="text-action" type="button" @click="quickAddFood(meal, result)">直接加入</button><button class="text-action" type="button" @click="useFoodSearchResult(meal.id, result)">调整后加入</button></span>
                  </li>
                  </ul>
                </div>
                <p v-else-if="foodSearchResults[meal.id]" class="empty-copy">没有匹配的个人记录；公开结果、手工填写和拍照估算仍可继续使用。</p>
                <section v-if="publicFoodSearchResults[meal.id]?.length" class="food-search-group public-food-search" aria-label="公开包装食品结果">
                  <div class="public-food-heading"><div><strong>公开包装食品</strong><span>每项先按每 100 g 展示；填写实际重量后换算到录入表单。</span></div><a href="https://world.openfoodfacts.org/" target="_blank" rel="noreferrer">Open Food Facts · ODbL</a></div>
                  <p class="field-help">数据由社区贡献，可能缺失或不准确。计入前请核对包装标签；搜索词会发送给 Open Food Facts，不包含账号信息。</p>
                  <ul class="food-results public-food-results">
                    <li v-for="result in publicFoodSearchResults[meal.id]" :key="result.id">
                      <div><strong>{{ result.label }}</strong><span>{{ result.brand ?? '品牌未知' }} · 每 100 g · 条码 {{ result.barcode }}</span><small>{{ nutrientText(result.energyKcal, 'kcal') }} · 蛋白质 {{ nutrientText(result.proteinGrams, 'g') }} · 碳水 {{ nutrientText(result.carbohydrateGrams, 'g') }} · 脂肪 {{ nutrientText(result.fatGrams, 'g') }}</small><a :href="result.sourceUrl" target="_blank" rel="noreferrer">查看来源记录</a></div>
                      <div class="public-food-actions"><label><span>实际重量（g）</span><input v-model="publicFoodPortions[publicFoodKey(meal.id, result.id)]" type="number" min="0.1" max="10000" step="any" :aria-label="`${result.label}实际重量（g）`" /></label><button class="text-action" type="button" @click="usePublicFoodResult(meal.id, result)">按这个重量带入</button></div>
                    </li>
                  </ul>
                </section>
                <p v-else-if="foodSearchResults[meal.id] && (foodSearchQueries[meal.id] ?? '').trim().length >= 2 && !publicFoodSearchErrors[meal.id]" class="empty-copy">公开包装食品中没有带可用营养数据的匹配结果。</p>
                <p v-if="publicFoodSearchErrors[meal.id]" class="inline-warning" role="status">{{ publicFoodSearchErrors[meal.id] }}</p>
              </section>
              <form class="contribution-form" @submit.prevent="saveContribution(meal, meal.contributions.find((item) => item.id === editingContributionId))">
                <div class="form-row"><label>录入方式<select v-model="formFor(meal.id).mode"><option value="item">单个食物</option><option value="whole_meal">整餐总量</option><option value="supplement">补充未覆盖项</option></select></label><label v-if="templates.length">我的常用项<select value="" @change="useTemplate(meal.id, ($event.target as HTMLSelectElement).value)"><option value="">选择后带入</option><option v-for="item in templates" :key="item.id" :value="item.id">{{ item.label }}</option></select></label><label>名称<input v-model="formFor(meal.id).label" required placeholder="例如：米饭" /></label></div>
                <div class="form-row"><label>份量<input v-model="formFor(meal.id).portionAmount" type="number" min="0" step="any" /></label><label>单位<input v-model="formFor(meal.id).portionUnit" placeholder="g / 碗 / 份" /></label><label>估算基准<input v-model="formFor(meal.id).basisDescription" placeholder="例如：食堂一碗" /></label></div>
                <div class="form-row nutrient-inputs"><label>能量 kcal<input v-model="formFor(meal.id).energyKcal" type="number" min="0" step="any" /></label><label>蛋白质 g<input v-model="formFor(meal.id).proteinGrams" type="number" min="0" step="any" /></label><label>碳水 g<input v-model="formFor(meal.id).carbohydrateGrams" type="number" min="0" step="any" /></label><label>脂肪 g<input v-model="formFor(meal.id).fatGrams" type="number" min="0" step="any" /></label></div>
                <div class="form-row form-options"><label class="checkbox-row"><input v-model="formFor(meal.id).replaceExisting" type="checkbox" />替代这顿饭当前已有的全部营养内容</label><label v-if="formFor(meal.id).mode === 'item' && editingContributionId === null" class="checkbox-row"><input v-model="formFor(meal.id).saveAsTemplate" type="checkbox" />保存到“我的常用项”</label><button class="primary-button" :disabled="saving" type="submit">{{ editingContributionId ? '保存修正' : '计入这顿饭' }}</button></div>
                <p class="field-help">至少填写一项营养值。整餐总量与逐项食物不能同时计入，切换时请勾选“替代”。</p>
              </form>
            </article>
          </section>
        </div>
  </AppShell>
</template>
