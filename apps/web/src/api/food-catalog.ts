import { apiRequest } from "./client";
import type { ContributionInput, Meal, NutrientValues } from "./nutrition";

export type FoodCategory = "grains" | "vegetables" | "fruit" | "meat_eggs" | "dairy" | "beans" | "fats" | "other";
export interface FoodDefinition extends NutrientValues {
  id: string; version: string; label: string; basisAmount: number | null; basisUnit: string | null;
  category: FoodCategory; provider: "usda_sr_legacy" | "open_food_facts" | "personal" | "photo_estimate";
  sourceName: string; sourceUrl: string | null; license: string | null; originalName: string | null;
}
export interface CatalogFood extends FoodDefinition { isFavorite: boolean; }
export interface FoodCatalogPage { items: CatalogFood[]; total: number; nextCursor: string | null; categories: Record<FoodCategory, string>; warning: string | null; }
export const foodCatalogApi = {
  browse: (query: string, category: FoodCategory | "all", cursor: string | null = null, online = false) => {
    const params = { query, category, limit: 12, ...(cursor ? { cursor } : {}) };
    return online ? apiRequest<FoodCatalogPage>("/api/v1/nutrition/food-catalog/search", { method: "POST", body: JSON.stringify(params) })
      : apiRequest<FoodCatalogPage>(`/api/v1/nutrition/food-catalog?${new URLSearchParams({ ...params, limit: "12" })}`);
  },
  favorite: (foodId: string, isFavorite: boolean) => apiRequest<void>("/api/v1/nutrition/food-catalog/favorite", { method: "PUT", body: JSON.stringify({ foodId, isFavorite }) }),
  favoriteMealFood: (mealId: string, itemId: string) => apiRequest<void>(`/api/v1/nutrition/meals/${mealId}/contributions/${itemId}/favorite`, { method: "POST" }),
  createPersonal: (input: ContributionInput & { category: FoodCategory }) => apiRequest<CatalogFood>("/api/v1/nutrition/food-catalog/personal", { method: "POST", body: JSON.stringify(input) }),
  addSelections: (meal: Meal, submissionId: string, selections: Array<{ foodId: string; version: string; amount: number }>) => apiRequest<Meal>(`/api/v1/nutrition/meals/${meal.id}/food-selections`, { method: "POST", body: JSON.stringify({ mealRevision: meal.revision, submissionId, selections }) }),
};
