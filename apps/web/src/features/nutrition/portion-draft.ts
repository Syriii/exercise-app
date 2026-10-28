import type { Meal, MealContribution } from "../../api/nutrition";

/** Session memory owned by NutritionPage; revisions stay fixed until cancel or save. */
export interface PortionDraft {
  meal: Meal;
  item: MealContribution;
  amount: string | number;
  error: string;
}
