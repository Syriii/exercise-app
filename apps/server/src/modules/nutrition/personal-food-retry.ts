import type { FoodTemplateInput } from "./repository.js";
import type { PersonalFoodTemplate } from "./types.js";

// Preferences may change after creation; content edits and deletion must never be
// undone by a late retry of the original create request.
export function samePersonalFood(saved: PersonalFoodTemplate, input: FoodTemplateInput): boolean {
  const fields = ["label", "portionAmount", "portionUnit", "basisDescription", "energyKcal", "proteinGrams", "carbohydrateGrams", "fatGrams"] as const;
  return saved.revision === 1 && fields.every(key => saved[key] === input[key])
    && saved.catalogMetadata?.category === input.catalogMetadata?.category
    && saved.catalogMetadata?.provider === "personal";
}
