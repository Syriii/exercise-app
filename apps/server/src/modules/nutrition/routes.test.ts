import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../../app.js";
import { createTestConfig } from "../../testing/test-config.js";
import { MemoryIdentityRepository } from "../identity/memory-repository.js";
import { IdentityService } from "../identity/service.js";
import { MemoryPlanningRepository } from "../planning/memory-repository.js";
import { PlanningService } from "../planning/service.js";
import { MemoryNutritionRepository } from "./memory-repository.js";
import { FixedPublicFoodProvider } from "./public-food-provider.js";
import { NutritionService } from "./service.js";
import type { NutrientValues } from "./types.js";

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => Promise.all(apps.splice(0).map(async (app) => app.close())));

const nutrientKeys = ["energyKcal", "proteinGrams", "carbohydrateGrams", "fatGrams"] as const;
const nutrients = (value: number | null): NutrientValues => ({ energyKcal: value, proteinGrams: value, carbohydrateGrams: value, fatGrams: value });
type SavedMeal = { id: string; revision: number; contributions: Array<NutrientValues & { id: string; revision: number }> };

async function authenticatedNutritionApp() {
  const config = createTestConfig({ webDistDirectory: "/directory-that-does-not-exist" });
  const identityService = new IdentityService({ repository: new MemoryIdentityRepository(), sessionSecret: config.sessionSecret, sessionTtlHours: config.sessionTtlHours });
  const app = await buildApp({ config, checkDatabase: async () => undefined, identityService, planningService: new PlanningService(new MemoryPlanningRepository()), nutritionService: new NutritionService(new MemoryNutritionRepository()) });
  apps.push(app);
  const registration = await app.inject({ method: "POST", url: "/api/v1/auth/register", payload: { username: "nullable-nutrition", password: "only local nullable nutrition password" } });
  expect(registration.statusCode, registration.body).toBe(201);
  return { app, headers: { cookie: String(registration.headers["set-cookie"]).split(";", 1)[0] } };
}

const mealPayload = { occurredAt: "2026-10-28T04:00:00.000Z", localDate: "2026-10-28", timeZone: "Asia/Shanghai", name: "核对午饭", note: null };
const foodPayload = { mode: "item", label: "核对食物", portionAmount: 100, portionUnit: "g", basisDescription: "本地测试明确输入" } as const;

describe("nutrition routes", () => {
  it.each([0, null])("preserves all four nutrients when adding %s and correcting to the other nullable value", async initial => {
    const { app, headers } = await authenticatedNutritionApp();
    const created = await app.inject({ method: "POST", url: "/api/v1/nutrition/meals", headers, payload: mealPayload });
    expect(created.statusCode, created.body).toBe(201);
    const meal = created.json<SavedMeal>();
    const added = await app.inject({ method: "POST", url: `/api/v1/nutrition/meals/${meal.id}/contributions`, headers,
      payload: { ...foodPayload, ...nutrients(initial), mealRevision: meal.revision, replaceExisting: false } });
    expect(added.statusCode, added.body).toBe(201);
    const saved = added.json<SavedMeal>();
    expect(saved.contributions).toEqual([expect.objectContaining(nutrients(initial))]);
    const initialRead = await app.inject({ method: "GET", url: "/api/v1/nutrition/meals?from=2026-10-28&to=2026-10-28", headers });
    expect(initialRead.statusCode, initialRead.body).toBe(200);
    expect(initialRead.json()).toMatchObject([{ contributions: [nutrients(initial)] }]);
    const initialSummary = await app.inject({ method: "GET", url: "/api/v1/nutrition/day-summary?localDate=2026-10-28&timeZone=Asia%2FShanghai", headers });
    expect(initialSummary.statusCode, initialSummary.body).toBe(200);
    for (const key of nutrientKeys) expect(initialSummary.json()[key]).toMatchObject({ recorded: initial, complete: initial !== null });

    const correctedValue = initial === null ? 0 : null;
    const item = saved.contributions[0]!;
    const corrected = await app.inject({ method: "PUT", url: `/api/v1/nutrition/meals/${meal.id}/contributions/${item.id}`, headers,
      payload: { ...foodPayload, ...nutrients(correctedValue), mealRevision: saved.revision, contributionRevision: item.revision, replaceExisting: false } });
    expect(corrected.statusCode, corrected.body).toBe(200);
    expect(corrected.json()).toMatchObject({ contributions: [nutrients(correctedValue)] });
    const finalRead = await app.inject({ method: "GET", url: "/api/v1/nutrition/meals?from=2026-10-28&to=2026-10-28", headers });
    expect(finalRead.statusCode, finalRead.body).toBe(200);
    expect(finalRead.json()).toMatchObject([{ contributions: [nutrients(correctedValue)] }]);
    const finalSummary = await app.inject({ method: "GET", url: "/api/v1/nutrition/day-summary?localDate=2026-10-28&timeZone=Asia%2FShanghai", headers });
    expect(finalSummary.statusCode, finalSummary.body).toBe(200);
    for (const key of nutrientKeys) expect(finalSummary.json()[key]).toMatchObject({ recorded: correctedValue, complete: correctedValue !== null });
  });

  it.each([0, null])("preserves %s in personal templates, corrections and reuse from the catalog", async initial => {
    const { app, headers } = await authenticatedNutritionApp();
    const created = await app.inject({ method: "POST", url: "/api/v1/nutrition/food-templates", headers,
      payload: { ...foodPayload, ...nutrients(initial) } });
    expect(created.statusCode, created.body).toBe(201);
    const template = created.json<{ id: string; revision: number } & NutrientValues>();
    expect(template).toMatchObject(nutrients(initial));
    const initialRead = await app.inject({ method: "GET", url: "/api/v1/nutrition/food-templates", headers });
    expect(initialRead.statusCode, initialRead.body).toBe(200);
    expect(initialRead.json()).toMatchObject([nutrients(initial)]);

    const correctedValue = initial === null ? 0 : null;
    const changed = await app.inject({ method: "PUT", url: `/api/v1/nutrition/food-templates/${template.id}`, headers,
      payload: { ...foodPayload, label: "已修正模板", ...nutrients(correctedValue), revision: template.revision } });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(changed.json()).toMatchObject(nutrients(correctedValue));
    const finalRead = await app.inject({ method: "GET", url: "/api/v1/nutrition/food-templates", headers });
    expect(finalRead.statusCode, finalRead.body).toBe(200);
    expect(finalRead.json()).toMatchObject([nutrients(correctedValue)]);
    const catalog = await app.inject({ method: "GET", url: "/api/v1/nutrition/food-catalog?query=%E5%B7%B2%E4%BF%AE%E6%AD%A3%E6%A8%A1%E6%9D%BF&limit=1", headers });
    expect(catalog.statusCode, catalog.body).toBe(200);
    const food = catalog.json<{ items: Array<{ id: string; version: string } & NutrientValues> }>().items[0]!;
    expect(food).toMatchObject(nutrients(correctedValue));
    const newMeal = await app.inject({ method: "POST", url: "/api/v1/nutrition/meals", headers, payload: mealPayload });
    expect(newMeal.statusCode, newMeal.body).toBe(201);
    const meal = newMeal.json<SavedMeal>();
    const reused = await app.inject({ method: "POST", url: `/api/v1/nutrition/meals/${meal.id}/food-selections`, headers,
      payload: { mealRevision: meal.revision, submissionId: randomUUID(), selections: [{ foodId: food.id, version: food.version, amount: 200 }] } });
    expect(reused.statusCode, reused.body).toBe(201);
    expect(reused.json()).toMatchObject({ contributions: [{ ...nutrients(correctedValue), foodSnapshot: nutrients(correctedValue) }] });
  });

  it("serializes an authenticated meal contribution and day summary", async () => {
    const config = createTestConfig({ webDistDirectory: "/directory-that-does-not-exist" });
    const identityService = new IdentityService({ repository: new MemoryIdentityRepository(), sessionSecret: config.sessionSecret, sessionTtlHours: config.sessionTtlHours });
    const app = await buildApp({ config, checkDatabase: async () => undefined, identityService, planningService: new PlanningService(new MemoryPlanningRepository()), nutritionService: new NutritionService(new MemoryNutritionRepository(), new FixedPublicFoodProvider([{ id: "open_food_facts:6907992515960", provider: "open_food_facts", label: "原浆豆奶", brand: "示例品牌", barcode: "6907992515960", basisAmount: 100, basisUnit: "g", energyKcal: 62, proteinGrams: 6, carbohydrateGrams: 1.5, fatGrams: 3.6, sourceUrl: "https://world.openfoodfacts.org/product/6907992515960" }])) });
    apps.push(app);
    const registration = await app.inject({ method: "POST", url: "/api/v1/auth/register", payload: { username: "nutrition-route", password: "correct horse battery staple" } });
    const cookie = String(registration.headers["set-cookie"]).split(";", 1)[0];
    const created = await app.inject({ method: "POST", url: "/api/v1/nutrition/meals", headers: { cookie }, payload: { occurredAt: "2026-08-26T04:00:00.000Z", localDate: "2026-08-26", timeZone: "Asia/Shanghai", name: "午饭", note: null } });
    expect(created.statusCode).toBe(201);
    const meal = created.json<{ id: string; revision: number }>();
    const contribution = await app.inject({ method: "POST", url: `/api/v1/nutrition/meals/${meal.id}/contributions`, headers: { cookie }, payload: { mealRevision: meal.revision, replaceExisting: false, mode: "item", label: "米饭", portionAmount: 200, portionUnit: "g", basisDescription: null, energyKcal: 232, proteinGrams: 5.2, carbohydrateGrams: 51.8, fatGrams: null } });
    expect(contribution.statusCode, contribution.body).toBe(201);
    expect(contribution.json()).toMatchObject({ contributions: [{ label: "米饭", fatGrams: null }] });
    const search = await app.inject({ method: "GET", url: "/api/v1/nutrition/food-search?query=%E7%B1%B3%E9%A5%AD&asOfDate=2026-08-26", headers: { cookie } });
    expect(search.statusCode, search.body).toBe(200);
    expect(search.json()).toMatchObject([{ label: "米饭", source: "recent_meal", energyKcal: 232 }]);
    const publicSearch = await app.inject({ method: "POST", url: "/api/v1/nutrition/public-food-search", headers: { cookie }, payload: { query: "豆奶" } });
    expect(publicSearch.statusCode, publicSearch.body).toBe(200);
    expect(publicSearch.json()).toMatchObject([{ provider: "open_food_facts", label: "原浆豆奶", basisAmount: 100, energyKcal: 62 }]);
    const anonymousPublicSearch = await app.inject({ method: "POST", url: "/api/v1/nutrition/public-food-search", payload: { query: "豆奶" } });
    expect(anonymousPublicSearch.statusCode).toBe(401);
    const summary = await app.inject({ method: "GET", url: "/api/v1/nutrition/day-summary?localDate=2026-08-26&timeZone=Asia%2FShanghai", headers: { cookie } });
    expect(summary.statusCode, summary.body).toBe(200);
    expect(summary.json()).toMatchObject({ energyKcal: { recorded: 232 }, fatGrams: { recorded: null, complete: false } });
    const createdPlan = await app.inject({ method: "POST", url: "/api/v1/nutrition/diet-plans", headers: { cookie }, payload: { dateFrom: "2026-08-24", dateTo: "2026-08-30", title: "本周饮食安排", note: "食堂为主", entries: [{ localDate: null, mealName: null, foodPlan: "每天找一份蔬菜", note: null }, { localDate: "2026-08-26", mealName: "午饭", foodPlan: "米饭半份、鸡腿一份", note: null }] } });
    expect(createdPlan.statusCode, createdPlan.body).toBe(201);
    expect(createdPlan.json()).toMatchObject({ title: "本周饮食安排", revision: 1, entries: [{ id: expect.any(String), localDate: null }, { mealName: "午饭" }] });
    const plans = await app.inject({ method: "GET", url: "/api/v1/nutrition/diet-plans?from=2026-08-26&to=2026-08-26", headers: { cookie } });
    expect(plans.statusCode, plans.body).toBe(200);
    expect(plans.json()).toMatchObject([{ title: "本周饮食安排" }]);

    const otherRegistration = await app.inject({ method: "POST", url: "/api/v1/auth/register", payload: { username: "nutrition-other", password: "another correct horse battery staple" } });
    const otherCookie = String(otherRegistration.headers["set-cookie"]).split(";", 1)[0];
    const otherPlans = await app.inject({ method: "GET", url: "/api/v1/nutrition/diet-plans?from=2026-08-26&to=2026-08-26", headers: { cookie: otherCookie } });
    expect(otherPlans.statusCode, otherPlans.body).toBe(200);
    expect(otherPlans.json()).toEqual([]);
    const savedMeal = contribution.json<{ revision: number; contributions: Array<{ id: string; revision: number }> }>();
    const item = savedMeal.contributions[0]!;
    const portionUrl = `/api/v1/nutrition/meals/${meal.id}/contributions/${item.id}/portion`;
    const portionPayload = { mealRevision: savedMeal.revision, contributionRevision: item.revision, portionAmount: 100 };
    expect((await app.inject({ method: "PATCH", url: portionUrl, payload: portionPayload })).statusCode).toBe(401);
    expect((await app.inject({ method: "PATCH", url: portionUrl, headers: { cookie: otherCookie }, payload: portionPayload })).statusCode).toBe(404);
    expect((await app.inject({ method: "PATCH", url: portionUrl, headers: { cookie }, payload: { ...portionPayload, portionAmount: -1 } })).statusCode).toBe(400);
    const changed = await app.inject({ method: "PATCH", url: portionUrl, headers: { cookie }, payload: portionPayload });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(changed.json()).toMatchObject({ contributions: [{ energyKcal: 116, proteinGrams: 2.6, fatGrams: null }] });
    expect((await app.inject({ method: "PATCH", url: portionUrl, headers: { cookie }, payload: portionPayload })).statusCode).toBe(409);
  });
});
