import { randomUUID } from "node:crypto";
import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MemoryIdentityRepository } from "../identity/memory-repository.js";
import { sessionCookieName } from "../identity/routes.js";
import { IdentityService } from "../identity/service.js";
import { builtinFoods, foodSnapshot, scaleFood, type FoodDefinition } from "./food-catalog.js";
import { deriveMealSuggestions, registerMealSuggestionRoutes, type MealSuggestionsResult } from "./meal-suggestions.js";
import { MemoryNutritionRepository } from "./memory-repository.js";
import { NutritionService } from "./service.js";
import type { MealContribution } from "./types.js";

const keys = ["energyKcal", "proteinGrams", "carbohydrateGrams", "fatGrams"] as const;
const byId = (id: string) => builtinFoods.find(food => food.id === id)!;
const chicken = byId("usda:171477"), egg = byId("usda:173424"), beancurd = byId("tfda:R4700202");
function eaten(food: FoodDefinition): { contributions: MealContribution[] } {
  return { contributions: [{ id: "test-food", mealId: "test-meal", mode: "item", source: "manual", reviewStatus: "confirmed", sourceAnalysisId: null,
    label: food.label, portionAmount: 100, portionUnit: food.basisUnit, basisDescription: food.sourceName, foodSnapshot: foodSnapshot(food),
    ...scaleFood(food, 100), revision: 1, createdAt: new Date("2026-10-27T04:00:00Z"), updatedAt: new Date("2026-10-27T04:00:00Z") }] };
}

describe("catalog meal suggestions", () => {
  it("offers different common meals and derives every amount and nutrient from the exact versioned catalog item", () => {
    const result = deriveMealSuggestions();
    expect(result.method).toBe("catalog-combinations-v1");
    expect(result.choices.length).toBeGreaterThanOrEqual(3);
    expect(new Set(result.choices.slice(0, 3).map(choice => choice.style)).size).toBe(3);
    const chickenRice = result.choices.find(choice => choice.id === "chicken-rice")!;
    expect(chickenRice.nutrients.energyKcal).toBe(495);
    expect(chickenRice.items[1]!.energyFormula).toBe("150 g ÷ 100 g × 165 kcal = 247.5 kcal");
    for (const choice of result.choices) {
      for (const item of choice.items) {
        const source = byId(item.food.id);
        expect(item.food).toEqual({ ...foodSnapshot(source), isFavorite: false });
        expect(item.nutrients).toEqual(scaleFood(source, item.amount));
        expect(item.food.basisUnit).toBe("g");
        expect(item.amount).toBeGreaterThan(0);
      }
      for (const key of keys) {
        const parts = choice.items.map(item => item.nutrients[key]);
        if (parts.every(value => value !== null))
          expect(choice.nutrients[key]).toBe(Math.round(parts.reduce((sum, value) => sum + value!, 0) * 1000) / 1000);
        else expect(choice.nutrients[key]).toBeNull();
      }
      expect(choice.assumptions.join(" ")).toContain("可修改的搭配参考");
      expect(choice.assumptions.join(" ")).toContain("商家额外油");
    }
    expect(result.notice).toContain("实际供应和商家配方未核实");
    expect(result.notice).toContain("核对实际吃入量再保存");
  });

  it("ranks optional preferences and familiar ingredients while keeping previously eaten meals selectable", () => {
    const rice = deriveMealSuggestions(builtinFoods, [], { style: "rice" });
    expect(rice.choices.slice(0, 3).every(choice => choice.style === "rice")).toBe(true);
    expect(deriveMealSuggestions(builtinFoods, [], { style: "breakfast" }).choices.slice(0, 3).every(choice => choice.style === "breakfast")).toBe(true);
    expect(deriveMealSuggestions(builtinFoods, [], { style: "noodles" }).choices[0]!.id).toBe("minced-pork-noodles");
    expect(deriveMealSuggestions(builtinFoods, [], { style: "dumplings" }).choices[0]!.id).toBe("dumplings-spinach");
    const available = deriveMealSuggestions(builtinFoods, [], { style: "rice", availableFoods: ["  雞蛋  ", "雞蛋"] });
    expect(available.choices[0]!.id).toBe("egg-rice");
    expect(available.choices[0]!.reason).toContain("已有食物");
    expect(deriveMealSuggestions(builtinFoods, [], { availableFoods: ["無糖豆漿"] }).choices[0]!.id).toBe("bun-soymilk-egg");
    const recent = deriveMealSuggestions(builtinFoods, [eaten(chicken)], { style: "rice" });
    expect(recent.choices[0]!.id).toBe("egg-rice");
    expect(recent.choices).toHaveLength(rice.choices.length);
    expect(recent.choices.find(choice => choice.id === "chicken-rice")!.reason).toContain("仍可再次选择");
    const favoriteFoods = builtinFoods.map(food => ({ ...food, isFavorite: food.id === beancurd.id }));
    expect(deriveMealSuggestions(favoriteFoods, [], { style: "rice" }).choices[0]!.id).toBe("beancurd-rice");
  });

  it("keeps unknown totals distinct from known subtotals and real zero values", () => {
    const foods = builtinFoods.map(food => food.id === chicken.id ? { ...food, energyKcal: null, proteinGrams: 0, carbohydrateGrams: null } : food);
    const choice = deriveMealSuggestions(foods).choices.find(item => item.id === "chicken-rice")!;
    expect(choice.nutrients.energyKcal).toBeNull();
    expect(choice.knownSubtotal.energyKcal).toBe(247.5);
    expect(choice.complete.energyKcal).toBe(false);
    expect(choice.nutrients.proteinGrams).toBe(7.605);
    expect(choice.complete.proteinGrams).toBe(true);
    expect(choice.nutrients.carbohydrateGrams).toBeNull();
    expect(choice.items.find(item => item.food.id === chicken.id)!.energyFormula).toContain("单位能量未知");
    const allUnknown = deriveMealSuggestions(builtinFoods.map(food => ({ ...food, energyKcal: null }))).choices[0]!;
    expect(allUnknown.nutrients.energyKcal).toBeNull();
    expect(allUnknown.knownSubtotal.energyKcal).toBeNull();
    const zero = deriveMealSuggestions(builtinFoods.map(food => ({ ...food, energyKcal: 0 }))).choices[0]!;
    expect(zero.nutrients.energyKcal).toBe(0);
    expect(zero.complete.energyKcal).toBe(true);
  });

  it("does not invent an ingredient or convert count, millilitre or missing bases into reference grams", () => {
    expect(deriveMealSuggestions([]).choices).toEqual([]);
    expect(deriveMealSuggestions(builtinFoods.filter(food => food.id !== chicken.id)).choices.some(choice => choice.id === "chicken-rice")).toBe(false);
    for (const invalid of [{ basisAmount: 1, basisUnit: "个" }, { basisAmount: 100, basisUnit: "ml" }, { basisAmount: null, basisUnit: "g" },
      { basisAmount: 0, basisUnit: "g" }, { basisAmount: Infinity, basisUnit: "g" }]) {
      const foods = builtinFoods.map(food => food.id === chicken.id ? { ...food, ...invalid } : food);
      expect(deriveMealSuggestions(foods).choices.some(choice => choice.id === "chicken-rice")).toBe(false);
    }
    const dumplings = deriveMealSuggestions().choices.find(choice => choice.id === "dumplings-spinach")!;
    expect(dumplings.assumptions.join(" ")).toContain("目录没有每只重量");
  });

  it("leaves caller inputs and later results unchanged and strips unrelated food fields", () => {
    const foods = builtinFoods.map(food => Object.freeze({ ...food, unrelatedPrivateNote: "not-for-the-response" }));
    const recent = [eaten(chicken)], preferences = { style: "rice" as const, availableFoods: ["鸡蛋"] };
    const before = JSON.stringify({ foods, recent, preferences });
    const result = deriveMealSuggestions(Object.freeze(foods), recent, preferences);
    expect(JSON.stringify({ foods, recent, preferences })).toBe(before);
    expect(JSON.stringify(result)).not.toContain("not-for-the-response");
    const mutableChoice = result.choices[0]!.searchTerms as string[];
    mutableChoice.push("unrelated change");
    result.choices[0]!.items[0]!.food.label = "changed copy";
    expect(JSON.stringify(deriveMealSuggestions(foods, recent, preferences))).not.toContain("unrelated change");
    expect(JSON.stringify(deriveMealSuggestions(foods, recent, preferences))).not.toContain("changed copy");
  });
});

const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });

async function suggestionApp() {
  const identityService = new IdentityService({ repository: new MemoryIdentityRepository(), sessionSecret: "local-test-meal-suggestions-session-secret", sessionTtlHours: 24 });
  const upstream = vi.fn(async () => { throw new Error("suggestions must not search upstream"); });
  const nutritionService = new NutritionService(new MemoryNutritionRepository(), { search: upstream });
  const app = Fastify();
  apps.push(app);
  await app.register(cookie);
  await registerMealSuggestionRoutes(app, { identityService, nutritionService });
  const first = await identityService.register("suggestion-owner", "local meal suggestions password");
  const second = await identityService.register("suggestion-other", "another local suggestions password");
  return { app, first, second, nutritionService, upstream };
}

async function saveMeal(service: NutritionService, owner: string, date: string, food: FoodDefinition) {
  const meal = await service.createMeal(owner, { occurredAt: `${date}T04:00:00.000Z`, localDate: date, timeZone: "Asia/Shanghai", name: "本地测试午饭", note: "private meal note" });
  return service.addFoodSelections(owner, meal.id, 1, randomUUID(), [{ foodId: food.id, version: food.version, amount: 100 }]);
}

describe("read-only meal suggestion route", () => {
  it("uses only the signed-in account and recent window without writing meals or calling upstream", async () => {
    const { app, first, second, nutritionService, upstream } = await suggestionApp();
    await saveMeal(nutritionService, first.account.id, "2026-10-27", chicken);
    await saveMeal(nutritionService, first.account.id, "2026-10-20", beancurd);
    await saveMeal(nutritionService, second.account.id, "2026-10-27", egg);
    await nutritionService.setFoodFavorite(first.account.id, egg.id, true);
    await nutritionService.setFoodFavorite(second.account.id, beancurd.id, true);
    const beforeFirst = await nutritionService.listMeals(first.account.id, "2026-10-01", "2026-10-28");
    const beforeSecond = await nutritionService.listMeals(second.account.id, "2026-10-01", "2026-10-28");
    const listMeals = vi.spyOn(nutritionService, "listMeals");
    const payload = { localDate: "2026-10-28", style: "rice" };
    const own = await app.inject({ method: "POST", url: "/api/v1/nutrition/meal-suggestions", cookies: { [sessionCookieName]: first.token }, payload });
    expect(own.statusCode, own.body).toBe(200);
    expect(listMeals).toHaveBeenNthCalledWith(1, first.account.id, "2026-10-22", "2026-10-28");
    const ownResult = own.json<MealSuggestionsResult>();
    expect(ownResult.choices[0]!.id).toBe("egg-rice");
    expect(ownResult.choices.find(choice => choice.id === "beancurd-rice")!.reason).toBeNull();
    expect(ownResult.choices.flatMap(choice => choice.items).filter(item => item.food.isFavorite).every(item => item.food.id === egg.id)).toBe(true);
    const other = await app.inject({ method: "POST", url: "/api/v1/nutrition/meal-suggestions", cookies: { [sessionCookieName]: second.token }, payload });
    expect(other.statusCode, other.body).toBe(200);
    expect(listMeals).toHaveBeenNthCalledWith(2, second.account.id, "2026-10-22", "2026-10-28");
    expect(other.json<MealSuggestionsResult>().choices[0]!.id).toBe("beancurd-rice");
    expect(own.body).not.toContain("private meal note");
    expect(await nutritionService.listMeals(first.account.id, "2026-10-01", "2026-10-28")).toEqual(beforeFirst);
    expect(await nutritionService.listMeals(second.account.id, "2026-10-01", "2026-10-28")).toEqual(beforeSecond);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("rejects missing sessions and invalid preferences before reading account data", async () => {
    const { app, first, nutritionService } = await suggestionApp();
    const listMeals = vi.spyOn(nutritionService, "listMeals");
    const unauthenticated = await app.inject({ method: "POST", url: "/api/v1/nutrition/meal-suggestions", payload: { localDate: "2026-10-28" } });
    expect(unauthenticated.statusCode).toBe(401);
    for (const payload of [{ localDate: "not-a-date" }, { localDate: "2026-02-30" }, { localDate: "2026-10-28", style: "unknown" },
      { localDate: "2026-10-28", availableFoods: Array(9).fill("鸡蛋") }, { localDate: "2026-10-28", availableFoods: ["字".repeat(41)] }]) {
      const response = await app.inject({ method: "POST", url: "/api/v1/nutrition/meal-suggestions", cookies: { [sessionCookieName]: first.token }, payload });
      expect(response.statusCode, response.body).toBe(400);
    }
    expect(listMeals).not.toHaveBeenCalled();
  });
});
