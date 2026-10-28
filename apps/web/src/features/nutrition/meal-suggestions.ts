import { apiRequest } from "../../api/client";
import type { CatalogFood } from "../../api/food-catalog";
import type { NutrientValues } from "../../api/nutrition";

export type MealSuggestionStyle = "all" | "rice" | "noodles" | "dumplings" | "breakfast";
export interface MealSuggestionItem { food: CatalogFood; amount: number; nutrients: NutrientValues; energyFormula: string; }
export interface MealSuggestion {
  id: string; title: string; style: Exclude<MealSuggestionStyle, "all">; searchTerms: string[]; items: MealSuggestionItem[];
  nutrients: NutrientValues; knownSubtotal: NutrientValues; complete: Record<keyof NutrientValues, boolean>;
  assumptions: string[]; reason: string | null;
}
export interface MealSuggestionsResult { method: "catalog-combinations-v1"; choices: MealSuggestion[]; notice: string; }
export interface MealSuggestionDraft { title: string; selections: Array<{ food: CatalogFood; amount: string }>; }

export function loadMealSuggestions(localDate: string, style: MealSuggestionStyle, availableFoods: string[]): Promise<MealSuggestionsResult> {
  return apiRequest("/api/v1/nutrition/meal-suggestions", { method: "POST", body: JSON.stringify({ localDate, style, availableFoods }) });
}
