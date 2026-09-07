import { isDeepStrictEqual } from "node:util";
import type { ContributionInput } from "./repository.js";
import type { MealContribution } from "./types.js";

export function sameSelection(saved: MealContribution, input: ContributionInput & { id: string }): boolean {
  return saved.id === input.id && saved.mode === input.mode && saved.source === input.source
    && saved.label === input.label && saved.portionAmount === input.portionAmount && saved.portionUnit === input.portionUnit
    && saved.energyKcal === input.energyKcal && saved.proteinGrams === input.proteinGrams
    && saved.carbohydrateGrams === input.carbohydrateGrams && saved.fatGrams === input.fatGrams
    && isDeepStrictEqual(saved.foodSnapshot, input.foodSnapshot);
}
