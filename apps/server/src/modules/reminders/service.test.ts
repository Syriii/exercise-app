import { describe, expect, it } from "vitest";

import { MemoryTrainingRepository } from "../training/memory-repository.js";
import { TrainingService } from "../training/service.js";
import { MemoryReminderRepository } from "./memory-repository.js";
import { ReminderService } from "./service.js";

function createServices() {
  const now = new Date("2026-08-26T11:00:00.000Z");
  const trainingService = new TrainingService({ repository: new MemoryTrainingRepository(), now: () => now });
  const nutritionService = new NutritionService(new MemoryNutritionRepository());
  const planningService = new PlanningService(new MemoryPlanningRepository());
  const reminderService = new ReminderService({
    repository: new MemoryReminderRepository(),
    trainingService,
    nutritionService,
    planningService,
    now: () => now,
  });
  return { trainingService, nutritionService, planningService, reminderService };
}

describe("ReminderService", () => {
  it("only becomes due for a scheduled workout after the configured local time", async () => {
    const { trainingService, reminderService } = createServices();
    const initial = await reminderService.getTrainingSettings("user-a", "Asia/Shanghai");
    expect(initial).toMatchObject({ enabled: false, revision: 0, timeZone: "Asia/Shanghai" });
    const settings = await reminderService.updateTrainingSettings("user-a", initial.revision, {
      enabled: true,
      localTime: "18:00",
      timeZone: "Asia/Shanghai",
    });
    expect(settings.revision).toBe(1);
    await expect(reminderService.getTrainingStatus("user-a", "2026-08-26", "Asia/Shanghai")).resolves.toMatchObject({ state: "none_scheduled" });

    await trainingService.createSchedule("user-a", {
      localDate: "2026-08-26",
      timeZone: "Asia/Shanghai",
      title: "今天练腿",
      note: null,
      sourceTemplateId: null,
      sourceProgramId: null,
      sourceProgramUnitId: null,
    });
    await expect(reminderService.getTrainingStatus("user-a", "2026-08-26", "Asia/Shanghai")).resolves.toMatchObject({ state: "due", scheduleCount: 1 });
  });

  it("snoozes or dismisses without changing the training schedule", async () => {
    const { trainingService, reminderService } = createServices();
    await reminderService.updateTrainingSettings("user-a", 0, { enabled: true, localTime: "18:00", timeZone: "Asia/Shanghai" });
    await trainingService.createSchedule("user-a", {
      localDate: "2026-08-26",
      timeZone: "Asia/Shanghai",
      title: "今天练腿",
      note: null,
      sourceTemplateId: null,
      sourceProgramId: null,
      sourceProgramUnitId: null,
    });

    await reminderService.snoozeTraining("user-a", "2026-08-26", 60);
    await expect(reminderService.getTrainingStatus("user-a", "2026-08-26", "Asia/Shanghai")).resolves.toMatchObject({ state: "snoozed" });
    await reminderService.dismissTraining("user-a", "2026-08-26");
    await expect(reminderService.getTrainingStatus("user-a", "2026-08-26", "Asia/Shanghai")).resolves.toMatchObject({ state: "dismissed" });
    await expect(trainingService.listSchedules("user-a", "2026-08-26", "2026-08-26")).resolves.toEqual([
      expect.objectContaining({ title: "今天练腿", status: "scheduled" }),
    ]);
  });

  it("rejects stale settings instead of silently overwriting them", async () => {
    const { reminderService } = createServices();
    await reminderService.updateTrainingSettings("user-a", 0, { enabled: true, localTime: "18:00", timeZone: "Asia/Shanghai" });
    await expect(reminderService.updateTrainingSettings("user-a", 0, { enabled: false, localTime: "19:00", timeZone: "Asia/Shanghai" })).rejects.toMatchObject({ code: "reminder_revision_conflict" });
  });

  it("keeps nutrition reminders independent and describes incomplete records without declaring a certain overage", async () => {
    const { nutritionService, reminderService } = createServices();
    await reminderService.updateNutritionSettings("user-a", 0, { enabled: true, localTime: "18:00", timeZone: "Asia/Shanghai" });
    await expect(reminderService.getNutritionStatus("user-a", "2026-08-26", "Asia/Shanghai")).resolves.toMatchObject({ state: "due", reason: "no_meals", mealCount: 0 });
    const meal = await nutritionService.createMeal("user-a", { occurredAt: "2026-08-26T04:00:00.000Z", localDate: "2026-08-26", timeZone: "Asia/Shanghai", name: "午饭", note: null });
    await nutritionService.addContribution("user-a", meal.id, meal.revision, { mode: "item", label: "米饭", portionAmount: 200, portionUnit: "g", basisDescription: null, energyKcal: 232, proteinGrams: null, carbohydrateGrams: 51.8, fatGrams: null }, false);
    await expect(reminderService.getNutritionStatus("user-a", "2026-08-26", "Asia/Shanghai")).resolves.toMatchObject({ state: "due", reason: "incomplete", mealCount: 1 });
    expect((await reminderService.getTrainingSettings("user-a", "Asia/Shanghai")).enabled).toBe(false);
  });

  it("defaults body measurement reminders to weekly and allows them to be closed independently", async () => {
    const { planningService, reminderService } = createServices();
    const initial = await reminderService.getMeasurementSettings("user-a", "Asia/Shanghai");
    expect(initial).toMatchObject({ enabled: true, intervalDays: 7, revision: 0 });
    await expect(reminderService.getMeasurementStatus("user-a", "2026-08-26", "Asia/Shanghai")).resolves.toMatchObject({ state: "due", latestMeasurementDate: null });
    await planningService.createMeasurement("user-a", { measuredAt: "2026-08-26T01:00:00.000Z", localDate: "2026-08-26", timeZone: "Asia/Shanghai", weightKg: 70, waistCm: null, note: null });
    await expect(reminderService.getMeasurementStatus("user-a", "2026-08-26", "Asia/Shanghai")).resolves.toMatchObject({ state: "not_due", latestMeasurementDate: "2026-08-26", nextDueDate: "2026-09-02" });
    await reminderService.updateMeasurementSettings("user-a", 0, { enabled: false, intervalDays: 14, localTime: "09:00", timeZone: "Asia/Shanghai" });
    expect((await reminderService.getNutritionSettings("user-a", "Asia/Shanghai")).enabled).toBe(false);
  });

  it("keeps every reminder rule and day state isolated by account", async () => {
    const { reminderService } = createServices();
    await reminderService.updateTrainingSettings("user-a", 0, { enabled: true, localTime: "18:00", timeZone: "Asia/Shanghai" });
    await reminderService.updateNutritionSettings("user-a", 0, { enabled: true, localTime: "20:00", timeZone: "Asia/Shanghai" });
    await reminderService.updateMeasurementSettings("user-a", 0, { enabled: false, intervalDays: 30, localTime: "09:00", timeZone: "Asia/Shanghai" });
    await reminderService.dismissNutrition("user-a", "2026-08-26");

    await expect(reminderService.getTrainingSettings("user-b", "Asia/Shanghai")).resolves.toMatchObject({ enabled: false, revision: 0 });
    await expect(reminderService.getNutritionSettings("user-b", "Asia/Shanghai")).resolves.toMatchObject({ enabled: false, revision: 0 });
    await expect(reminderService.getMeasurementSettings("user-b", "Asia/Shanghai")).resolves.toMatchObject({ enabled: true, intervalDays: 7, revision: 0 });
    await expect(reminderService.getNutritionStatus("user-b", "2026-08-26", "Asia/Shanghai")).resolves.not.toMatchObject({ state: "dismissed" });
  });
});
import { MemoryNutritionRepository } from "../nutrition/memory-repository.js";
import { NutritionService } from "../nutrition/service.js";
import { MemoryPlanningRepository } from "../planning/memory-repository.js";
import { PlanningService } from "../planning/service.js";
