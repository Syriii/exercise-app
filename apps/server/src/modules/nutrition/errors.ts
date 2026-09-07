export type NutritionErrorCode =
  | "invalid_nutrition_input"
  | "food_catalog_changed"
  | "food_not_found"
  | "portion_basis_required"
  | "meal_not_found"
  | "contribution_not_found"
  | "food_template_not_found"
  | "diet_plan_not_found"
  | "public_food_search_unavailable"
  | "public_food_search_rate_limited"
  | "nutrition_revision_conflict"
  | "nutrition_replacement_required";

export class NutritionError extends Error {
  public constructor(
    public readonly code: NutritionErrorCode,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
  }
}
