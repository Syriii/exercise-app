import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { builtinFoods } from "./food-catalog.js";
import { MemoryNutritionRepository } from "./memory-repository.js";
import { NutritionService } from "./service.js";

const mealInput = { occurredAt: "2026-09-09T00:00:00Z", localDate: "2026-09-09", timeZone: "UTC", name: "替换早餐", note: null };
const candidate = { title: "测试照片", observedFoods: [], foods: [
  { label: "认错的包子", portionAmount: 1, portionUnit: "个", note: null, energyKcal: 999, proteinGrams: 9, carbohydrateGrams: 9, fatGrams: 9 },
  { label: "保留豆浆", portionAmount: 1, portionUnit: "碗", note: null, energyKcal: 80, proteinGrams: null, carbohydrateGrams: null, fatGrams: null },
], energyKcal: null, proteinGrams: null, carbohydrateGrams: null, fatGrams: null, confidence: "low" as const, assumptions: [], uncertaintyNote: "照片估算" };
const egg = builtinFoods.find(food => food.id === "usda:173424")!;

it("replaces only one photo food using a new immutable basis and preserves history and unknowns", async () => {
  const repository = new MemoryNutritionRepository(), service = new NutritionService(repository);
  const initial = await service.createMeal("owner", mealInput), analysisId = randomUUID();
  const meal = await service.ensureTentativeModelContribution("owner", initial.id, analysisId, candidate);
  const item = meal.contributions[0]!, other = meal.contributions[1]!;
  const choice = { foodId: egg.id, version: egg.version, amount: 50.00049 };
  const saved = await service.replaceFoodSelection("owner", meal.id, item.id, meal.revision, item.revision, choice);
  expect(saved.revision).toBe(meal.revision + 1);
  expect(saved.contributions).toHaveLength(2);
  const replaced = saved.contributions.find(value => value.id === item.id)!;
  expect(replaced).toMatchObject({ label: egg.label, portionAmount: 50, portionUnit: "g", energyKcal: 77.5,
    source: "manual", sourceAnalysisId: analysisId, reviewStatus: "confirmed", revision: item.revision + 1,
    foodSnapshot: { id: egg.id, version: egg.version, basisAmount: 100, energyKcal: 155 } });
  expect(saved.contributions.find(value => value.id === other.id)).toEqual(other);
  expect((await service.listContributionRevisions("owner", meal.id))[0]).toMatchObject({ label: item.label, source: "model_adopted", energyKcal: 999, portionUnit: "个" });
  await expect(service.replaceFoodSelection("owner", meal.id, item.id, meal.revision, item.revision, choice)).rejects.toMatchObject({ statusCode: 409 });
  expect(await service.getMeal("owner", meal.id)).toEqual(saved);
  expect(await service.ensureTentativeModelContribution("owner", meal.id, analysisId, candidate)).toEqual(saved);
  const resized = await service.changePortion("owner", meal.id, item.id, saved.revision, replaced.revision, 100);
  expect(resized.contributions.find(value => value.id === item.id)!.energyKcal).toBe(155);
  const personal = await service.createPersonalFood("owner", { mode: "item", label: "未知配菜", category: "vegetables", portionAmount: 1, portionUnit: "碗", basisDescription: null, energyKcal: null, proteinGrams: null, carbohydrateGrams: null, fatGrams: null });
  const unknown = await service.replaceFoodSelection("owner", meal.id, item.id, resized.revision, replaced.revision + 1, { foodId: personal.id, version: personal.version, amount: 2 });
  expect(unknown.contributions.find(value => value.id === item.id)).toMatchObject({ label: personal.label, energyKcal: null, portionAmount: 2, portionUnit: "碗" });
  const template = (await repository.listFoodTemplates("owner")).find(value => `personal:${value.id}` === personal.id)!;
  await repository.deleteFoodTemplate("owner", template.id, template.revision);
  const resizedUnknown = await service.changePortion("owner", meal.id, item.id, unknown.revision, replaced.revision + 2, 3);
  expect(resizedUnknown.contributions.find(value => value.id === item.id)).toMatchObject({ energyKcal: null, portionAmount: 3, foodSnapshot: { id: personal.id } });
});

it("rejects stale, foreign, invalid and removed replacements without touching any food", async () => {
  const service = new NutritionService(new MemoryNutritionRepository());
  const initial = await service.createMeal("owner", mealInput);
  const meal = await service.ensureTentativeModelContribution("owner", initial.id, randomUUID(), candidate);
  const item = meal.contributions[0]!, choice = { foodId: egg.id, version: egg.version, amount: 50 };
  await expect(service.replaceFoodSelection("other", meal.id, item.id, meal.revision, item.revision, choice)).rejects.toMatchObject({ statusCode: 404 });
  await expect(service.replaceFoodSelection("owner", meal.id, randomUUID(), meal.revision, item.revision, choice)).rejects.toMatchObject({ statusCode: 404 });
  for (const amount of [0, -1, 0.0001, 100001, NaN, Infinity])
    await expect(service.replaceFoodSelection("owner", meal.id, item.id, meal.revision, item.revision, { ...choice, amount })).rejects.toMatchObject({ statusCode: 400 });
  await expect(service.replaceFoodSelection("owner", meal.id, item.id, meal.revision, item.revision, { ...choice, version: "stale" })).rejects.toMatchObject({ statusCode: 409 });
  const personal = await service.createPersonalFood("other", { mode: "item", label: "别人的食物", category: "other", portionAmount: 100, portionUnit: "g", basisDescription: null, energyKcal: null, proteinGrams: null, carbohydrateGrams: null, fatGrams: null });
  await expect(service.replaceFoodSelection("owner", meal.id, item.id, meal.revision, item.revision, { ...choice, foodId: personal.id, version: personal.version })).rejects.toMatchObject({ statusCode: 404 });
  expect(await service.getMeal("owner", meal.id)).toEqual(meal);
  const results = await Promise.allSettled([1, 2].map(() => service.replaceFoodSelection("owner", meal.id, item.id, meal.revision, item.revision, choice)));
  expect(results.filter(value => value.status === "fulfilled")).toHaveLength(1);
  expect(results.filter(value => value.status === "rejected")).toHaveLength(1);
  const saved = await service.getMeal("owner", meal.id);
  const removed = await service.deleteContribution("owner", meal.id, item.id, saved.revision, item.revision + 1);
  await expect(service.replaceFoodSelection("owner", meal.id, item.id, removed.revision, item.revision + 1, choice)).rejects.toMatchObject({ statusCode: 404 });
  expect(await service.getMeal("owner", meal.id)).toEqual(removed);
});
