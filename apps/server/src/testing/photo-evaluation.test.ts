import { expect, it } from "vitest";
import { compareEvaluations, predictionValues, summarizeEvaluation } from "./photo-evaluation.js";

it("scores failures and unknowns separately without inventing mass or dividing by zero", () => {
  const zero = { energyKcal: 0, massGrams: 0, proteinGrams: 0, carbohydrateGrams: 0, fatGrams: 0 };
  const result = summarizeEvaluation([
    { id: "a", truth: { ...zero, energyKcal: 100 }, prediction: { ...zero, energyKcal: 120, massGrams: null }, error: null },
    { id: "b", truth: zero, prediction: null, error: "timeout" },
  ]);
  expect(result).toMatchObject({ sampleCount: 2, requestFailures: 1, metrics: { energyKcal: { scored: 1, missing: 1, mae: 20, normalizedMaePercent: 20 }, massGrams: { scored: 0, missing: 2, mae: null }, fatGrams: { normalizedMaePercent: null } } });
  const food = { label: "egg", portionAmount: 2, portionUnit: "个", note: null, energyKcal: 100, proteinGrams: null, carbohydrateGrams: null, fatGrams: null };
  const candidate = { ...zero, foods: [food], title: "test", observedFoods: [], confidence: "low" as const, assumptions: [], uncertaintyNote: "test" };
  expect(predictionValues(candidate).massGrams).toBeNull();
  expect(predictionValues({ ...candidate, foods: [{ ...food, portionAmount: 50, portionUnit: "g" }] }).massGrams).toBe(50);
});

it("pairs by ID and separates lost or gained coverage from error changes", () => {
  const truth = { energyKcal: 100, massGrams: 100, proteinGrams: 0, carbohydrateGrams: 0, fatGrams: 0 };
  const old = [
    { id: "a", truth, prediction: { ...truth, energyKcal: 150, massGrams: null }, error: null },
    { id: "b", truth, prediction: { ...truth, energyKcal: 300 }, error: null },
  ];
  const next = [
    { id: "b", truth, prediction: null, error: "timeout" },
    { id: "a", truth, prediction: { ...truth, energyKcal: 110 }, error: null },
  ];
  expect(compareEvaluations(old, next)).toMatchObject({
    candidate: { requestFailures: 1 },
    pairedMetrics: {
      energyKcal: { scored: 1, gained: 0, lost: 1, baselineMae: 50, candidateMae: 10, maeChange: -40 },
      massGrams: { scored: 0, gained: 1, lost: 1, baselineMae: null, candidateMae: null },
      fatGrams: { scored: 1, baselineNormalizedMaePercent: null, candidateNormalizedMaePercent: null },
    },
  });
  expect(() => compareEvaluations(old, [next[1]!])).toThrow("evaluation_samples_changed");
  expect(() => compareEvaluations(old, [next[1]!, next[1]!])).toThrow("invalid_evaluation_records");
  expect(() => compareEvaluations(old, [{ ...next[0]!, truth: { ...truth, energyKcal: 99 } }, next[1]!])).toThrow("evaluation_truth_changed");
  expect(() => compareEvaluations(old, [{ ...next[0]!, id: "c" }, next[1]!])).toThrow("evaluation_samples_changed");
});

it("does not score a failed request even if stale prediction values are present", () => {
  const values = { energyKcal: 0, massGrams: 0, proteinGrams: 0, carbohydrateGrams: 0, fatGrams: 0 };
  expect(summarizeEvaluation([{ id: "failed", truth: values, prediction: values, error: "timeout" }])).toMatchObject({
    requestFailures: 1, metrics: { energyKcal: { scored: 0, missing: 1, mae: null } },
  });
});
