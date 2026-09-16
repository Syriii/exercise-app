import { expect, it } from "vitest";
import { predictionValues, summarizeEvaluation } from "./photo-evaluation.js";

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
