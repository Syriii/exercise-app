export type MealContributionMode = "item" | "whole_meal" | "supplement";
export type MealContributionSource = "manual" | "model_adopted";
export type MealContributionReviewStatus = "tentative" | "confirmed";

export interface NutrientValues {
  readonly energyKcal: number | null;
  readonly proteinGrams: number | null;
  readonly carbohydrateGrams: number | null;
  readonly fatGrams: number | null;
}

export interface MealContribution extends NutrientValues {
  readonly id: string;
  readonly mealId: string;
  readonly mode: MealContributionMode;
  readonly source: MealContributionSource;
  readonly reviewStatus: MealContributionReviewStatus;
  readonly sourceAnalysisId: string | null;
  readonly label: string;
  readonly portionAmount: number | null;
  readonly portionUnit: string | null;
  readonly basisDescription: string | null;
  readonly revision: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface Meal {
  readonly id: string;
  readonly occurredAt: Date;
  readonly localDate: string;
  readonly timeZone: string;
  readonly name: string | null;
  readonly note: string | null;
  readonly revision: number;
  readonly contributions: readonly MealContribution[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface DietPlanEntry {
  readonly id: string;
  readonly localDate: string | null;
  readonly mealName: string | null;
  readonly foodPlan: string;
  readonly note: string | null;
}

export interface DietPlan {
  readonly id: string;
  readonly userId: string;
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly title: string;
  readonly note: string | null;
  readonly entries: readonly DietPlanEntry[];
  readonly revision: number;
  readonly archivedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface DietPlanInput {
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly title: string;
  readonly note: string | null;
  readonly entries: readonly Omit<DietPlanEntry, "id">[];
}

export interface MealRevision {
  readonly id: string;
  readonly mealId: string;
  readonly mealRevision: number;
  readonly occurredAt: Date;
  readonly localDate: string;
  readonly timeZone: string;
  readonly name: string | null;
  readonly note: string | null;
  readonly createdAt: Date;
}

export interface MealContributionRevision extends NutrientValues {
  readonly id: string;
  readonly contributionId: string;
  readonly contributionRevision: number;
  readonly mode: MealContributionMode;
  readonly source: MealContributionSource;
  readonly reviewStatus: MealContributionReviewStatus;
  readonly sourceAnalysisId: string | null;
  readonly label: string;
  readonly portionAmount: number | null;
  readonly portionUnit: string | null;
  readonly basisDescription: string | null;
  readonly createdAt: Date;
}

export interface NutritionValueSummary {
  readonly recorded: number | null;
  readonly target: number | null;
  readonly remaining: number | null;
  readonly complete: boolean;
}

export interface NutritionDaySummary {
  readonly localDate: string;
  readonly mealCount: number;
  readonly coverageConfirmed: boolean;
  readonly energyKcal: NutritionValueSummary;
  readonly proteinGrams: NutritionValueSummary;
  readonly carbohydrateGrams: NutritionValueSummary;
  readonly fatGrams: NutritionValueSummary;
}

export interface PersonalFoodTemplate extends NutrientValues {
  readonly id: string;
  readonly label: string;
  readonly portionAmount: number | null;
  readonly portionUnit: string | null;
  readonly basisDescription: string | null;
  readonly revision: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface FoodSearchResult extends NutrientValues {
  readonly id: string;
  readonly source: "personal_template" | "recent_meal";
  readonly label: string;
  readonly portionAmount: number | null;
  readonly portionUnit: string | null;
  readonly basisDescription: string | null;
  readonly lastUsedAt: Date;
}
