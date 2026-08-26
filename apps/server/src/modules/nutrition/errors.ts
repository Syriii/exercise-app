export type NutritionErrorCode =
  | "invalid_nutrition_input"
  | "meal_not_found"
  | "contribution_not_found"
  | "food_template_not_found"
  | "diet_plan_not_found"
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
