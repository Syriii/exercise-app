import { describe, expect, it } from "vitest";

import { calculateDailyReference, planningEvidenceIds, planningMethodVersion } from "./calculator.js";
import type { GoalStrategy, PersonalProfile } from "./types.js";

function profile(overrides: Partial<PersonalProfile> = {}): PersonalProfile {
  return {
    birthDate: "2004-06-15",
    sexCategory: "female",
    heightCm: 165,
    pregnantOrBreastfeeding: false,
    medicalNutritionCondition: false,
    specialBodyComposition: false,
    palCategory: "low_active",
    revision: 1,
    updatedAt: new Date("2026-06-01T00:00:00Z"),
    ...overrides,
  };
}

function strategy(overrides: Partial<GoalStrategy> = {}): GoalStrategy {
  return {
    weightStrategy: "maintain",
    macroPreference: "balanced",
    regularExercise: false,
    trainingIntent: null,
    targetWeightKg: null,
    targetDate: null,
    revision: 1,
    updatedAt: new Date("2026-06-01T00:00:00Z"),
    ...overrides,
  };
}

describe("daily planning calculator", () => {
  it("reproduces the National Academies adult EER example before macro allocation", () => {
    const result = calculateDailyReference({
      localDate: "2026-06-15",
      profile: profile(),
      strategy: strategy(),
      measurement: { weightKg: 63, localDate: "2026-06-15" },
    });

    expect(result.status).toBe("ready");
    expect(result.ageYears).toBe(22);
    expect(result.maintenanceKcal).toBe(2275);
    expect(result.targetEnergyKcal).toBe(2275);
    expect(result.chineseDriCrossCheck).toEqual({
      ageBand: "18-29",
      energyMjPerDay: { low: 7.11, medium: 8.79, high: 10.25 },
      proteinRniGrams: 55,
    });
  });

  it("keeps PAL unknown and returns a range instead of inventing a category", () => {
    const result = calculateDailyReference({
      localDate: "2026-06-15",
      profile: profile({ palCategory: null }),
      strategy: strategy(),
      measurement: { weightKg: 63, localDate: "2026-06-15" },
    });

    expect(result.status).toBe("needs_pal");
    expect(result.maintenanceKcal).toBeNull();
    expect(result.maintenanceRangeKcal?.minimum).toBeLessThan(result.maintenanceRangeKcal!.maximum);
  });

  it("uses the conservative official weight-loss deficit only inside its covered BMI range", () => {
    const result = calculateDailyReference({
      localDate: "2026-06-15",
      profile: profile({ birthDate: "1996-01-01", sexCategory: "male", heightCm: 175 }),
      strategy: strategy({ weightStrategy: "lose", macroPreference: "lower_fat" }),
      measurement: { weightKg: 82, localDate: "2026-06-15" },
    });

    expect(result.status).toBe("ready");
    expect(result.strategyAdjustmentKcal).toBe(-500);
    expect(result.proteinBasis).toBe("weight_loss_energy_share");
    expect((result.proteinGrams! * 4) / result.targetEnergyKcal!).toBeCloseTo(0.2, 2);
    expect((result.fatGrams! * 9) / result.targetEnergyKcal!).toBeCloseTo(0.2, 2);
    expect((result.carbohydrateGrams! * 4) / result.targetEnergyKcal!).toBeCloseTo(0.6, 2);
  });

  it("stops weight-loss automation for BMI outside the official automatic path", () => {
    const normal = calculateDailyReference({
      localDate: "2026-06-15",
      profile: profile(),
      strategy: strategy({ weightStrategy: "lose" }),
      measurement: { weightKg: 60, localDate: "2026-06-15" },
    });
    const severe = calculateDailyReference({
      localDate: "2026-06-15",
      profile: profile(),
      strategy: strategy({ weightStrategy: "lose" }),
      measurement: { weightKg: 90, localDate: "2026-06-15" },
    });
    expect(normal.status).toBe("stopped");
    expect(severe.status).toBe("stopped");
    expect(normal.targetEnergyKcal).toBeNull();
  });

  it("stops special life stages and does not invent a fixed gain surplus", () => {
    const pregnancy = calculateDailyReference({
      localDate: "2026-06-15",
      profile: profile({ pregnantOrBreastfeeding: true }),
      strategy: strategy(),
      measurement: { weightKg: 63, localDate: "2026-06-15" },
    });
    const gain = calculateDailyReference({
      localDate: "2026-06-15",
      profile: profile(),
      strategy: strategy({ weightStrategy: "gain", targetWeightKg: 67, targetDate: "2026-12-31" }),
      measurement: { weightKg: 63, localDate: "2026-06-15" },
    });
    expect(pregnancy.status).toBe("stopped");
    expect(gain.status).toBe("maintenance_only");
    expect(gain.strategyAdjustmentKcal).toBe(0);
  });

  it("publishes a stable auditable method and evidence set", () => {
    expect(planningMethodVersion).toBe("daily-reference-2026-08-26.1");
    expect(planningEvidenceIds).toEqual(expect.arrayContaining(["E-001", "E-002", "E-004", "E-007"]));
  });
});
