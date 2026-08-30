import { describe, expect, it, vi } from "vitest";

import { MemoryPlanningRepository } from "./memory-repository.js";
import { PlanningService } from "./service.js";

async function completeProfile(service: PlanningService, userId: string) {
  await service.updateProfile(userId, 0, {
    birthDate: "1996-01-01",
    sexCategory: "male",
    heightCm: 175,
    pregnantOrBreastfeeding: false,
    medicalNutritionCondition: false,
    specialBodyComposition: false,
    palCategory: "low_active",
  });
  await service.updateStrategy(userId, 0, {
    weightStrategy: "maintain",
    macroPreference: "balanced",
    regularExercise: true,
    trainingIntent: "提高力量",
    targetWeightKg: null,
    targetDate: null,
  });
}

describe("PlanningService", () => {
  it("does not pass transport revision fields into first profile or strategy inserts", async () => {
    const repository = new MemoryPlanningRepository();
    const profileWrite = vi.spyOn(repository, "saveProfile");
    const strategyWrite = vi.spyOn(repository, "saveStrategy");
    const service = new PlanningService(repository);
    const profileInput = {
      revision: 0,
      birthDate: "2000-08-26",
      sexCategory: "male" as const,
      heightCm: 175,
      pregnantOrBreastfeeding: false,
      medicalNutritionCondition: false,
      specialBodyComposition: false,
      palCategory: "low_active" as const,
    };
    const strategyInput = {
      revision: 0,
      weightStrategy: "maintain" as const,
      macroPreference: "balanced" as const,
      regularExercise: false,
      trainingIntent: null,
      targetWeightKg: null,
      targetDate: null,
    };

    await service.updateProfile("user-a", profileInput.revision, profileInput);
    await service.updateStrategy("user-a", strategyInput.revision, strategyInput);

    expect(profileWrite.mock.calls[0]?.[2]).not.toHaveProperty("revision");
    expect(strategyWrite.mock.calls[0]?.[2]).not.toHaveProperty("revision");
  });

  it("keeps measurements as a timeline and uses the latest record available on that date", async () => {
    const service = new PlanningService(new MemoryPlanningRepository());
    await completeProfile(service, "user-a");
    await service.createMeasurement("user-a", {
      measuredAt: "2026-08-01T00:00:00.000Z",
      localDate: "2026-08-01",
      timeZone: "Asia/Shanghai",
      weightKg: 70,
      waistCm: 80,
      note: null,
    });
    await service.createMeasurement("user-a", {
      measuredAt: "2026-08-20T00:00:00.000Z",
      localDate: "2026-08-20",
      timeZone: "Asia/Shanghai",
      weightKg: 72,
      waistCm: null,
      note: null,
    });

    const historical = await service.getDailyReference("user-a", "2026-08-10", "Asia/Shanghai");
    const current = await service.getDailyReference("user-a", "2026-08-26", "Asia/Shanghai");
    expect(historical.result.measurementDate).toBe("2026-08-01");
    expect(current.result.measurementDate).toBe("2026-08-20");
    expect(historical.inputSnapshot.measurement?.weightKg).toBe(70);
    expect(current.inputSnapshot.measurement?.weightKg).toBe(72);
  });

  it("reuses an unchanged daily reference and creates a new revision after an input change", async () => {
    const service = new PlanningService(new MemoryPlanningRepository());
    await completeProfile(service, "user-a");
    await service.createMeasurement("user-a", {
      measuredAt: "2026-08-20T00:00:00.000Z",
      localDate: "2026-08-20",
      timeZone: "Asia/Shanghai",
      weightKg: 70,
      waistCm: null,
      note: null,
    });
    const first = await service.getDailyReference("user-a", "2026-08-26", "Asia/Shanghai");
    const unchanged = await service.getDailyReference("user-a", "2026-08-26", "Asia/Shanghai");
    const strategy = await service.getStrategy("user-a");
    await service.updateStrategy("user-a", strategy.revision, {
      weightStrategy: "maintain",
      macroPreference: "high_protein",
      regularExercise: true,
      trainingIntent: "提高力量",
      targetWeightKg: null,
      targetDate: null,
    });
    const changed = await service.getDailyReference("user-a", "2026-08-26", "Asia/Shanghai");
    expect(unchanged.id).toBe(first.id);
    expect(changed.id).not.toBe(first.id);
    expect(changed.revision).toBe(2);
    expect(first.inputSnapshot.strategy.macroPreference).toBe("balanced");
  });

  it("coalesces concurrent requests for an unchanged daily reference", async () => {
    const service = new PlanningService(new MemoryPlanningRepository());

    const references = await Promise.all([
      service.getDailyReference("user-a", "2026-08-28", "Asia/Shanghai"),
      service.getDailyReference("user-a", "2026-08-28", "Asia/Shanghai"),
    ]);

    expect(references[0]).toMatchObject({ revision: 1, result: { status: "needs_profile" } });
    expect(references[1]).toMatchObject({ id: references[0].id, revision: 1 });
  });

  it("retains the old value when a measurement is corrected and isolates accounts", async () => {
    const service = new PlanningService(new MemoryPlanningRepository());
    const measurement = await service.createMeasurement("user-a", {
      measuredAt: "2026-08-20T00:00:00.000Z",
      localDate: "2026-08-20",
      timeZone: "Asia/Shanghai",
      weightKg: 700,
      waistCm: null,
      note: "误录",
    }).catch((error: unknown) => error);
    expect(measurement).toMatchObject({ code: "invalid_planning_input" });
    const valid = await service.createMeasurement("user-a", {
      measuredAt: "2026-08-20T00:00:00.000Z",
      localDate: "2026-08-20",
      timeZone: "Asia/Shanghai",
      weightKg: 70,
      waistCm: null,
      note: "待修正",
    });
    await service.updateMeasurement("user-a", valid.id, valid.revision, {
      measuredAt: valid.measuredAt.toISOString(),
      localDate: valid.localDate,
      timeZone: valid.timeZone,
      weightKg: 71,
      waistCm: null,
      note: "已修正",
    });
    const revisions = await service.listMeasurementRevisions("user-a", valid.id);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]?.weightKg).toBe(70);
    await expect(service.listMeasurementRevisions("user-b", valid.id)).rejects.toMatchObject({ code: "measurement_not_found" });
    await expect(service.listMeasurements("user-b")).resolves.toEqual([]);
  });
});
