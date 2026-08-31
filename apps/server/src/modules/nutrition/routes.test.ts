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

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => Promise.all(apps.splice(0).map(async (app) => app.close())));

describe("nutrition routes", () => {
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
  });
});
