import { describe, expect, it } from "vitest";
import { calculateIntake, validateIntakeInput, type IntakeBasisInput, type IntakeQuantityInput } from "./intake.js";
import type { MealContribution } from "./types.js";

const item: MealContribution = { id: "test-item", mealId: "test-meal", label: "测试食物", mode: "item", source: "manual", reviewStatus: "confirmed", sourceAnalysisId: null,
  portionAmount: 100, portionUnit: "g", basisDescription: "测试营养来源", energyKcal: 120, proteinGrams: 0, carbohydrateGrams: null, fatGrams: 3,
  revision: 1, createdAt: new Date(0), updatedAt: new Date(0) };
const basis: IntakeBasisInput = { kind: "current_record" };
const run = (quantity: IntakeQuantityInput, food = item, source: IntakeBasisInput = basis) => calculateIntake(food, { quantity, basis: source }, new Date(0));

describe("explainable actual intake", () => {
  it.each([
    [{ kind: "net_weight", grams: 150, excludedGrams: 30, fraction: 0.5 }, 60],
    [{ kind: "gross_tare", grossGrams: 450, tareGrams: 200, excludedGrams: 50 }, 200],
    [{ kind: "before_after", beforeGrams: 500, afterGrams: 150, discardedGrams: 50, sameContainer: true }, 300],
  ] as const)("derives net intake once from %j", (quantity, amount) => {
    const result = run(quantity);
    expect(result).toMatchObject({ amount, unit: "g", nutrients: { energyKcal: amount * 1.2, proteinGrams: 0, carbohydrateGrams: null }, recordedAt: "1970-01-01T00:00:00.000Z" });
    expect(result.input.quantity).toEqual(quantity);
  });
  it("preserves explicit zero, unknown nutrition, original inputs and basis on repeated recalculation", () => {
    const result = run({ kind: "net_weight", grams: 123, fraction: 0 });
    expect(result.nutrients).toEqual({ energyKcal: 0, proteinGrams: 0, carbohydrateGrams: null, fatGrams: 0 });
    expect(result.equations.find(value => value.label === "按吃入比例")?.expression).toBe("123 × 0");
    const next = run({ kind: "net_weight", grams: 50 }, { ...item, portionAmount: 0, ...result.nutrients, intakeEvidence: result });
    expect(next.nutrients.energyKcal).toBe(60);
    expect(next.basis).toEqual(result.basis);
  });
  it("uses explicit label units and converts kJ while retaining unknown and zero", () => {
    const result = run({ kind: "count", amount: 2, unit: "份" }, item, { kind: "label", amount: 1, unit: "份", energy: 418.4, energyUnit: "kJ", proteinGrams: 0, carbohydrateGrams: null, fatGrams: null, source: "测试包装每份标签" });
    expect(result.nutrients).toEqual({ energyKcal: 200, proteinGrams: 0, carbohydrateGrams: null, fatGrams: null });
    expect(result.equations.some(value => value.expression === "418.4 ÷ 4.184")).toBe(true);
    expect(() => run({ kind: "count", amount: 2, unit: "个" })).toThrow(/缺少换算依据/);
    expect(() => run({ kind: "net_weight", grams: 50 }, { ...item, portionAmount: null, portionUnit: null })).toThrow(/没有可换算/);
  });
  it("supports photo quantities and explicit dimensions without inventing density or nutrition", () => {
    const box = run({ kind: "dimensions", shape: "box", lengthCm: 10, widthCm: 5, heightCm: 2, densityGramsPerMl: 0.8, reference: "用户估计餐盒内尺寸及密度" });
    expect(box).toMatchObject({ amount: 80, quantitySource: "photo_estimate", nutrients: { energyKcal: 96 } });
    expect(box.equations[0]).toMatchObject({ expression: "10 × 5 × 2", result: 100, unit: "ml" });
    expect(run({ kind: "dimensions", shape: "cylinder", diameterCm: 10, heightCm: 2, densityGramsPerMl: 1, reference: "用户估计" }).amount).toBe(157.08);
    expect(run({ kind: "photo_estimate", amount: 80, unit: "克", reference: "同大小餐盒与照片" }).unit).toBe("g");
    expect(() => run({ kind: "dimensions", shape: "box", lengthCm: 10, widthCm: 5, heightCm: 2, densityGramsPerMl: undefined as unknown as number, reference: "测试" })).toThrow();
  });
  it("rejects impossible deductions, invalid fractions and null/coerced measurements", () => {
    expect(() => run({ kind: "gross_tare", grossGrams: 150, tareGrams: 200 })).toThrow(/不能为负/);
    expect(() => run({ kind: "before_after", beforeGrams: 150, afterGrams: 200, sameContainer: true })).toThrow(/不能为负/);
    expect(() => run({ kind: "net_weight", grams: 100, fraction: 1.1 })).toThrow();
    for (const grams of [null, "0", NaN, undefined]) expect(() => validateIntakeInput({ mealRevision: 1, contributionRevision: 1, quantity: { kind: "net_weight", grams }, basis })).toThrow();
    expect(() => validateIntakeInput({ mealRevision: 1, contributionRevision: 1, quantity: { kind: "net_weight", grams: 0 }, basis })).not.toThrow();
  });
});
