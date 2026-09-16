import type { ImageNutritionCandidate } from "../modules/image-analysis/types.js";

export const evaluationKeys = ["energyKcal", "massGrams", "proteinGrams", "carbohydrateGrams", "fatGrams"] as const;
export type EvaluationValues = Record<(typeof evaluationKeys)[number], number | null>;
export interface EvaluationRecord { id: string; truth: EvaluationValues; prediction: EvaluationValues | null; error: string | null; }

export function predictionValues(candidate: ImageNutritionCandidate): EvaluationValues {
  const foods = candidate.foods;
  const massGrams = foods?.length && foods.every(food => food.portionAmount !== null && ["g", "克", "公克"].includes(food.portionUnit ?? ""))
    ? foods.reduce((sum, food) => sum + food.portionAmount!, 0) : null;
  return { energyKcal: candidate.energyKcal, proteinGrams: candidate.proteinGrams, carbohydrateGrams: candidate.carbohydrateGrams, fatGrams: candidate.fatGrams, massGrams };
}

export function summarizeEvaluation(records: readonly EvaluationRecord[]) {
  if (!records.length || new Set(records.map(row => row.id)).size !== records.length) throw new Error("invalid_evaluation_records");
  return { sampleCount: records.length, requestFailures: records.filter(row => row.error !== null).length,
    metrics: Object.fromEntries(evaluationKeys.map(key => {
      const pairs = records.flatMap(row => {
        const truth = row.truth[key], prediction = row.prediction?.[key];
        if (truth === null || prediction === undefined || prediction === null) return [];
        if (![truth, prediction].every(value => Number.isFinite(value) && value >= 0)) throw new Error("invalid_evaluation_value");
        return [{ truth, error: Math.abs(prediction - truth) }];
      });
      const error = pairs.reduce((sum, pair) => sum + pair.error, 0), truth = pairs.reduce((sum, pair) => sum + pair.truth, 0);
      return [key, { scored: pairs.length, missing: records.length - pairs.length, mae: pairs.length ? error / pairs.length : null,
        // Dataset-relative absolute error, not mean of per-plate percentages; zero denominators stay unknown.
        normalizedMaePercent: truth > 0 ? 100 * error / truth : null }];
    })),
    recognitionReview: "Review predicted visible dishes against the images; ingredient names may be hidden or part of a mixed dish. Do not infer recognition recall from nutrition error.",
  };
}
