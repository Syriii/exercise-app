import { describe, expect, it } from "vitest";

import { NutritionError } from "./errors.js";
import { MemoryNutritionRepository } from "./memory-repository.js";
import { NutritionService } from "./service.js";

const mealInput = { occurredAt: "2026-08-26T04:00:00.000Z", localDate: "2026-08-26", timeZone: "Asia/Shanghai", name: "午饭", note: null };
const rice = { mode: "item" as const, label: "米饭", portionAmount: 200, portionUnit: "g", basisDescription: "食堂一碗", energyKcal: 232, proteinGrams: 5.2, carbohydrateGrams: 51.8, fatGrams: null };

describe("NutritionService", () => {
  it("uses the full daily target as remaining before any meal is recorded", async () => {
    const service = new NutritionService(new MemoryNutritionRepository());
    const summary = await service.getDaySummary("user-a", "2026-08-26", {
      energyKcal: 2200,
      proteinGrams: 100,
      carbohydrateGrams: 300,
      fatGrams: 70,
    });

    expect(summary.mealCount).toBe(0);
    expect(summary.energyKcal).toEqual({ recorded: 0, target: 2200, remaining: 2200, complete: false });
    expect(summary.proteinGrams).toEqual({ recorded: 0, target: 100, remaining: 100, complete: false });
    expect(summary.carbohydrateGrams).toEqual({ recorded: 0, target: 300, remaining: 300, complete: false });
    expect(summary.fatGrams).toEqual({ recorded: 0, target: 70, remaining: 70, complete: false });
  });

  it("keeps unknown nutrients partial and calculates known remaining values", async () => {
    const service = new NutritionService(new MemoryNutritionRepository());
    let meal = await service.createMeal("user-a", mealInput);
    meal = await service.addContribution("user-a", meal.id, meal.revision, rice, false);
    const summary = await service.getDaySummary("user-a", "2026-08-26", { energyKcal: 2200, proteinGrams: 100, carbohydrateGrams: 300, fatGrams: 70 });
    expect(summary.energyKcal).toEqual({ recorded: 232, target: 2200, remaining: 1968, complete: true });
    expect(summary.fatGrams).toEqual({ recorded: null, target: 70, remaining: null, complete: false });
    expect(summary.coverageConfirmed).toBe(false);
  });

  it("requires explicit replacement between item sums and a whole-meal total", async () => {
    const service = new NutritionService(new MemoryNutritionRepository());
    let meal = await service.createMeal("user-a", mealInput);
    meal = await service.addContribution("user-a", meal.id, meal.revision, rice, false);
    const total = { ...rice, mode: "whole_meal" as const, label: "午饭总计", energyKcal: 700 };
    await expect(service.addContribution("user-a", meal.id, meal.revision, total, false)).rejects.toMatchObject({ code: "nutrition_replacement_required" } satisfies Partial<NutritionError>);
    const replaced = await service.addContribution("user-a", meal.id, meal.revision, total, true);
    expect(replaced.contributions).toHaveLength(1);
    expect(replaced.contributions[0]?.mode).toBe("whole_meal");
  });

  it("preserves revisions and isolates accounts", async () => {
    const service = new NutritionService(new MemoryNutritionRepository());
    let meal = await service.createMeal("user-a", mealInput);
    meal = await service.addContribution("user-a", meal.id, meal.revision, rice, false);
    const contribution = meal.contributions[0]!;
    meal = await service.updateContribution("user-a", meal.id, contribution.id, meal.revision, contribution.revision, { ...rice, energyKcal: 250 }, false);
    const revisions = await service.listContributionRevisions("user-a", meal.id);
    expect(revisions[0]?.energyKcal).toBe(232);
    expect(await service.listMeals("user-b", "2026-08-26", "2026-08-26")).toEqual([]);
    await expect(service.listContributionRevisions("user-b", meal.id)).rejects.toMatchObject({ code: "meal_not_found" });
  });

  it("supports reusable personal food templates without making them a public database", async () => {
    const service = new NutritionService(new MemoryNutritionRepository());
    let saved = await service.createFoodTemplate("user-a", rice);
    expect((await service.listFoodTemplates("user-a"))[0]?.label).toBe("米饭");
    expect(await service.listFoodTemplates("user-b")).toEqual([]);
    saved = await service.updateFoodTemplate("user-a", saved.id, saved.revision, { ...rice, label: "熟米饭", energyKcal: 250 });
    expect(saved).toMatchObject({ label: "熟米饭", energyKcal: 250, revision: 2 });
    expect(await service.listFoodTemplates("user-b")).toEqual([]);
    await service.deleteFoodTemplate("user-a", saved.id, saved.revision);
    expect(await service.listFoodTemplates("user-a")).toEqual([]);
  });

  it("stores flexible date-range diet plans without turning them into nutrition targets", async () => {
    const service = new NutritionService(new MemoryNutritionRepository());
    let plan = await service.createDietPlan("user-a", {
      dateFrom: "2026-08-24",
      dateTo: "2026-08-30",
      title: "这周食堂安排",
      note: "优先选清淡做法",
      entries: [
        { localDate: null, mealName: null, foodPlan: "每餐先找一份蔬菜", note: "范围内每天适用" },
        { localDate: "2026-08-26", mealName: "午饭", foodPlan: "米饭半份、鸡腿一份", note: null },
      ],
    });
    expect(await service.listDietPlans("user-a", "2026-08-26", "2026-08-26")).toEqual([
      expect.objectContaining({ id: plan.id, title: "这周食堂安排", entries: [expect.objectContaining({ id: expect.any(String), localDate: null }), expect.objectContaining({ localDate: "2026-08-26", mealName: "午饭" })] }),
    ]);
    expect(await service.listDietPlans("user-b", "2026-08-26", "2026-08-26")).toEqual([]);
    await expect(service.updateDietPlan("user-a", plan.id, 99, { dateFrom: plan.dateFrom, dateTo: plan.dateTo, title: plan.title, note: plan.note, entries: plan.entries.map(({ id: _id, ...entry }) => entry) })).rejects.toMatchObject({ code: "nutrition_revision_conflict" });
    plan = await service.archiveDietPlan("user-a", plan.id, plan.revision);
    expect(plan.archivedAt).not.toBeNull();
    expect(await service.listDietPlans("user-a", "2026-08-26", "2026-08-26")).toEqual([]);
    expect(await service.listDietPlans("user-a", "2026-08-26", "2026-08-26", true)).toHaveLength(1);
    await expect(service.createDietPlan("user-a", { dateFrom: "2026-08-24", dateTo: "2026-08-30", title: "越界", note: null, entries: [{ localDate: "2026-09-01", mealName: null, foodPlan: "不应保存", note: null }] })).rejects.toMatchObject({ code: "invalid_nutrition_input" });
  });

  it("searches personal templates and recent meals without crossing accounts", async () => {
    const service = new NutritionService(new MemoryNutritionRepository());
    await service.createFoodTemplate("user-a", rice);
    let meal = await service.createMeal("user-a", {
      ...mealInput,
      occurredAt: "2026-08-20T04:00:00.000Z",
      localDate: "2026-08-20",
    });
    meal = await service.addContribution("user-a", meal.id, meal.revision, {
      ...rice,
      label: "食堂鸡腿",
      energyKcal: 310,
    }, false);

    const all = await service.searchFoods("user-a", "", "2026-08-26");
    const riceResults = await service.searchFoods("user-a", "米饭", "2026-08-26");

    expect(all.map((value) => [value.label, value.source])).toEqual([
      ["米饭", "personal_template"],
      ["食堂鸡腿", "recent_meal"],
    ]);
    expect(riceResults).toHaveLength(1);
    expect(riceResults[0]).toMatchObject({ label: "米饭", source: "personal_template", energyKcal: 232 });
    expect(await service.searchFoods("user-b", "", "2026-08-26")).toEqual([]);
  });
});
