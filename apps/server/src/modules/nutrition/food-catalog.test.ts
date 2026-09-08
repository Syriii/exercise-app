import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { builtinFoods } from "./food-catalog.js";
import { MemoryNutritionRepository } from "./memory-repository.js";
import { NutritionService } from "./service.js";

const mealInput = { occurredAt: "2026-09-06T00:00:00Z", localDate: "2026-09-06", timeZone: "Asia/Shanghai", name: "早餐", note: null };
const unknownInput = { mode: "item" as const, label: "个人配菜", portionAmount: 100, portionUnit: "g", basisDescription: null,
  energyKcal: null, proteinGrams: null, carbohydrateGrams: null, fatGrams: null, category: "vegetables" as const };
const egg = builtinFoods.find((food) => food.id === "usda:173424")!;
const selection = { foodId: egg.id, version: egg.version, amount: 100 };

describe("unified food catalog", () => {
  it("retries personal creation atomically without duplicates, cross-account sharing or resurrection", async () => {
    const repository = new MemoryNutritionRepository();
    const service = new NutritionService(repository);
    const input = { ...unknownInput, energyKcal: 12.34567, portionAmount: 100.00049, submissionId: randomUUID() };
    const [food, retry] = await Promise.all([service.createPersonalFood("owner", input), service.createPersonalFood("owner", input)]);
    expect(retry).toEqual(food);
    expect(food).toMatchObject({ energyKcal: 12.346, basisAmount: 100 });
    await expect(service.createPersonalFood("owner", { ...input, portionAmount: 0.0001 })).rejects.toMatchObject({ statusCode: 400 });
    expect((await service.getFoodCatalog("owner", input.label)).total).toBe(1);
    await service.setFoodFavorite("owner", food.id, true);
    expect(await service.createPersonalFood("owner", input)).toMatchObject({ id: food.id, isFavorite: true });
    expect((await service.createPersonalFood("other", input)).id).not.toBe(food.id);
    await expect(service.createPersonalFood("owner", { ...input, label: "不同内容" })).rejects.toMatchObject({ statusCode: 409 });
    const template = (await repository.listFoodTemplates("owner"))[0]!;
    await repository.deleteFoodTemplate("owner", template.id, template.revision);
    await expect(service.createPersonalFood("owner", input)).rejects.toMatchObject({ statusCode: 409 });
    expect((await service.getFoodCatalog("owner", input.label)).total).toBe(0);
  });

  it("favorites unfavorited packaged food snapshots by stable source identity across meals and cache expiry", async () => {
    const repository = new MemoryNutritionRepository();
    const service = new NutritionService(repository, { search: async () => [{ id: "open_food_facts:12345678", provider: "open_food_facts", label: "隔离测试豆奶", brand: null, barcode: "12345678", basisAmount: 100, basisUnit: "g", energyKcal: 60, proteinGrams: 4, carbohydrateGrams: null, fatGrams: null, sourceUrl: "https://world.openfoodfacts.org/product/12345678" }] });
    const food = (await service.searchFoodCatalog("owner", "隔离测试豆奶")).items[0]!;
    const meals = [];
    for (const amount of [100, 250]) {
      const meal = await service.createMeal("owner", mealInput);
      meals.push(await service.addFoodSelections("owner", meal.id, 1, randomUUID(), [{ foodId: food.id, version: food.version, amount }]));
    }
    const cold = new NutritionService(repository);
    await Promise.all(meals.map(meal => cold.favoriteMealFood("owner", meal.id, meal.contributions[0]!.id)));
    const page = await cold.getFoodCatalog("owner", "隔离测试豆奶");
    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({ id: food.id, isFavorite: true, basisAmount: 100, energyKcal: 60, version: food.version });
    expect((await cold.getFoodCatalog("other", "隔离测试豆奶")).total).toBe(0);
    for (const meal of meals) expect(await cold.getMeal("owner", meal.id)).toEqual(meal);
  });
  it("browses every available food beyond 50 entries, with stable pagination and whole-list categories", async () => {
    const service = new NutritionService(new MemoryNutritionRepository());
    for (let i = 0; i < 61; i++) await service.createPersonalFood("owner", { ...unknownInput, label: `配菜${i}` });
    const ids = new Set<string>();
    let cursor: string | null = null;
    do {
      const page = await service.getFoodCatalog("owner", "", "all", cursor, 10);
      for (const item of page.items) { expect(ids.has(item.id)).toBe(false); ids.add(item.id); }
      cursor = page.nextCursor;
      expect(page.total).toBe(61 + builtinFoods.length);
    } while (cursor);
    expect(ids.size).toBe(61 + builtinFoods.length);
    expect((await service.getFoodCatalog("owner", "配菜", "fruit")).items).toEqual([]);
    expect((await service.getFoodCatalog("owner", "配菜", "vegetables")).total).toBe(61);
    expect((await service.getFoodCatalog("other", "配菜")).total).toBe(0);
    await expect(service.getFoodCatalog("owner", "", "all", "missing")).rejects.toMatchObject({ statusCode: 409 });
  });

  it("toggles favorites without duplicates, catalog revisions, or cross-account preference leaks", async () => {
    const service = new NutritionService(new MemoryNutritionRepository());
    await Promise.all([service.setFoodFavorite("owner", egg.id, true), service.setFoodFavorite("owner", egg.id, true)]);
    const page = await service.getFoodCatalog("owner");
    expect(page.items[0]).toMatchObject({ id: egg.id, isFavorite: true, version: egg.version });
    expect(page.total).toBe(builtinFoods.length);
    expect((await service.getFoodCatalog("other", "鸡蛋")).items[0]!.isFavorite).toBe(false);
    await service.setFoodFavorite("owner", egg.id, false);
    expect((await service.getFoodCatalog("owner", "鸡蛋")).items[0]).toMatchObject({ id: egg.id, isFavorite: false });
    const own = await service.createPersonalFood("owner", unknownInput);
    await expect(service.setFoodFavorite("other", own.id, true)).rejects.toMatchObject({ statusCode: 404 });
    await service.setFoodFavorite("owner", own.id, true);
    expect((await service.getFoodCatalog("owner", "个人配菜")).items[0]).toMatchObject({ isFavorite: true, version: own.version });
  });

  it("saves independent food identity and basis snapshots, scales portions, and preserves unknowns", async () => {
    const service = new NutritionService(new MemoryNutritionRepository());
    const personal = await service.createPersonalFood("owner", unknownInput);
    let meal = await service.createMeal("owner", mealInput);
    meal = await service.addFoodSelections("owner", meal.id, meal.revision, randomUUID(), [selection, { foodId: personal.id, version: personal.version, amount: 80 }]);
    expect(meal.contributions).toHaveLength(2);
    expect(meal.contributions[0]).toMatchObject({ portionAmount: 100, energyKcal: 155, foodSnapshot: { id: egg.id, basisAmount: 100, energyKcal: 155, license: "CC0-1.0" } });
    expect(meal.contributions[1]).toMatchObject({ portionAmount: 80, energyKcal: null });
    const item = meal.contributions[0]!;
    meal = await service.changePortion("owner", meal.id, item.id, meal.revision, item.revision, 33.333);
    meal = await service.changePortion("owner", meal.id, item.id, meal.revision, meal.contributions[0]!.revision, 200);
    expect(meal.contributions[0]).toMatchObject({ energyKcal: 310, foodSnapshot: { id: egg.id, basisAmount: 100 } });
    expect((await service.listContributionRevisions("owner", meal.id))[0]!.foodSnapshot).toEqual(item.foodSnapshot);
    const next = await service.createMeal("owner", { ...mealInput, localDate: "2026-09-07", occurredAt: "2026-09-07T00:00:00Z" });
    await service.addFoodSelections("owner", next.id, next.revision, randomUUID(), [{ ...selection, amount: 50 }]);
    expect((await service.getMeal("owner", meal.id)).contributions[0]!.energyKcal).toBe(310);
  });

  it("validates the whole selection before writing and safely retries without resurrecting removed food", async () => {
    const service = new NutritionService(new MemoryNutritionRepository());
    const meal = await service.createMeal("owner", mealInput);
    await expect(service.addFoodSelections("owner", meal.id, meal.revision, randomUUID(), [selection, { ...selection, foodId: "missing" }])).rejects.toMatchObject({ statusCode: 404 });
    expect((await service.getMeal("owner", meal.id)).contributions).toEqual([]);
    const submissionId = randomUUID();
    const saved = await service.addFoodSelections("owner", meal.id, meal.revision, submissionId, [selection]);
    expect(await service.addFoodSelections("owner", meal.id, meal.revision, submissionId, [selection])).toEqual(saved);
    await expect(service.addFoodSelections("owner", meal.id, meal.revision, submissionId, [{ ...selection, amount: 200 }])).rejects.toMatchObject({ statusCode: 409 });
    await service.deleteContribution("owner", meal.id, saved.contributions[0]!.id, saved.revision, 1);
    await expect(service.addFoodSelections("owner", meal.id, meal.revision, submissionId, [selection])).rejects.toMatchObject({ statusCode: 409 });
    expect((await service.getMeal("owner", meal.id)).contributions).toEqual([]);
    await expect(service.addFoodSelections("other", meal.id, 1, randomUUID(), [selection])).rejects.toMatchObject({ statusCode: 404 });
    const second = await service.createMeal("owner", mealInput);
    const otherFood = builtinFoods.find((food) => food.id !== egg.id)!;
    const batchId = randomUUID();
    const choices = [selection, { foodId: otherFood.id, version: otherFood.version, amount: 10 }];
    const both = await service.addFoodSelections("owner", second.id, 1, batchId, choices);
    await expect(service.addFoodSelections("owner", second.id, both.revision, batchId, choices.slice(0, 1))).rejects.toMatchObject({ statusCode: 409 });
  });

  it("rejects invalid amounts and stale food versions without changing history", async () => {
    const service = new NutritionService(new MemoryNutritionRepository());
    const meal = await service.createMeal("owner", mealInput);
    for (const amount of [0, -1, NaN, Infinity, 0.0001, 100001])
      await expect(service.addFoodSelections("owner", meal.id, 1, randomUUID(), [{ ...selection, amount }])).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.addFoodSelections("owner", meal.id, 1, randomUUID(), [{ ...selection, version: "stale" }])).rejects.toMatchObject({ statusCode: 409 });
    expect((await service.getMeal("owner", meal.id)).revision).toBe(1);
  });

  it("keeps local browsing available when online search fails and does not call upstream for empty searches", async () => {
    let calls = 0;
    const service = new NutritionService(new MemoryNutritionRepository(), { search: async () => { calls++; throw new Error("offline"); } });
    expect((await service.searchFoodCatalog("owner", "")).total).toBe(builtinFoods.length);
    expect(calls).toBe(0);
    const page = await service.searchFoodCatalog("owner", "鸡蛋");
    expect(page.items[0]!.id).toBe(egg.id);
    expect(page.warning).toContain("已有目录");
    expect(calls).toBe(1);
  });

  it("keeps photo-derived food identity across portions and favorite toggles without guessing name matches", async () => {
    const repository = new MemoryNutritionRepository();
    const service = new NutritionService(repository);
    const meal = await service.createMeal("owner", mealInput);
    const saved = await repository.addContribution("owner", meal.id, 1, { ...unknownInput, source: "model_adopted", sourceAnalysisId: randomUUID(), reviewStatus: "tentative" }, false);
    if (typeof saved === "string") throw new Error(saved);
    const item = saved.contributions[0]!;
    await service.favoriteMealFood("owner", meal.id, item.id);
    await service.changePortion("owner", meal.id, item.id, saved.revision, item.revision, 200);
    await service.favoriteMealFood("owner", meal.id, item.id);
    const page = await service.getFoodCatalog("owner", "个人配菜");
    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({ id: `meal-food:${item.id}`, provider: "photo_estimate", basisAmount: 100, energyKcal: null });
    await service.setFoodFavorite("owner", page.items[0]!.id, false);
    expect((await service.getFoodCatalog("owner", "个人配菜")).items[0]!.isFavorite).toBe(false);
    await expect(service.favoriteMealFood("other", meal.id, item.id)).rejects.toMatchObject({ statusCode: 404 });
  });
});
