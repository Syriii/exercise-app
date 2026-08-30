import { describe, expect, it } from "vitest";

import { MemoryPlanningRepository } from "../planning/memory-repository.js";
import { PlanningService } from "../planning/service.js";
import { MemoryTrainingRepository } from "../training/memory-repository.js";
import { TrainingService } from "../training/service.js";
import { MemoryTrainingSuggestionRepository } from "./memory-repository.js";
import { TrainingSuggestionService } from "./service.js";

const preferences = { goal: "hypertrophy" as const, experience: "beginner" as const, equipment: "full_gym" as const, availableDaysPerWeek: 3, sessionMinutes: 60, hasInjuryOrMedicalLimitation: false };

async function fixture() {
  const planningService = new PlanningService(new MemoryPlanningRepository());
  const trainingService = new TrainingService({ repository: new MemoryTrainingRepository() });
  const service = new TrainingSuggestionService({ repository: new MemoryTrainingSuggestionRepository(), planningService, trainingService, now: () => new Date("2026-08-26T08:00:00.000Z") });
  await planningService.updateProfile("user-a", 0, { birthDate: "1995-05-01", sexCategory: "male", heightCm: 175, pregnantOrBreastfeeding: false, medicalNutritionCondition: false, specialBodyComposition: false, palCategory: "low_active" });
  return { planningService, trainingService, service };
}

describe("TrainingSuggestionService", () => {
  it("creates an evidence-backed candidate and adopts it as an ordinary user plan", async () => {
    const { service, trainingService } = await fixture();
    const suggestion = await service.generate("user-a", preferences);

    expect(suggestion.candidate).toMatchObject({ status: "ready", weeklyResistanceDays: 3 });
    expect(suggestion.evidenceIds).toEqual(["E-013", "E-014"]);
    expect(suggestion.candidate.template?.items.every((item) => item.targetWeightKg === null)).toBe(true);

    const adopted = await service.adopt("user-a", suggestion.id, suggestion.revision);
    expect(adopted.suggestion.status).toBe("adopted");
    expect(adopted.template.name).toBe("全身训练草案");
    expect(await trainingService.listTemplates("user-a")).toHaveLength(1);
    expect(await service.list("user-b")).toEqual([]);
  });

  it("does not duplicate the generated plan when adoption requests overlap", async () => {
    const { service, trainingService } = await fixture();
    const suggestion = await service.generate("user-a", preferences);

    const results = await Promise.allSettled([
      service.adopt("user-a", suggestion.id, suggestion.revision),
      service.adopt("user-a", suggestion.id, suggestion.revision),
    ]);

    const templates = await trainingService.listTemplates("user-a");
    const fulfilledTemplateIds = results
      .filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof service.adopt>>> => result.status === "fulfilled")
      .map((result) => result.value.template.id);
    expect(templates).toHaveLength(1);
    expect(fulfilledTemplateIds.length).toBeGreaterThanOrEqual(1);
    expect(new Set(fulfilledTemplateIds)).toEqual(new Set([templates[0]?.id]));
  });

  it("stops automatic advice outside the healthy-adult boundary and marks old inputs stale", async () => {
    const { service, planningService } = await fixture();
    const healthy = await service.generate("user-a", preferences);
    await planningService.updateProfile("user-a", 1, { birthDate: "1995-05-01", sexCategory: "male", heightCm: 176, pregnantOrBreastfeeding: false, medicalNutritionCondition: false, specialBodyComposition: false, palCategory: "low_active" });
    expect((await service.list("user-a"))[0]?.stale).toBe(true);

    const stopped = await service.generate("user-a", { ...preferences, hasInjuryOrMedicalLimitation: true });
    expect(stopped.candidate.status).toBe("stopped");
    expect(stopped.candidate.template).toBeNull();
    await expect(service.adopt("user-a", stopped.id, stopped.revision)).rejects.toMatchObject({ code: "invalid_training_suggestion_input" });
    expect(healthy.stale).toBe(false);
  });
});
