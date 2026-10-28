import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../../app.js";
import { createTestConfig } from "../../testing/test-config.js";
import { MemoryIdentityRepository } from "../identity/memory-repository.js";
import { IdentityService } from "../identity/service.js";
import { MemoryTemporaryMediaStore } from "../media/memory-temporary-media-store.js";
import { MemoryNutritionRepository } from "../nutrition/memory-repository.js";
import { NutritionService } from "../nutrition/service.js";
import { MemoryPlanningRepository } from "../planning/memory-repository.js";
import { PlanningService } from "../planning/service.js";
import { MemoryTaskQueue } from "../tasks/memory-task-queue.js";
import { MemoryImageAnalysisRepository } from "./memory-repository.js";
import {
  FixedImageAnalyzer,
  ImageAnalysisService,
  mealImageQueue,
  mealImageQueueDefinition,
} from "./service.js";

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => Promise.all(apps.splice(0).map(async (app) => app.close())));

type AnalysisResponse = {
  id: string;
  status: string;
  revision: number;
  candidate: { energyKcal: number } | null;
};

async function correctedLegacyCandidate() {
  const config = createTestConfig({ webDistDirectory: "/directory-that-does-not-exist" });
  const identityService = new IdentityService({ repository: new MemoryIdentityRepository(), sessionSecret: config.sessionSecret, sessionTtlHours: config.sessionTtlHours });
  const nutritionService = new NutritionService(new MemoryNutritionRepository());
  const original = { energyKcal: 100, proteinGrams: 0, carbohydrateGrams: null, fatGrams: 0 };
  const imageAnalysisService = new ImageAnalysisService({
    repository: new MemoryImageAnalysisRepository(), mediaStore: new MemoryTemporaryMediaStore(), queue: new MemoryTaskQueue(),
    analyzer: new FixedImageAnalyzer({ title: "本地旧整餐结果", observedFoods: [], ...original, confidence: "low", assumptions: [], uncertaintyNote: "仅本地固定测试" }),
    nutritionService, maxUploadBytes: config.imageUploadMaxBytes,
  });
  const app = await buildApp({ config, checkDatabase: async () => undefined, identityService, imageAnalysisService, nutritionService, planningService: new PlanningService(new MemoryPlanningRepository()) });
  apps.push(app);
  const registration = await app.inject({ method: "POST", url: "/api/v1/auth/register", payload: { username: "nullable-image-route", password: "only local nullable image password" } });
  expect(registration.statusCode, registration.body).toBe(201);
  const owner = registration.json<{ id: string }>().id;
  const headers = { cookie: String(registration.headers["set-cookie"]).split(";", 1)[0] };
  const meal = await nutritionService.createMeal(owner, { occurredAt: "2026-10-28T04:00:00Z", localDate: "2026-10-28", timeZone: "UTC", name: "旧照片营养核对", note: null });
  const uploaded = await imageAnalysisService.request(owner, meal.id, "image/png", Readable.from(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])), true);
  await imageAnalysisService.process(uploaded.id);
  const listed = await app.inject({ method: "GET", url: `/api/v1/image-analyses?mealId=${meal.id}`, headers });
  expect(listed.statusCode, listed.body).toBe(200);
  const analysis = listed.json<AnalysisResponse[]>()[0]!;
  expect(analysis).toMatchObject({ status: "succeeded", candidate: original });
  const currentMeal = await nutritionService.getMeal(owner, meal.id);
  const input = { analysisRevision: analysis.revision, mealRevision: currentMeal.revision, mode: "whole_meal", label: "本地修正值", portionAmount: null, portionUnit: null, basisDescription: "旧照片结果修正", replaceExisting: false, deleteOriginal: false };
  return { app, headers, owner, nutritionService, imageAnalysisService, mealId: meal.id, analysisId: analysis.id, input, original };
}

describe("image analysis routes", () => {
  it.each([
    { name: "zero protein and fat beside unknown carbohydrate", nutrients: { energyKcal: 111, proteinGrams: 0, carbohydrateGrams: null, fatGrams: 0 } },
    { name: "zero energy and carbohydrate beside unknown fat", nutrients: { energyKcal: 0, proteinGrams: 4, carbohydrateGrams: 0, fatGrams: null } },
    { name: "four explicitly known zeroes", nutrients: { energyKcal: 0, proteinGrams: 0, carbohydrateGrams: 0, fatGrams: 0 } },
  ])("preserves $name when adopting and rereading a corrected legacy result", async ({ nutrients }) => {
    const values = await correctedLegacyCandidate();
    const adopted = await values.app.inject({ method: "POST", url: `/api/v1/image-analyses/${values.analysisId}/adopt`, headers: values.headers, payload: { ...values.input, ...nutrients } });
    expect(adopted.statusCode, adopted.body).toBe(200);
    expect(adopted.json()).toMatchObject({ analysis: { adoptedAt: expect.any(String), candidate: values.original }, meal: { contributions: [nutrients] } });
    const saved = await values.app.inject({ method: "GET", url: "/api/v1/nutrition/meals?from=2026-10-28&to=2026-10-28", headers: values.headers });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toMatchObject([{ id: values.mealId, contributions: [nutrients] }]);
    expect((await values.nutritionService.getMeal(values.owner, values.mealId)).contributions).toEqual([expect.objectContaining(nutrients)]);
  });

  it("still rejects a legacy whole-meal correction with no known nutrients and keeps the original record", async () => {
    const values = await correctedLegacyCandidate();
    const adopted = await values.app.inject({ method: "POST", url: `/api/v1/image-analyses/${values.analysisId}/adopt`, headers: values.headers,
      payload: { ...values.input, energyKcal: null, proteinGrams: null, carbohydrateGrams: null, fatGrams: null } });
    expect(adopted.statusCode, adopted.body).toBe(400);
    expect(adopted.json()).toMatchObject({ code: "invalid_nutrition_input" });
    expect((await values.nutritionService.getMeal(values.owner, values.mealId)).contributions).toEqual([expect.objectContaining(values.original)]);
    expect((await values.imageAnalysisService.list(values.owner, values.mealId))[0]).toMatchObject({ adoptedAt: null, imageAvailable: true, candidate: values.original });
  });

  it("uploads, processes and adopts a corrected candidate for an authenticated meal", async () => {
    const config = createTestConfig({ webDistDirectory: "/directory-that-does-not-exist" });
    const identityService = new IdentityService({
      repository: new MemoryIdentityRepository(),
      sessionSecret: config.sessionSecret,
      sessionTtlHours: config.sessionTtlHours,
    });
    const nutritionService = new NutritionService(new MemoryNutritionRepository());
    const queue = new MemoryTaskQueue();
    const imageAnalysisService = new ImageAnalysisService({
      repository: new MemoryImageAnalysisRepository(),
      mediaStore: new MemoryTemporaryMediaStore(),
      queue,
      analyzer: new FixedImageAnalyzer({
        title: "食堂套餐",
        observedFoods: [{ label: "米饭", estimatedPortion: "1 碗", note: null }],
        energyKcal: 600,
        proteinGrams: 25,
        carbohydrateGrams: 80,
        fatGrams: 18,
        confidence: "medium",
        assumptions: ["按常见份量估算"],
        uncertaintyNote: "烹调油不可见。",
      }),
      nutritionService,
      maxUploadBytes: config.imageUploadMaxBytes,
    });
    await queue.start();
    await queue.ensureQueue(mealImageQueueDefinition);
    await queue.work(mealImageQueue, (analysisId) => imageAnalysisService.process(analysisId));
    const app = await buildApp({
      config,
      checkDatabase: async () => undefined,
      identityService,
      imageAnalysisService,
      nutritionService,
      planningService: new PlanningService(new MemoryPlanningRepository()),
    });
    apps.push(app);
    const registration = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: { username: "image-route", password: "correct horse battery staple" },
    });
    const cookie = String(registration.headers["set-cookie"]).split(";", 1)[0];
    const settings = await app.inject({ method: "GET", url: "/api/v1/photo-analysis-settings", headers: { cookie } });
    expect(settings.json()).toMatchObject({ automatic: false, consentAt: null, revision: 1 });
    const noConsent = await app.inject({ method: "PUT", url: "/api/v1/photo-analysis-settings", headers: { cookie }, payload: { revision: 1, automatic: true, consent: false } });
    expect(noConsent.statusCode).toBe(400);
    const enabled = await app.inject({ method: "PUT", url: "/api/v1/photo-analysis-settings", headers: { cookie }, payload: { revision: 1, automatic: true, consent: true } });
    expect(enabled.statusCode).toBe(200);
    const createdMeal = await app.inject({
      method: "POST",
      url: "/api/v1/nutrition/meals",
      headers: { cookie },
      payload: {
        occurredAt: "2026-08-26T04:00:00.000Z",
        localDate: "2026-08-26",
        timeZone: "Asia/Shanghai",
        name: "午饭",
        note: null,
      },
    });
    const meal = createdMeal.json<{ id: string; revision: number }>();
    const uploaded = await app.inject({
      method: "POST",
      url: `/api/v1/image-analyses?mealId=${meal.id}`,
      headers: { cookie, "content-type": "image/png" },
      payload: Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
      ]),
    });
    expect(uploaded.statusCode, uploaded.body).toBe(202);
    const analysisId = uploaded.json<{ id: string }>().id;
    const photoUrl = `/api/v1/image-analyses/${analysisId}/original`;
    expect((await app.inject({ method: "GET", url: photoUrl })).statusCode).toBe(401);
    const photo = await app.inject({ method: "GET", url: photoUrl, headers: { cookie } });
    expect(photo.statusCode).toBe(200);
    expect(photo.headers["cache-control"]).toBe("private, no-store");
    expect(photo.headers["content-type"]).toBe("image/png");
    expect(photo.rawPayload.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

    let analysis: AnalysisResponse | null = null;
    for (let count = 0; count < 10; count += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const listed = await app.inject({
        method: "GET",
        url: `/api/v1/image-analyses?mealId=${meal.id}`,
        headers: { cookie },
      });
      analysis = listed.json<AnalysisResponse[]>()[0] ?? null;
      if (analysis?.status === "succeeded") break;
    }
    expect(analysis).toMatchObject({
      id: analysisId,
      status: "succeeded",
      candidate: { energyKcal: 600 },
    });
    const mealsAfterAnalysis = await app.inject({
      method: "GET",
      url: "/api/v1/nutrition/meals?from=2026-08-26&to=2026-08-26",
      headers: { cookie },
    });
    const currentMeal = mealsAfterAnalysis.json<Array<{ revision: number; contributions: Array<{ id: string; reviewStatus: string; energyKcal: number }> }>>()[0]!;
    expect(currentMeal.contributions).toEqual([
      expect.objectContaining({ reviewStatus: "tentative", energyKcal: 600 }),
    ]);

    const adopted = await app.inject({
      method: "POST",
      url: `/api/v1/image-analyses/${analysisId}/adopt`,
      headers: { cookie },
      payload: {
        analysisRevision: analysis!.revision,
        mealRevision: currentMeal.revision,
        mode: "whole_meal",
        label: "食堂套餐（修正）",
        portionAmount: null,
        portionUnit: null,
        basisDescription: "照片估算后修正",
        energyKcal: 550,
        proteinGrams: 27,
        carbohydrateGrams: 75,
        fatGrams: 16,
        replaceExisting: false,
        deleteOriginal: true,
      },
    });
    expect(adopted.statusCode, adopted.body).toBe(200);
    expect((await app.inject({ method: "GET", url: photoUrl, headers: { cookie } })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: photoUrl, headers: { cookie } })).statusCode).toBe(204);
    expect(adopted.json()).toMatchObject({
      analysis: { adoptedAt: expect.any(String), imageAvailable: false },
      meal: {
        contributions: [
          { id: currentMeal.contributions[0]!.id, source: "model_adopted", reviewStatus: "confirmed", sourceAnalysisId: analysisId, energyKcal: 550, revision: 2 },
        ],
      },
    });
  });
});
