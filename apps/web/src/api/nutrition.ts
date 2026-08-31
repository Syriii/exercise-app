import { apiRequest, uploadBinary } from "./client";

export type MealContributionMode = "item" | "whole_meal" | "supplement";
export interface NutrientValues { energyKcal: number | null; proteinGrams: number | null; carbohydrateGrams: number | null; fatGrams: number | null; }
export interface MealContribution extends NutrientValues { id: string; mealId: string; mode: MealContributionMode; source: "manual" | "model_adopted"; reviewStatus: "tentative" | "confirmed"; sourceAnalysisId: string | null; label: string; portionAmount: number | null; portionUnit: string | null; basisDescription: string | null; revision: number; createdAt: string; updatedAt: string; }
export interface Meal { id: string; occurredAt: string; localDate: string; timeZone: string; name: string | null; note: string | null; revision: number; contributions: MealContribution[]; createdAt: string; updatedAt: string; }
export interface DietPlanEntry { id: string; localDate: string | null; mealName: string | null; foodPlan: string; note: string | null; }
export interface DietPlan { id: string; dateFrom: string; dateTo: string; title: string; note: string | null; entries: DietPlanEntry[]; revision: number; archivedAt: string | null; createdAt: string; updatedAt: string; }
export interface DietPlanInput { dateFrom: string; dateTo: string; title: string; note: string | null; entries: Array<Omit<DietPlanEntry, "id">>; }
export interface PersonalFoodTemplate extends NutrientValues { id: string; label: string; portionAmount: number | null; portionUnit: string | null; basisDescription: string | null; revision: number; createdAt: string; updatedAt: string; }
export interface FoodSearchResult extends NutrientValues { id: string; source: "personal_template" | "recent_meal"; label: string; portionAmount: number | null; portionUnit: string | null; basisDescription: string | null; lastUsedAt: string; }
export interface NutritionValueSummary { recorded: number | null; target: number | null; remaining: number | null; complete: boolean; }
export interface NutritionDaySummary { localDate: string; mealCount: number; coverageConfirmed: boolean; energyKcal: NutritionValueSummary; proteinGrams: NutritionValueSummary; carbohydrateGrams: NutritionValueSummary; fatGrams: NutritionValueSummary; }
export type ContributionInput = Omit<MealContribution, "id" | "mealId" | "source" | "reviewStatus" | "sourceAnalysisId" | "revision" | "createdAt" | "updatedAt">;
export interface ImageNutritionCandidate extends NutrientValues { title: string; observedFoods: Array<{ label: string; estimatedPortion: string | null; note: string | null }>; confidence: "low" | "medium" | "high"; assumptions: string[]; uncertaintyNote: string; }
export interface ImageAnalysisAttempt { id: string; sequence: number; status: "running" | "succeeded" | "failed"; providerRequestId: string | null; errorCode: string | null; startedAt: string; finishedAt: string | null; }
export interface MealImageAnalysis { id: string; mealId: string; status: "pending" | "running" | "succeeded" | "failed" | "cancelled"; model: string; promptVersion: string; candidate: ImageNutritionCandidate | null; lastErrorCode: string | null; imageAvailable: boolean; adoptedAt: string | null; revision: number; attempts: ImageAnalysisAttempt[]; createdAt: string; updatedAt: string; }
export type ImageAdoptionInput = ContributionInput & { analysisRevision: number; mealRevision: number; mode: "whole_meal" | "supplement"; replaceExisting: boolean; deleteOriginal: boolean };

export const nutritionApi = {
  listDietPlans: (from: string, to: string) => apiRequest<DietPlan[]>(`/api/v1/nutrition/diet-plans?${new URLSearchParams({ from, to })}`),
  createDietPlan: (input: DietPlanInput) => apiRequest<DietPlan>("/api/v1/nutrition/diet-plans", { method: "POST", body: JSON.stringify(input) }),
  updateDietPlan: (planId: string, revision: number, input: DietPlanInput) => apiRequest<DietPlan>(`/api/v1/nutrition/diet-plans/${planId}`, { method: "PUT", body: JSON.stringify({ revision, ...input }) }),
  archiveDietPlan: (planId: string, revision: number) => apiRequest<DietPlan>(`/api/v1/nutrition/diet-plans/${planId}/archive`, { method: "POST", body: JSON.stringify({ revision }) }),
  listMeals: (from: string, to: string) => apiRequest<Meal[]>(`/api/v1/nutrition/meals?${new URLSearchParams({ from, to })}`),
  searchFoods: (query: string, asOfDate: string) => apiRequest<FoodSearchResult[]>(`/api/v1/nutrition/food-search?${new URLSearchParams({ query, asOfDate })}`),
  createMeal: (input: Pick<Meal, "occurredAt" | "localDate" | "timeZone" | "name" | "note">) => apiRequest<Meal>("/api/v1/nutrition/meals", { method: "POST", body: JSON.stringify(input) }),
  updateMeal: (mealId: string, revision: number, input: Pick<Meal, "occurredAt" | "localDate" | "timeZone" | "name" | "note">) => apiRequest<Meal>(`/api/v1/nutrition/meals/${mealId}`, { method: "PUT", body: JSON.stringify({ revision, ...input }) }),
  deleteMeal: (mealId: string, revision: number) => apiRequest<void>(`/api/v1/nutrition/meals/${mealId}?${new URLSearchParams({ revision: revision.toString() })}`, { method: "DELETE" }),
  addContribution: (mealId: string, mealRevision: number, input: ContributionInput, replaceExisting: boolean) => apiRequest<Meal>(`/api/v1/nutrition/meals/${mealId}/contributions`, { method: "POST", body: JSON.stringify({ mealRevision, replaceExisting, ...input }) }),
  updateContribution: (mealId: string, contributionId: string, mealRevision: number, contributionRevision: number, input: ContributionInput, replaceExisting: boolean) => apiRequest<Meal>(`/api/v1/nutrition/meals/${mealId}/contributions/${contributionId}`, { method: "PUT", body: JSON.stringify({ mealRevision, contributionRevision, replaceExisting, ...input }) }),
  deleteContribution: (mealId: string, contributionId: string, mealRevision: number, contributionRevision: number) => apiRequest<Meal>(`/api/v1/nutrition/meals/${mealId}/contributions/${contributionId}?${new URLSearchParams({ mealRevision: mealRevision.toString(), contributionRevision: contributionRevision.toString() })}`, { method: "DELETE" }),
  getDaySummary: (localDate: string, timeZone: string) => apiRequest<NutritionDaySummary>(`/api/v1/nutrition/day-summary?${new URLSearchParams({ localDate, timeZone })}`),
  setCoverage: (localDate: string, coverageConfirmed: boolean) => apiRequest<{ coverageConfirmed: boolean }>("/api/v1/nutrition/day-coverage", { method: "PUT", body: JSON.stringify({ localDate, coverageConfirmed }) }),
  listFoodTemplates: () => apiRequest<PersonalFoodTemplate[]>("/api/v1/nutrition/food-templates"),
  createFoodTemplate: (input: ContributionInput) => apiRequest<PersonalFoodTemplate>("/api/v1/nutrition/food-templates", { method: "POST", body: JSON.stringify(input) }),
  updateFoodTemplate: (id: string, revision: number, input: ContributionInput) => apiRequest<PersonalFoodTemplate>(`/api/v1/nutrition/food-templates/${id}`, { method: "PUT", body: JSON.stringify({ revision, ...input }) }),
  deleteFoodTemplate: (id: string, revision: number) => apiRequest<void>(`/api/v1/nutrition/food-templates/${id}?${new URLSearchParams({ revision: revision.toString() })}`, { method: "DELETE" }),
  uploadMealImage: (mealId: string, file: File, onProgress: (percent: number) => void) => uploadBinary<MealImageAnalysis>(`/api/v1/image-analyses?${new URLSearchParams({ mealId })}`, file, onProgress),
  listImageAnalyses: (mealId: string) => apiRequest<MealImageAnalysis[]>(`/api/v1/image-analyses?${new URLSearchParams({ mealId })}`),
  retryImageAnalysis: (analysisId: string, revision: number) => apiRequest<MealImageAnalysis>(`/api/v1/image-analyses/${analysisId}/retry`, { method: "POST", body: JSON.stringify({ revision }) }),
  adoptImageAnalysis: (analysisId: string, input: ImageAdoptionInput) => apiRequest<{ analysis: MealImageAnalysis; meal: Meal }>(`/api/v1/image-analyses/${analysisId}/adopt`, { method: "POST", body: JSON.stringify(input) }),
};
