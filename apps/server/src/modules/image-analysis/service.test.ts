import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import { MemoryTemporaryMediaStore } from "../media/memory-temporary-media-store.js";
import { MemoryNutritionRepository } from "../nutrition/memory-repository.js";
import { NutritionService } from "../nutrition/service.js";
import { MemoryTaskQueue } from "../tasks/memory-task-queue.js";
import type { ImageAnalyzer } from "./analyzer.js";
import { MemoryImageAnalysisRepository } from "./memory-repository.js";
import { FixedImageAnalyzer, ImageAnalysisService } from "./service.js";

const png = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00,
]);
const candidate = {
  title: "鸡腿饭",
  observedFoods: [
    { label: "鸡腿", estimatedPortion: "1 个", note: "无法判断吸油量" },
  ],
  energyKcal: 620,
  proteinGrams: 32,
  carbohydrateGrams: 76,
  fatGrams: 20,
  confidence: "medium" as const,
  assumptions: ["按常见食堂份量估算"],
  uncertaintyNote: "请按实际剩余量修正。",
};

async function fixture(
  analyzer: ImageAnalyzer = new FixedImageAnalyzer(candidate),
  limits: { readonly maxActiveAnalysesPerAccount?: number; readonly temporaryMediaMaxBytesPerAccount?: number } = {},
  repository: MemoryImageAnalysisRepository = new MemoryImageAnalysisRepository(),
) {
  const nutritionService = new NutritionService(new MemoryNutritionRepository());
  const mediaStore = new MemoryTemporaryMediaStore();
  const queue = new MemoryTaskQueue();
  const service = new ImageAnalysisService({
    repository,
    mediaStore,
    queue,
    analyzer,
    nutritionService,
    maxUploadBytes: 1024,
    ...limits,
  });
  const meal = await nutritionService.createMeal("user-1", {
    occurredAt: "2026-08-26T04:00:00.000Z",
    localDate: "2026-08-26",
    timeZone: "Asia/Shanghai",
    name: "午饭",
    note: null,
  });
  return { nutritionService, repository, mediaStore, queue, service, meal };
}

class ConflictOnceImageAnalysisRepository extends MemoryImageAnalysisRepository {
  readonly #conflicts = new Set<string>();

  public override async markAdopted(userId: string, id: string, revision: number) {
    if (!this.#conflicts.has(id)) {
      this.#conflicts.add(id);
      return "revision_conflict" as const;
    }
    return super.markAdopted(userId, id, revision);
  }
}

describe("ImageAnalysisService", () => {
  it("tentatively counts a first model result and preserves that revision when the user confirms an edit", async () => {
    const values = await fixture();
    const pending = await values.service.request(
      "user-1",
      values.meal.id,
      "image/png",
      Readable.from(png),
    );
    expect(pending.status).toBe("pending");

    await values.service.process(pending.id);
    const [succeeded] = await values.service.list("user-1", values.meal.id);
    expect(succeeded).toMatchObject({
      status: "succeeded",
      candidate: { energyKcal: 620, confidence: "medium" },
      adoptedAt: null,
    });
    const tentativeMeal = await values.nutritionService.getMeal("user-1", values.meal.id);
    expect(tentativeMeal.contributions).toMatchObject([{
      source: "model_adopted",
      reviewStatus: "tentative",
      sourceAnalysisId: pending.id,
      energyKcal: 620,
    }]);
    const tentativeId = tentativeMeal.contributions[0]!.id;

    const adopted = await values.service.adopt(
      "user-1",
      pending.id,
      succeeded!.revision,
      tentativeMeal.revision,
      {
        mode: "whole_meal",
        label: "鸡腿饭（按实际份量修正）",
        portionAmount: null,
        portionUnit: null,
        basisDescription: "照片估算后人工修正",
        energyKcal: 580,
        proteinGrams: 30,
        carbohydrateGrams: 72,
        fatGrams: 18,
        replaceExisting: false,
        deleteOriginal: true,
      },
    );

    expect(adopted.meal.contributions).toMatchObject([
      {
        source: "model_adopted",
        reviewStatus: "confirmed",
        sourceAnalysisId: pending.id,
        energyKcal: 580,
        id: tentativeId,
        revision: 2,
      },
    ]);
    expect(await values.nutritionService.listContributionRevisions("user-1", values.meal.id)).toEqual([
      expect.objectContaining({ contributionId: tentativeId, reviewStatus: "tentative", energyKcal: 620 }),
    ]);
    expect(adopted.analysis.adoptedAt).not.toBeNull();
    expect(adopted.analysis.imageAvailable).toBe(false);
    expect(await values.mediaStore.exists((await values.repository.getWorkItem(pending.id))!.objectKey)).toBe(false);
  });

  it("rejects fake images and never leaves the uploaded bytes behind", async () => {
    const values = await fixture();
    await expect(
      values.service.request(
        "user-1",
        values.meal.id,
        "image/png",
        Readable.from(Buffer.from("not an image")),
      ),
    ).rejects.toMatchObject({ code: "invalid_image" });
    expect(await values.repository.list("user-1", values.meal.id)).toHaveLength(0);
  });

  it("recovers an analysis status conflict without counting the confirmed estimate twice", async () => {
    const values = await fixture(new FixedImageAnalyzer(candidate), {}, new ConflictOnceImageAnalysisRepository());
    const pending = await values.service.request("user-1", values.meal.id, "image/png", Readable.from(png));
    await values.service.process(pending.id);
    const [succeeded] = await values.service.list("user-1", values.meal.id);
    const tentativeMeal = await values.nutritionService.getMeal("user-1", values.meal.id);
    const input = {
      mode: "whole_meal" as const,
      label: "鸡腿饭（已核对）",
      portionAmount: null,
      portionUnit: null,
      basisDescription: "人工核对",
      energyKcal: 580,
      proteinGrams: 30,
      carbohydrateGrams: 72,
      fatGrams: 18,
      replaceExisting: false,
      deleteOriginal: false,
    };

    await expect(values.service.adopt("user-1", pending.id, succeeded!.revision, tentativeMeal.revision, input)).rejects.toMatchObject({ code: "analysis_revision_conflict" });
    const afterConflict = await values.nutritionService.getMeal("user-1", values.meal.id);
    expect(afterConflict.contributions).toEqual([expect.objectContaining({ sourceAnalysisId: pending.id, reviewStatus: "confirmed", energyKcal: 580 })]);

    const currentAnalysis = await values.repository.get("user-1", pending.id);
    const recovered = await values.service.adopt("user-1", pending.id, currentAnalysis!.revision, afterConflict.revision, input);
    expect(recovered.analysis.adoptedAt).not.toBeNull();
    expect(recovered.meal.revision).toBe(afterConflict.revision);
    expect(recovered.meal.contributions).toHaveLength(1);
  });

  it("keeps a current manual value when a later image analysis succeeds", async () => {
    const values = await fixture();
    const manualMeal = await values.nutritionService.addContribution("user-1", values.meal.id, values.meal.revision, {
      mode: "whole_meal",
      label: "人工记录套餐",
      portionAmount: null,
      portionUnit: null,
      basisDescription: "食堂标牌与人工估算",
      energyKcal: 500,
      proteinGrams: 25,
      carbohydrateGrams: null,
      fatGrams: null,
    }, false);
    const pending = await values.service.request("user-1", values.meal.id, "image/png", Readable.from(png));
    await values.service.process(pending.id);

    const current = await values.nutritionService.getMeal("user-1", values.meal.id);
    expect(current.revision).toBe(manualMeal.revision);
    expect(current.contributions).toEqual([
      expect.objectContaining({ source: "manual", reviewStatus: "confirmed", label: "人工记录套餐", energyKcal: 500 }),
    ]);
    expect((await values.service.list("user-1", values.meal.id))[0]).toMatchObject({
      status: "succeeded",
      adoptedAt: null,
      candidate: { energyKcal: 620 },
    });
  });

  it("isolates analyses by account and ignores duplicate late processing", async () => {
    const values = await fixture();
    const pending = await values.service.request(
      "user-1",
      values.meal.id,
      "image/png",
      Readable.from(png),
    );
    await values.service.process(pending.id);
    await values.service.process(pending.id);

    expect(await values.service.list("user-1", values.meal.id)).toHaveLength(1);
    await expect(values.service.list("user-2", values.meal.id)).rejects.toMatchObject({
      code: "meal_not_found",
    });
    const current = await values.repository.get("user-1", pending.id);
    expect(current?.attempts).toHaveLength(1);
  });

  it("allows a failed analysis to be explicitly retried", async () => {
    let call = 0;
    const analyzer: ImageAnalyzer = {
      model: "failure-then-success",
      analyze: async () => {
        call += 1;
        if (call === 1) throw new Error("deepseek_http_503");
        return { candidate, providerRequestId: "request-2" };
      },
    };
    const values = await fixture(analyzer);
    const pending = await values.service.request(
      "user-1",
      values.meal.id,
      "image/png",
      Readable.from(png),
    );
    await expect(values.service.process(pending.id)).rejects.toThrow("deepseek_http_503");
    const failed = await values.repository.get("user-1", pending.id);
    expect(failed?.status).toBe("failed");

    const retried = await values.service.retry("user-1", pending.id, failed!.revision);
    expect(retried.status).toBe("pending");
    await values.service.process(pending.id);
    expect((await values.repository.get("user-1", pending.id))?.status).toBe("succeeded");
  });

  it("limits active analyses per account without affecting another account", async () => {
    const values = await fixture(new FixedImageAnalyzer(candidate), { maxActiveAnalysesPerAccount: 1 });
    await values.service.request("user-1", values.meal.id, "image/png", Readable.from(png));

    await expect(
      values.service.request("user-1", values.meal.id, "image/png", Readable.from(png)),
    ).rejects.toMatchObject({ code: "image_analysis_capacity_reached", statusCode: 429 });
    expect((await values.repository.getUsage("user-1")).activeAnalyses).toBe(1);
    expect((await values.repository.getUsage("user-2")).activeAnalyses).toBe(0);
  });

  it("deletes a newly uploaded file when the account media quota would be exceeded", async () => {
    const values = await fixture(new FixedImageAnalyzer(candidate), { temporaryMediaMaxBytesPerAccount: png.byteLength - 1 });

    await expect(
      values.service.request("user-1", values.meal.id, "image/png", Readable.from(png)),
    ).rejects.toMatchObject({ code: "temporary_media_quota_reached", statusCode: 429 });
    expect(values.mediaStore.size).toBe(0);
    expect(await values.repository.list("user-1", values.meal.id)).toHaveLength(0);
  });
});
