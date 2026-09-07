import type { CatalogFood, FoodCategory } from "../../api/food-catalog";
import { submissionId } from "../../support/submission-id";

export interface FoodPickerDraft {
  open: boolean; query: string; category: FoodCategory | "all";
  selected: Array<{ food: CatalogFood; amount: string }>;
  submissionId: string; mealRevision: number | null;
  personal: { label: string; amount: string; unit: string; category: FoodCategory; energy: string; protein: string; carbs: string; fat: string };
}
export function newFoodPickerDraft(): FoodPickerDraft {
  return { open: false, query: "", category: "all", selected: [], submissionId: submissionId(), mealRevision: null,
    personal: { label: "", amount: "100", unit: "g", category: "other", energy: "", protein: "", carbs: "", fat: "" } };
}
