import type { ImageNutritionCandidate } from "../modules/image-analysis/types.js";

export const evaluationKeys = ["energyKcal", "massGrams", "proteinGrams", "carbohydrateGrams", "fatGrams"] as const;
export type EvaluationValues = Record<(typeof evaluationKeys)[number], number | null>;
export interface EvaluationRecord { id: string; truth: EvaluationValues; prediction: EvaluationValues | null; error: string | null; }

/** Compare the same frozen samples, never make lower coverage look like lower error. */
export function compareEvaluations(baseline: readonly EvaluationRecord[], candidate: readonly EvaluationRecord[]) {
  const baselineSummary = summarizeEvaluation(baseline);
  const candidateSummary = summarizeEvaluation(candidate);
  const byId = new Map(candidate.map(row => [row.id, row]));
  if (baseline.length !== candidate.length || baseline.some(row => !byId.has(row.id))) throw new Error("evaluation_samples_changed");
  for (const row of baseline) {
    const next = byId.get(row.id)!;
    if (evaluationKeys.some(key => row.truth[key] !== next.truth[key])) throw new Error("evaluation_truth_changed");
  }
  const scoreable = (row: EvaluationRecord, key: keyof EvaluationValues) =>
    row.error === null && row.truth[key] !== null && row.prediction?.[key] !== null && row.prediction?.[key] !== undefined;
  return {
    baseline: baselineSummary, candidate: candidateSummary,
    pairedMetrics: Object.fromEntries(evaluationKeys.map(key => {
      const pairs = baseline.filter(row => scoreable(row, key) && scoreable(byId.get(row.id)!, key));
      const truth = pairs.reduce((sum, row) => sum + row.truth[key]!, 0);
      const oldError = pairs.reduce((sum, row) => sum + Math.abs(row.prediction![key]! - row.truth[key]!), 0);
      const newError = pairs.reduce((sum, row) => sum + Math.abs(byId.get(row.id)!.prediction![key]! - row.truth[key]!), 0);
      return [key, {
        scored: pairs.length,
        gained: baseline.filter(row => !scoreable(row, key) && scoreable(byId.get(row.id)!, key)).length,
        lost: baseline.filter(row => scoreable(row, key) && !scoreable(byId.get(row.id)!, key)).length,
        baselineMae: pairs.length ? oldError / pairs.length : null,
        candidateMae: pairs.length ? newError / pairs.length : null,
        maeChange: pairs.length ? (newError - oldError) / pairs.length : null,
        baselineNormalizedMaePercent: truth > 0 ? 100 * oldError / truth : null,
        candidateNormalizedMaePercent: truth > 0 ? 100 * newError / truth : null,
      }];
    })),
  };
}

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
        if (row.error !== null) return [];
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
