import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";

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
  it("keeps manual uploads waiting, starts only the selected photo, and never bulk starts old photos", async () => {
    const values = await fixture();
    expect(await values.service.settings("user-1")).toMatchObject({ automatic: false, consentAt: null });
    const first = await values.service.request("user-1", values.meal.id, "image/png", Readable.from(png), false);
    const second = await values.service.request("user-1", values.meal.id, "image/png", Readable.from(png), false);
    await values.service.process(first.id);
    expect((await values.service.list("user-1", values.meal.id)).every(value => value.status === "waiting")).toBe(true);
    await expect(values.service.saveSettings("user-1", 1, true, false)).rejects.toMatchObject({ code: "photo_consent_required" });
    await values.service.saveSettings("user-1", 1, true, true);
    expect((await values.service.list("user-1", values.meal.id)).every(value => value.status === "waiting")).toBe(true);
    await values.service.retry("user-1", first.id, first.revision);
    await expect(values.service.retry("user-1", first.id, first.revision)).rejects.toMatchObject({ statusCode: 409 });
    expect((await values.repository.get("user-1", second.id))?.status).toBe("waiting");
    expect(await values.service.settings("user-2")).toMatchObject({ automatic: false, consentAt: null });
    await values.repository.markMediaStatus((await values.repository.getWorkItem(second.id))!.mediaId, "deleted");
    await expect(values.service.retry("user-1", second.id, second.revision)).rejects.toMatchObject({ statusCode: 409 });
  });

  it("replaces a previewed subset once, preserves other foods, undoes once and rejects later edits", async () => {
    const foods = [{ label: "照片鸡蛋", portionAmount: 2, portionUnit: "个", note: null, energyKcal: 140, proteinGrams: 12, carbohydrateGrams: 2, fatGrams: 10 }];
    const values = await fixture(new FixedImageAnalyzer({ ...candidate, foods }));
    const manual = { mode: "item" as const, label: "原来的鸡蛋", portionAmount: 1, portionUnit: "个", basisDescription: null, energyKcal: 70, proteinGrams: 6, carbohydrateGrams: 1, fatGrams: 5 };
    let meal = await values.nutritionService.addContribution("user-1", values.meal.id, 1, manual, false);
    const replacedId = meal.contributions[0]!.id;
    meal = await values.nutritionService.addContribution("user-1", meal.id, meal.revision, { ...manual, label: "照片外的豆浆", energyKcal: 100 }, false);
    const pending = await values.service.request("user-1", meal.id, "image/png", Readable.from(png));
    await values.service.process(pending.id);
    const analysis = (await values.service.list("user-1", meal.id))[0]!;
    const input = { operationId: randomUUID(), mealRevision: meal.revision, analysisRevision: analysis.revision, replaceIds: [replacedId] };
    await expect(values.service.replaceFoods("user-2", analysis.id, input)).rejects.toMatchObject({ statusCode: 404 });
    const replaced = await values.service.replaceFoods("user-1", analysis.id, input);
    expect(replaced.meal.contributions.map(item => item.label)).toEqual(["照片外的豆浆", "照片鸡蛋"]);
    expect((await values.service.replaceFoods("user-1", analysis.id, input)).meal.revision).toBe(replaced.meal.revision);
    await expect(values.service.replaceFoods("user-1", analysis.id, { ...input, replaceIds: [] })).rejects.toMatchObject({ statusCode: 409 });
    const undoInput = { ...input, mealRevision: replaced.meal.revision, analysisRevision: replaced.analysis.revision };
    const restored = await values.service.replaceFoods("user-1", analysis.id, undoInput, true);
    expect(restored.meal.contributions.map(item => item.label)).toEqual(["原来的鸡蛋", "照片外的豆浆"]);
    expect((await values.service.replaceFoods("user-1", analysis.id, undoInput, true)).meal.revision).toBe(restored.meal.revision);
    const reapplied = await values.service.replaceFoods("user-1", analysis.id, { ...input, operationId: randomUUID(), mealRevision: restored.meal.revision, analysisRevision: restored.analysis.revision });
    expect(reapplied.meal.contributions.map(item => item.label)).toEqual(["照片外的豆浆", "照片鸡蛋"]);
    await values.nutritionService.addContribution("user-1", meal.id, reapplied.meal.revision, { ...manual, label: "后来加的" }, false);
    await expect(values.service.replaceFoods("user-1", analysis.id, undoInput, true)).rejects.toMatchObject({ statusCode: 409 });
    await expect(values.service.replaceFoods("user-1", analysis.id, input)).rejects.toMatchObject({ statusCode: 409 });
  });

  it("retains an uploaded image when enqueue fails and allows safe manual retry", async () => {
    const values = await fixture();
    values.queue.enqueue = async () => { throw new Error("queue offline"); };
    const saved = await values.service.request("user-1", values.meal.id, "image/png", Readable.from(png));
    expect(saved).toMatchObject({ status: "failed", lastErrorCode: "queue_unavailable", imageAvailable: true });
    expect(await values.mediaStore.open((await values.repository.getWorkItem(saved.id))!.objectKey)).toBeTruthy();
  });

  it("creates a fresh reanalysis without overwriting the old result and rejects repeated source revisions", async () => {
    const values = await fixture();
    const first = await values.service.request("user-1", values.meal.id, "image/png", Readable.from(png));
    await values.service.process(first.id);
    const original = (await values.service.list("user-1", values.meal.id))[0]!;
    const fresh = await values.service.reanalyze("user-1", first.id, original.revision);
    expect(fresh.id).not.toBe(first.id);
    expect(fresh.candidate).toBeNull();
    await expect(values.service.reanalyze("user-1", first.id, original.revision)).rejects.toMatchObject({ statusCode: 409 });
    expect((await values.repository.get("user-1", first.id))?.candidate).toEqual(candidate);
    expect((await values.repository.getUsage("user-1")).temporaryMediaBytes).toBe(png.length);
  });

  it("does not apply a late result after its original photo has been deleted", async () => {
    const values = await fixture();
    const pending = await values.service.request("user-1", values.meal.id, "image/png", Readable.from(png));
    const attempt = await values.repository.beginAttempt(pending.id);
    if (typeof attempt === "string") throw new Error("expected attempt");
    await values.repository.markMediaStatus(attempt.work.mediaId, "deleted");
    expect(await values.repository.succeed(pending.id, attempt.attemptId, candidate, "late-deleted")).toBe("not_running");
    expect(await values.repository.get("user-1", pending.id)).toMatchObject({ status: "cancelled", candidate: null });
    expect((await values.nutritionService.getMeal("user-1", values.meal.id)).contributions).toHaveLength(0);
  });
  it("counts photo foods atomically, scales one item and never duplicates a repeated task", async () => {
    const foods = [
      { label: "鸡蛋", portionAmount: 2, portionUnit: "个", note: null, energyKcal: 140, proteinGrams: 12, carbohydrateGrams: 2, fatGrams: 10 },
      { label: "豆浆", portionAmount: 1, portionUnit: "碗", note: null, energyKcal: 100, proteinGrams: 8, carbohydrateGrams: 4, fatGrams: 5 },
      { label: "看不清的配菜", portionAmount: null, portionUnit: null, note: null, energyKcal: null, proteinGrams: null, carbohydrateGrams: null, fatGrams: null },
    ];
    const values = await fixture(new FixedImageAnalyzer({ ...candidate, foods }));
    const pending = await values.service.request("user-1", values.meal.id, "image/png", Readable.from(png));
    await values.service.process(pending.id);
    await values.service.process(pending.id);
    let meal = await values.nutritionService.getMeal("user-1", values.meal.id);
    expect(meal.revision).toBe(values.meal.revision + 1);
    expect(meal.contributions).toHaveLength(3);
    expect(meal.contributions.map((item) => item.energyKcal)).toEqual([140, 100, null]);
    expect(meal.contributions.every((item) => item.mode === "item" && item.sourceAnalysisId === pending.id)).toBe(true);
    const eggs = meal.contributions[0]!;
    meal = await values.nutritionService.changePortion("user-1", meal.id, eggs.id, meal.revision, eggs.revision, 1);
    expect(meal.contributions.map((item) => item.energyKcal)).toEqual([70, 100, null]);
    const [analysis] = await values.service.list("user-1", meal.id);
    expect(analysis!.candidate!.foods![0]!.portionAmount).toBe(2);
    await expect(values.service.adopt("user-1", pending.id, analysis!.revision, meal.revision, { ...foods[0]!, mode: "whole_meal", basisDescription: null, replaceExisting: true, deleteOriginal: false })).rejects.toMatchObject({ code: "analysis_item_edit_required" });
  });

  it("does not resurrect deleted manual content when a new photo result arrives", async () => {
    const values = await fixture(new FixedImageAnalyzer({ ...candidate, foods: [{ label: "鸡蛋", portionAmount: 2, portionUnit: "个", note: null, energyKcal: 140, proteinGrams: 12, carbohydrateGrams: 2, fatGrams: 10 }] }));
    const pending = await values.service.request("user-1", values.meal.id, "image/png", Readable.from(png));
    let meal = await values.nutritionService.addContribution("user-1", values.meal.id, values.meal.revision, { mode: "item", label: "手填食物", portionAmount: 1, portionUnit: "份", basisDescription: null, energyKcal: 50, proteinGrams: null, carbohydrateGrams: null, fatGrams: null }, false);
    const item = meal.contributions[0]!;
    await values.nutritionService.deleteContribution("user-1", meal.id, item.id, meal.revision, item.revision);
    await values.service.process(pending.id);
    meal = await values.nutritionService.getMeal("user-1", meal.id);
    expect(meal.contributions).toHaveLength(0);
  });

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
