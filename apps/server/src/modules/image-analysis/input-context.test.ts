import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../app.js";
import { createTestConfig } from "../../testing/test-config.js";
import { MemoryIdentityRepository } from "../identity/memory-repository.js";
import { IdentityService } from "../identity/service.js";
import { MemoryPlanningRepository } from "../planning/memory-repository.js";
import { PlanningService } from "../planning/service.js";
import { MemoryTemporaryMediaStore } from "../media/memory-temporary-media-store.js";
import { MemoryNutritionRepository } from "../nutrition/memory-repository.js";
import { NutritionService } from "../nutrition/service.js";
import { MemoryTaskQueue } from "../tasks/memory-task-queue.js";
import { DeepSeekImageAnalyzer } from "./deepseek-analyzer.js";
import { contextualImagePromptVersion, decodeImageContextHeader, validateImageInputContext } from "./input-context.js";
import { MemoryImageAnalysisRepository } from "./memory-repository.js";
import { ImageAnalysisService } from "./service.js";
import type { MealImageInputContext } from "./types.js";

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const image = (marker: number) => Buffer.concat([png, Buffer.from([marker])]);
const input = (role: MealImageInputContext["role"], note: string | null = null, ids: readonly string[] = []): MealImageInputContext => ({ role, note, referenceAnalysisIds: ids });
const candidate = { title: "测试餐食", observedFoods: [{ label: "测试米饭", estimatedPortion: "200g", note: null }],
  foods: [{ label: "测试米饭", portionAmount: 200, portionUnit: "g", note: null, energyKcal: 240, proteinGrams: 0, carbohydrateGrams: null, fatGrams: 1 }],
  energyKcal: 240, proteinGrams: 0, carbohydrateGrams: null, fatGrams: 1, confidence: "medium", assumptions: ["用户明确提供的测试依据"], uncertaintyNote: "测试估计" };
const response = () => new Response(JSON.stringify({ id: "test-multiphoto-call", model: "deepseek-flash", usage: { prompt_tokens: 150, completion_tokens: 30, total_tokens: 180, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 150 }, choices: [{ finish_reason: "stop", message: { content: JSON.stringify(candidate) } }] }), { status: 200 });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function fixture() {
  const repository = new MemoryImageAnalysisRepository(), mediaStore = new MemoryTemporaryMediaStore(), queue = new MemoryTaskQueue();
  const nutrition = new NutritionService(new MemoryNutritionRepository());
  const analyzer = new DeepSeekImageAnalyzer({ apiKey: "fake-context-test-key", baseUrl: "https://example.invalid", model: "deepseek-flash", retryLimit: 0, timeoutMs: 2000 });
  const service = new ImageAnalysisService({ repository, mediaStore, queue, analyzer, nutritionService: nutrition, maxUploadBytes: 1024 });
  const meal = await nutrition.createMeal("test-owner", { occurredAt: "2026-10-01T00:00:00Z", localDate: "2026-10-01", timeZone: "UTC", name: "测试午餐", note: null });
  const upload = (context: MealImageInputContext, marker = 1, mealId = meal.id, owner = "test-owner") => service.request(owner, mealId, "image/png", Readable.from(image(marker)), true, context);
  return { repository, mediaStore, queue, nutrition, service, meal, upload };
}

describe("same-meal photo context", () => {
  it("accepts the UI's encoded upload header, waits despite automatic settings, and starts only an explicitly confirmed group", async () => {
    const fetch = vi.fn(async () => response()); vi.stubGlobal("fetch", fetch);
    const f = await fixture(), config = createTestConfig({ webDistDirectory: "/directory-that-does-not-exist" });
    const identityService = new IdentityService({ repository: new MemoryIdentityRepository(), sessionSecret: config.sessionSecret, sessionTtlHours: config.sessionTtlHours });
    const app = await buildApp({ config, checkDatabase: async () => undefined, identityService, nutritionService: f.nutrition, imageAnalysisService: f.service, planningService: new PlanningService(new MemoryPlanningRepository()) });
    try {
      const register = async (username: string) => app.inject({ method: "POST", url: "/api/v1/auth/register", payload: { username, password: "correct horse battery staple" } });
      const owner = await register("photo-context-owner"), other = await register("photo-context-other");
      const ownerId = owner.json().id, cookie = String(owner.headers["set-cookie"]).split(";", 1)[0]!, otherCookie = String(other.headers["set-cookie"]).split(";", 1)[0]!;
      const meal = await f.nutrition.createMeal(ownerId, { occurredAt: "2026-10-01T00:00:00Z", localDate: "2026-10-01", timeZone: "UTC", name: null, note: null });
      await f.service.saveSettings(ownerId, 1, true, true);
      const upload = (context: MealImageInputContext, auth = cookie) => app.inject({ method: "POST", url: `/api/v1/image-analyses?mealId=${meal.id}`, headers: { cookie: auth, "content-type": "image/png", "x-meal-photo-context": encodeURIComponent(JSON.stringify(context)) }, payload: png });
      const beforeContext = input("before", "餐前说明"), before = await upload(beforeContext), after = await upload(input("after", "餐后说明"));
      expect(before.statusCode, before.body).toBe(202); expect(before.json()).toMatchObject({ status: "waiting", inputContext: beforeContext });
      expect(after.statusCode, after.body).toBe(202); expect(fetch).not.toHaveBeenCalled();
      expect((await upload(beforeContext, otherCookie)).statusCode).toBe(404);
      const context = input("after", "同容器餐前后测试说明", [before.json().id]);
      const path = `/api/v1/image-analyses/${after.json().id}/retry`;
      expect((await app.inject({ method: "POST", url: path, headers: { cookie }, payload: { revision: after.json().revision, consent: false, inputContext: context } })).statusCode).toBe(400);
      const started = await app.inject({ method: "POST", url: path, headers: { cookie }, payload: { revision: after.json().revision, consent: true, inputContext: context } });
      expect(started.statusCode, started.body).toBe(202); expect(started.json()).toMatchObject({ status: "pending", inputContext: context });
      expect(fetch).not.toHaveBeenCalled(); await f.service.process(after.json().id); expect(fetch).toHaveBeenCalledTimes(1);
      const listed = await app.inject({ method: "GET", url: `/api/v1/image-analyses?mealId=${meal.id}`, headers: { cookie } });
      expect(listed.statusCode, listed.body).toBe(200);
      expect(listed.json().find((value: { id: string }) => value.id === after.json().id)).toMatchObject({ status: "succeeded", inputContext: context, attempts: [{ status: "succeeded" }] });
      expect((await f.repository.get(ownerId, after.json().id))?.attempts[0]?.evidence?.inputContext).toEqual(context);
      expect((await f.nutrition.getMeal(ownerId, meal.id)).contributions).toHaveLength(0);
    } finally { await app.close(); }
  });

  it("validates/decode purposes, notes and unique bounded photo IDs without accepting injected fields", () => {
    const context = input("before", "  测试餐前重量  ", [randomUUID()]);
    expect(decodeImageContextHeader(encodeURIComponent(JSON.stringify(context)))).toEqual({ ...context, note: "测试餐前重量" });
    expect(validateImageInputContext(undefined)).toBeNull();
    for (const value of [{ ...context, referenceAnalysisIds: [context.referenceAnalysisIds[0], context.referenceAnalysisIds[0]] },
      { ...context, referenceAnalysisIds: Array.from({ length: 9 }, () => randomUUID()) }, { ...context, note: "x".repeat(2001) }, { ...context, role: "system" }, { ...context, model: "injected" }, { ...context, referenceAnalysisIds: ["invalid"] }]) {
      expect(() => validateImageInputContext(value)).toThrow();
    }
    expect(() => decodeImageContextHeader("%XX")).toThrow();
  });

  it("stores reference uploads without dispatch, then sends the exact selected images in one physical call and retains token/cost/context evidence", async () => {
    const fetch = vi.fn(async (_url: unknown, _options?: RequestInit) => response()); vi.stubGlobal("fetch", fetch);
    const f = await fixture(), enqueue = vi.spyOn(f.queue, "enqueue");
    const before = await f.upload(input("before", "测试餐前"), 1), label = await f.upload(input("label", "测试标签"), 2);
    expect(before.status).toBe("waiting"); expect(label.status).toBe("waiting");
    expect(enqueue).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    await f.service.process(before.id);
    expect(fetch).not.toHaveBeenCalled();
    const context = input("meal", "同餐前后差值，请勿重复计算", [before.id, label.id]);
    const primary = await f.upload(context, 3);
    expect(primary.promptVersion).toBe(contextualImagePromptVersion); expect(enqueue).toHaveBeenCalledTimes(1);
    await f.service.process(primary.id);
    expect(fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
    const blocks = body.messages[1].content as { type: string; text?: string; image_url?: { url: string } }[];
    expect(blocks.filter(value => value.type === "image_url").map(value => value.image_url!.url)).toEqual([3, 1, 2].map(marker => `data:image/png;base64,${image(marker).toString("base64")}`));
    expect(blocks.filter(value => value.type === "text").map(value => value.text).join("\n")).toContain("不是额外吃了一份");
    const saved = (await f.repository.get("test-owner", primary.id))!;
    expect(saved.attempts[0]?.evidence).toMatchObject({ inputContext: context, preparedCalls: [expect.objectContaining({ configuredModel: "deepseek-flash" })], calls: [expect.objectContaining({ usage: { promptTokens: 150, completionTokens: 30, totalTokens: 180, promptCacheHitTokens: 0, promptCacheMissTokens: 150 }, cost: expect.any(Object) })] });
    expect(saved.attempts[0]!.evidence!.preparedCalls![0]!.callId).toBe(saved.attempts[0]!.evidence!.calls![0]!.callId);
    await f.service.process(primary.id); expect(fetch).toHaveBeenCalledTimes(1);
    expect((await f.nutrition.getMeal("test-owner", f.meal.id)).contributions).toHaveLength(0);
    expect(saved.candidate?.foods).toHaveLength(1);
    const replaced = await f.service.replaceFoods("test-owner", primary.id, { operationId: randomUUID(), analysisRevision: saved.revision, mealRevision: f.meal.revision, replaceIds: [] });
    expect(replaced.meal.contributions).toHaveLength(1);
    expect(replaced.meal.contributions[0]).toMatchObject({ sourceAnalysisId: primary.id, energyKcal: 240 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects another account/meal, self and duplicate original-media references before enqueuing", async () => {
    const fetch = vi.fn(async () => response()); vi.stubGlobal("fetch", fetch);
    const f = await fixture();
    const otherMeal = await f.nutrition.createMeal("test-other", { occurredAt: "2026-10-01T00:00:00Z", localDate: "2026-10-01", timeZone: "UTC", name: null, note: null });
    const ownOtherMeal = await f.nutrition.createMeal("test-owner", { occurredAt: "2026-10-01T00:00:00Z", localDate: "2026-10-01", timeZone: "UTC", name: null, note: null });
    const foreign = await f.upload(input("before"), 1, otherMeal.id, "test-other");
    const differentMeal = await f.upload(input("before"), 2, ownOtherMeal.id);
    for (const reference of [foreign, differentMeal]) await expect(f.upload(input("meal", null, [reference.id]))).rejects.toMatchObject({ code: "reference_photo_unavailable", statusCode: 404 });
    const main = await f.upload(input("meal"), 3); await f.service.process(main.id);
    const succeeded = (await f.repository.get("test-owner", main.id))!;
    await expect(f.service.reanalyze("test-owner", main.id, succeeded.revision, input("meal", null, [main.id]))).rejects.toMatchObject({ code: "reference_photo_unavailable" });
    const reanalyzed = await f.service.reanalyze("test-owner", main.id, succeeded.revision, input("meal"));
    await expect(f.upload(input("meal", null, [main.id, reanalyzed.id]))).rejects.toMatchObject({ code: "reference_photo_unavailable" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not dispatch if a selected reference is deleted during durable call preparation", async () => {
    const fetch = vi.fn(async () => response()); vi.stubGlobal("fetch", fetch);
    const f = await fixture(), reference = await f.upload(input("before"));
    const main = await f.upload(input("meal", null, [reference.id]), 2);
    const prepare = f.repository.prepareCall.bind(f.repository);
    vi.spyOn(f.repository, "prepareCall").mockImplementationOnce(async (...args) => {
      const prepared = await prepare(...args);
      await f.service.removeOriginal("test-owner", reference.id);
      return prepared;
    });
    await expect(f.service.process(main.id)).rejects.toMatchObject({ code: "deepseek_request_cancelled" });
    expect(fetch).not.toHaveBeenCalled();
    expect((await f.repository.get("test-owner", main.id))?.attempts[0]?.evidence?.calls ?? []).toHaveLength(0);
  });

  it.each(["primary", "meal"] as const)("does not dispatch if the %s is deleted during durable call preparation", async target => {
    const fetch = vi.fn(async () => response()); vi.stubGlobal("fetch", fetch);
    const f = await fixture(), reference = await f.upload(input("before")), main = await f.upload(input("meal", null, [reference.id]), 2);
    const prepare = f.repository.prepareCall.bind(f.repository);
    vi.spyOn(f.repository, "prepareCall").mockImplementationOnce(async (...args) => {
      const prepared = await prepare(...args);
      if (target === "primary") await f.service.removeOriginal("test-owner", main.id);
      else await f.nutrition.deleteMeal("test-owner", f.meal.id, f.meal.revision);
      return prepared;
    });
    await expect(f.service.process(main.id)).rejects.toMatchObject({ code: "deepseek_request_cancelled" });
    expect(fetch).not.toHaveBeenCalled();
    expect((await f.repository.get("test-owner", main.id))?.attempts[0]?.evidence?.calls ?? []).toHaveLength(0);
  });

  it("retains charged call/context on business failure and keeps each retry's context snapshot without double-counting a meal", async () => {
    const fetch = vi.fn(async () => response()); vi.stubGlobal("fetch", fetch);
    const f = await fixture();
    const existing = await f.nutrition.addContribution("test-owner", f.meal.id, f.meal.revision, { mode: "item", label: "已人工修正", portionAmount: 100, portionUnit: "g", basisDescription: "测试来源", energyKcal: 123, proteinGrams: 0, carbohydrateGrams: null, fatGrams: null }, false);
    const before = await f.upload(input("before"), 1), context = input("after", "第一版说明", [before.id]);
    const after = await f.upload(context, 2); await f.service.retry("test-owner", after.id, after.revision);
    vi.spyOn(f.repository, "succeed").mockRejectedValueOnce(new Error("test late business write failure"));
    await expect(f.service.process(after.id)).rejects.toThrow("test late business write failure");
    const failed = (await f.repository.get("test-owner", after.id))!;
    expect(failed.attempts[0]?.evidence).toMatchObject({ inputContext: context, calls: [expect.objectContaining({ usage: expect.objectContaining({ totalTokens: 180 }) })] });
    const revised = input("after", "补充已称重说明", [before.id]);
    await f.service.retry("test-owner", after.id, failed.revision, revised); await f.service.process(after.id);
    const saved = (await f.repository.get("test-owner", after.id))!;
    expect(saved.attempts.map(value => value.evidence?.inputContext)).toEqual([context, revised]);
    expect(saved.attempts.flatMap(value => value.evidence?.calls ?? [])).toHaveLength(2); expect(fetch).toHaveBeenCalledTimes(2);
    expect((await f.nutrition.getMeal("test-owner", f.meal.id)).contributions).toEqual(existing.contributions);
  });
});
