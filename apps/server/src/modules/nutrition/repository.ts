import type {
  Meal,
  DietPlan,
  MealContribution,
  MealContributionRevision,
  MealRevision,
  PersonalFoodTemplate,
} from "./types.js";

export type MealMetadataInput = Pick<Meal, "occurredAt" | "localDate" | "timeZone" | "name" | "note">;
export type ContributionInput = Omit<MealContribution, "id" | "mealId" | "revision" | "createdAt" | "updatedAt">;
export type FoodTemplateInput = Omit<PersonalFoodTemplate, "id" | "revision" | "createdAt" | "updatedAt">;
export type DietPlanRepositoryInput = Omit<DietPlan, "id" | "userId" | "revision" | "archivedAt" | "createdAt" | "updatedAt">;

export interface NutritionRepository {
  listDietPlans(userId: string, dateFrom: string, dateTo: string, includeArchived: boolean): Promise<readonly DietPlan[]>;
  createDietPlan(userId: string, input: DietPlanRepositoryInput): Promise<DietPlan>;
  updateDietPlan(userId: string, planId: string, expectedRevision: number, input: DietPlanRepositoryInput): Promise<DietPlan | "not_found" | "revision_conflict">;
  archiveDietPlan(userId: string, planId: string, expectedRevision: number, archivedAt: Date): Promise<DietPlan | "not_found" | "revision_conflict">;
  listMeals(userId: string, localDateFrom: string, localDateTo: string): Promise<readonly Meal[]>;
  getMeal(userId: string, mealId: string): Promise<Meal | null>;
  createMeal(userId: string, input: MealMetadataInput): Promise<Meal>;
  updateMeal(userId: string, mealId: string, expectedRevision: number, input: MealMetadataInput): Promise<Meal | "not_found" | "revision_conflict">;
  deleteMeal(userId: string, mealId: string, expectedRevision: number): Promise<"deleted" | "not_found" | "revision_conflict">;
  listMealRevisions(userId: string, mealId: string): Promise<readonly MealRevision[] | "not_found">;
  addContribution(userId: string, mealId: string, expectedMealRevision: number, input: ContributionInput, replaceExisting: boolean): Promise<Meal | "not_found" | "revision_conflict" | "replacement_required">;
  updateContribution(userId: string, mealId: string, contributionId: string, expectedMealRevision: number, expectedContributionRevision: number, input: ContributionInput, replaceExisting: boolean): Promise<Meal | "not_found" | "contribution_not_found" | "revision_conflict" | "replacement_required">;
  deleteContribution(userId: string, mealId: string, contributionId: string, expectedMealRevision: number, expectedContributionRevision: number): Promise<Meal | "not_found" | "contribution_not_found" | "revision_conflict">;
  listContributionRevisions(userId: string, mealId: string): Promise<readonly MealContributionRevision[] | "not_found">;
  getCoverageConfirmed(userId: string, localDate: string): Promise<boolean>;
  setCoverageConfirmed(userId: string, localDate: string, confirmed: boolean): Promise<boolean>;
  listFoodTemplates(userId: string): Promise<readonly PersonalFoodTemplate[]>;
  createFoodTemplate(userId: string, input: FoodTemplateInput): Promise<PersonalFoodTemplate>;
  updateFoodTemplate(userId: string, templateId: string, expectedRevision: number, input: FoodTemplateInput): Promise<PersonalFoodTemplate | "not_found" | "revision_conflict">;
  deleteFoodTemplate(userId: string, templateId: string, expectedRevision: number): Promise<"deleted" | "not_found" | "revision_conflict">;
}
