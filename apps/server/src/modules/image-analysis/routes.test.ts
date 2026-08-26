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

describe("image analysis routes", () => {
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
