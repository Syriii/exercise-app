import type { ImageNutritionCandidate } from "../image-analysis/types.js";
import type { ContributionInput } from "./repository.js";

/** One non-overlapping contribution per identifiable food; old results stay whole. */
export function imageFoodContributions(analysisId: string, candidate: ImageNutritionCandidate): ContributionInput[] {
  const source = { source: "model_adopted" as const, sourceAnalysisId: analysisId, reviewStatus: "tentative" as const };
  if (candidate.foods !== undefined) {
    return candidate.foods.map((food) => ({
      ...source, mode: "item" as const, label: food.label,
      portionAmount: food.portionAmount, portionUnit: food.portionUnit,
      basisDescription: (food.note || candidate.uncertaintyNote || "按照片中可见份量估算").slice(0, 200),
      energyKcal: food.energyKcal, proteinGrams: food.proteinGrams,
      carbohydrateGrams: food.carbohydrateGrams, fatGrams: food.fatGrams,
    }));
  }
  if ([candidate.energyKcal, candidate.proteinGrams, candidate.carbohydrateGrams, candidate.fatGrams].every((value) => value === null)) return [];
  return [{
    ...source, mode: "whole_meal", label: candidate.title.trim().slice(0, 100) || "照片营养估算",
    portionAmount: null, portionUnit: null,
    basisDescription: (candidate.uncertaintyNote || "按照片中可见份量估算").slice(0, 200),
    energyKcal: candidate.energyKcal, proteinGrams: candidate.proteinGrams,
    carbohydrateGrams: candidate.carbohydrateGrams, fatGrams: candidate.fatGrams,
  }];
}
