import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { createTestConfig } from "../../testing/test-config.js";
import { MemoryIdentityRepository } from "../identity/memory-repository.js";
import { IdentityService } from "../identity/service.js";
import { MemoryPlanningRepository } from "../planning/memory-repository.js";
import { PlanningService } from "../planning/service.js";
import { MemoryNutritionRepository } from "./memory-repository.js";
import { FixedPublicFoodProvider } from "./public-food-provider.js";
import { NutritionService } from "./service.js";

it("serves one catalog with authenticated favorites, snapshots, pagination and external fallback", async () => {
  const config = createTestConfig({ webDistDirectory: "/directory-that-does-not-exist" });
  const identityService = new IdentityService({ repository: new MemoryIdentityRepository(), sessionSecret: config.sessionSecret, sessionTtlHours: config.sessionTtlHours });
  const app = await buildApp({ config, checkDatabase: async () => undefined, identityService,
    planningService: new PlanningService(new MemoryPlanningRepository()), nutritionService: new NutritionService(new MemoryNutritionRepository(), new FixedPublicFoodProvider([
      { id: "open_food_facts:12345678", provider: "open_food_facts", label: "测试豆奶", brand: "测试", barcode: "12345678", basisAmount: 100, basisUnit: "g", energyKcal: 60, proteinGrams: 4, carbohydrateGrams: null, fatGrams: null, sourceUrl: "https://world.openfoodfacts.org/product/12345678" },
    ])) });
  try {
    const register = async (username: string) => {
      const r = await app.inject({ method: "POST", url: "/api/v1/auth/register", payload: { username, password: "correct horse battery staple" } });
      return String(r.headers["set-cookie"]).split(";", 1)[0]!;
    };
    const cookie = await register("catalog-owner"), other = await register("catalog-other");
    const request = (method: "GET" | "POST" | "PUT", url: string, payload?: object, auth = cookie) => app.inject({ method, url, headers: { cookie: auth }, ...(payload ? { payload } : {}) });
    expect((await app.inject({ method: "GET", url: "/api/v1/nutrition/food-catalog" })).statusCode).toBe(401);
    expect((await request("GET", "/api/v1/nutrition/food-catalog?limit=51")).statusCode).toBe(400);
    const page = await request("GET", "/api/v1/nutrition/food-catalog?limit=3");
    expect(page.statusCode, page.body).toBe(200);
    expect(page.json()).toMatchObject({ items: expect.any(Array), total: 16, nextCursor: expect.any(String), warning: null });
    const search = await request("POST", "/api/v1/nutrition/food-catalog/search", { query: "豆奶" });
    expect(search.statusCode, search.body).toBe(200);
    const food = search.json().items.find((item: { provider: string }) => item.provider === "open_food_facts");
    expect(food).toMatchObject({ label: "测试豆奶 · 测试", carbohydrateGrams: null, license: "ODbL-1.0 / DbCL-1.0" });
    expect((await request("PUT", "/api/v1/nutrition/food-catalog/favorite", { foodId: food.id, isFavorite: true })).statusCode).toBe(204);
    const favorite = (await request("GET", "/api/v1/nutrition/food-catalog")).json().items[0];
    expect(favorite).toMatchObject({ id: food.id, version: food.version, isFavorite: true });
    expect((await request("GET", "/api/v1/nutrition/food-catalog", undefined, other)).json().items.every((item: { isFavorite: boolean }) => !item.isFavorite)).toBe(true);
    const created = await request("POST", "/api/v1/nutrition/meals", { occurredAt: "2026-09-07T00:00:00Z", localDate: "2026-09-07", timeZone: "UTC", name: "早餐", note: null });
    const meal = created.json();
    const payload = { mealRevision: 1, submissionId: randomUUID(), selections: [{ foodId: food.id, version: food.version, amount: 250 }] };
    const url = `/api/v1/nutrition/meals/${meal.id}/food-selections`;
    expect((await request("POST", url, payload, other)).statusCode).toBe(404);
    const saved = await request("POST", url, payload);
    expect(saved.statusCode, saved.body).toBe(201);
    expect(saved.json()).toMatchObject({ contributions: [{ energyKcal: 150, carbohydrateGrams: null, foodSnapshot: { id: food.id, basisAmount: 100, energyKcal: 60 } }] });
    const retry = await request("POST", url, payload);
    expect(retry.json()).toEqual(saved.json());
    const forged = await request("POST", url, { ...payload, selections: [{ ...payload.selections[0], energyKcal: 9999 }] });
    // Fastify strips extra request fields; they cannot override server-side nutrition.
    expect(forged.statusCode).toBe(201);
    expect(forged.json()).toEqual(saved.json());
    const item = saved.json().contributions[0];
    const replacementUrl = `/api/v1/nutrition/meals/${meal.id}/contributions/${item.id}/food-selection`;
    const replacement = { mealRevision: saved.json().revision, contributionRevision: item.revision, foodId: food.id, version: food.version, amount: 50, energyKcal: 9999 };
    expect((await app.inject({ method: "PUT", url: replacementUrl, payload: replacement })).statusCode).toBe(401);
    expect((await request("PUT", replacementUrl, replacement, other)).statusCode).toBe(404);
    expect((await request("PUT", replacementUrl, { ...replacement, amount: 0 })).statusCode).toBe(400);
    const replaced = await request("PUT", replacementUrl, replacement);
    expect(replaced.statusCode, replaced.body).toBe(200);
    expect(replaced.json()).toMatchObject({ contributions: [{ id: item.id, energyKcal: 30, portionAmount: 50, carbohydrateGrams: null, foodSnapshot: { id: food.id, energyKcal: 60 } }] });
    expect((await request("PUT", replacementUrl, replacement)).statusCode).toBe(409);
  } finally { await app.close(); }
});
