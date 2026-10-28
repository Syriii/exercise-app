import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { createDatabase } from "./database.js";
import { DatabaseUserContext } from "./user-context.js";
import { ensureApiDatabaseRole, grantApiDatabaseRole } from "./runtime-role.js";
import { readSecretValue } from "../config/environment.js";
import { loadTestDatabaseUrl } from "../testing/test-database-url.js";
import { DeepSeekImageAnalyzer } from "../modules/image-analysis/deepseek-analyzer.js";
import { PostgresImageAnalysisRepository } from "../modules/image-analysis/postgres-repository.js";
import { ImageAnalysisService } from "../modules/image-analysis/service.js";
import type { MealImageInputContext } from "../modules/image-analysis/types.js";
import { MemoryTemporaryMediaStore } from "../modules/media/memory-temporary-media-store.js";
import { PostgresNutritionRepository } from "../modules/nutrition/postgres-repository.js";
import { NutritionService } from "../modules/nutrition/service.js";
import { PostgresUserDataExporter } from "../modules/portability/postgres-exporter.js";
import { MemoryTaskQueue } from "../modules/tasks/memory-task-queue.js";

// Dedicated _test database only; every provider request in this file uses stubbed fetch.
const databaseUrl = loadTestDatabaseUrl(), admin = createDatabase(databaseUrl);
const password = process.env.TEST_API_DATABASE_PASSWORD === undefined && process.env.TEST_API_DATABASE_PASSWORD_FILE === undefined
  ? "integration-only-api-role-password" : readSecretValue("TEST_API_DATABASE_PASSWORD", process.env, path => readFileSync(path, "utf8"));
const apiUrl = new URL(databaseUrl); apiUrl.username = "exercise_api"; apiUrl.password = password;
const context = new DatabaseUserContext(), restricted = createDatabase(apiUrl.toString(), context);
beforeAll(async () => {
  await migrate(admin.database, { migrationsFolder: resolve(import.meta.dirname, "../../drizzle") });
  await ensureApiDatabaseRole(admin.pool, password, { preserveExistingPassword: true }); await grantApiDatabaseRole(admin.pool);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
afterAll(async () => { await restricted.close(); await admin.close(); });

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const photoContext = (role: MealImageInputContext["role"], note: string, ids: readonly string[] = []): MealImageInputContext => ({ role, note, referenceAnalysisIds: ids });
const candidate = { title: "测试餐食", observedFoods: [{ label: "测试米饭", estimatedPortion: "100g", note: null }], foods: [{ label: "测试米饭", portionAmount: 100, portionUnit: "g", note: null, energyKcal: 120, proteinGrams: 0, carbohydrateGrams: null, fatGrams: null }], energyKcal: 120, proteinGrams: 0, carbohydrateGrams: null, fatGrams: null, confidence: "medium", assumptions: ["测试依据"], uncertaintyNote: "测试估算" };

it("persists photo context/attempt receipts with RLS, guarded reference dispatch and no duplicate intake", async () => {
  const fetch = vi.fn(async (_url: unknown, _options?: RequestInit) => new Response(JSON.stringify({ id: "fake-context-pg-call", model: "deepseek-flash", usage: { prompt_tokens: 150, completion_tokens: 30, total_tokens: 180 }, choices: [{ finish_reason: "stop", message: { content: JSON.stringify(candidate) } }] }), { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  const accounts = await admin.pool.query<{ id: string }>("insert into users (username, normalized_username) values ($1, $1), ($2, $2) returning id", [`image-context-owner-${randomUUID()}`, `image-context-other-${randomUUID()}`]);
  const owner = accounts.rows[0]!.id, other = accounts.rows[1]!.id;
  const repository = new PostgresImageAnalysisRepository(admin.database), nutrition = new NutritionService(new PostgresNutritionRepository(admin.database));
  const mediaStore = new MemoryTemporaryMediaStore(), queue = new MemoryTaskQueue();
  const service = new ImageAnalysisService({ repository, mediaStore, queue, nutritionService: nutrition, maxUploadBytes: 1024,
    analyzer: new DeepSeekImageAnalyzer({ apiKey: "fake-context-integration-key", baseUrl: "https://example.invalid", model: "deepseek-flash", timeoutMs: 2000, retryLimit: 0 }) });
  const makeMeal = (user: string) => nutrition.createMeal(user, { occurredAt: "2026-10-01T00:00:00Z", localDate: "2026-10-01", timeZone: "UTC", name: "测试餐食", note: null });
  try {
    const meal = await makeMeal(owner), otherMeal = await makeMeal(other);
    const upload = (inputContext: MealImageInputContext, ownerId = owner, mealId = meal.id) => service.request(ownerId, mealId, "image/png", Readable.from(png), true, inputContext);
    const enqueue = vi.spyOn(queue, "enqueue"), before = await upload(photoContext("before", "餐前测试说明")), label = await upload(photoContext("label", "标签测试说明"));
    expect(before.status).toBe("waiting"); expect(enqueue).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    const originalContext = photoContext("meal", "同餐参考，避免重复计算", [before.id, label.id]);
    const primary = await upload(originalContext);
    const scoped = new PostgresImageAnalysisRepository(restricted.database);
    expect(await context.run(other, () => scoped.get(owner, primary.id))).toBeNull();
    expect((await context.run(other, () => restricted.pool.query("select input_context from meal_image_analyses where id = $1", [primary.id]))).rowCount).toBe(0);
    expect((await context.run(other, () => restricted.pool.query("update meal_image_analyses set input_context = null where id = $1", [primary.id]))).rowCount).toBe(0);
    await service.process(primary.id); await service.process(primary.id); expect(fetch).toHaveBeenCalledTimes(1);
    const blocks = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)).messages[1].content as { type: string }[];
    expect(blocks.filter(value => value.type === "image_url")).toHaveLength(3);
    const first = (await repository.get(owner, primary.id))!;
    expect(first.attempts[0]?.evidence).toMatchObject({ inputContext: originalContext, calls: [expect.objectContaining({ usage: expect.objectContaining({ totalTokens: 180 }), cost: expect.any(Object) })] });
    expect((await nutrition.getMeal(owner, meal.id)).contributions).toHaveLength(0);
    const existing = (await service.replaceFoods(owner, primary.id, { operationId: randomUUID(), analysisRevision: first.revision, mealRevision: meal.revision, replaceIds: [] })).meal;
    expect(existing.contributions).toHaveLength(1);
    expect(existing.contributions[0]).toMatchObject({ sourceAnalysisId: primary.id, energyKcal: 120 });
    expect((await repository.get(owner, before.id))?.attempts).toHaveLength(0);
    const changedContext = photoContext("meal", "补充称重说明", [before.id]);
    const adopted = (await repository.get(owner, primary.id))!;
    const reanalysis = await service.reanalyze(owner, primary.id, adopted.revision, changedContext);
    vi.spyOn(repository, "succeed").mockRejectedValueOnce(new Error("fake late result persistence failure"));
    await expect(service.process(reanalysis.id)).rejects.toThrow("fake late result persistence failure");
    const failed = (await repository.get(owner, reanalysis.id))!;
    expect(failed.attempts[0]?.evidence).toMatchObject({ inputContext: changedContext, calls: [expect.objectContaining({ usage: expect.objectContaining({ totalTokens: 180 }) })] });
    const retryContext = photoContext("meal", "再次明确测试依据", [label.id]);
    await service.retry(owner, reanalysis.id, failed.revision, retryContext); await service.process(reanalysis.id);
    const retried = (await repository.get(owner, reanalysis.id))!;
    expect(retried.attempts.map(value => value.evidence?.inputContext)).toEqual([changedContext, retryContext]);
    expect((await nutrition.getMeal(owner, meal.id)).contributions).toEqual(existing.contributions);
    expect(fetch).toHaveBeenCalledTimes(3);
    const exported = await context.run(owner, () => new PostgresUserDataExporter(restricted.database).exportUserData(owner, new Date()));
    expect(exported.data.meal_image_analyses).toEqual(expect.arrayContaining([expect.objectContaining({ id: primary.id, input_context: originalContext })]));
    expect(exported.data.meal_image_analysis_attempts).toEqual(expect.arrayContaining([expect.objectContaining({ analysis_id: primary.id, evidence: expect.objectContaining({ inputContext: originalContext }) })]));
    expect((await context.run(other, () => new PostgresUserDataExporter(restricted.database).exportUserData(other, new Date()))).data.meal_image_analysis_attempts).toEqual([]);
    expect(JSON.stringify(exported)).not.toContain("fake-context-integration-key");

    const guarded = await upload(photoContext("meal", "删除窗口测试", [before.id]));
    const prepare = repository.prepareCall.bind(repository);
    vi.spyOn(repository, "prepareCall").mockImplementationOnce(async (...args) => { const allowed = await prepare(...args); await service.removeOriginal(owner, before.id); return allowed; });
    await expect(service.process(guarded.id)).rejects.toMatchObject({ code: "deepseek_request_cancelled" });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect((await repository.get(owner, guarded.id))?.attempts[0]?.evidence?.calls ?? []).toHaveLength(0);
    for (const target of ["primary", "meal"] as const) {
      const targetMeal = await makeMeal(owner);
      const reference = await service.request(owner, targetMeal.id, "image/png", Readable.from(png), true, photoContext("before", "同餐删除边界"));
      const targetPrimary = await service.request(owner, targetMeal.id, "image/png", Readable.from(png), true, photoContext("meal", "删除边界", [reference.id]));
      vi.spyOn(repository, "prepareCall").mockImplementationOnce(async (...args) => {
        const allowed = await prepare(...args);
        if (target === "primary") await service.removeOriginal(owner, targetPrimary.id);
        else await nutrition.deleteMeal(owner, targetMeal.id, targetMeal.revision);
        return allowed;
      });
      await expect(service.process(targetPrimary.id)).rejects.toMatchObject({ code: "deepseek_request_cancelled" });
      expect(fetch).toHaveBeenCalledTimes(3);
      expect((await repository.get(owner, targetPrimary.id))?.attempts[0]?.evidence?.calls ?? []).toHaveLength(0);
    }
    const foreign = await upload(photoContext("before", "其他账号资料"), other, otherMeal.id);
    await expect(upload(photoContext("meal", "越权参考", [foreign.id]))).rejects.toMatchObject({ code: "reference_photo_unavailable" });

    // Even a corrupted/bypassed service context cannot pass the transactional provider preparation.
    const stored = await mediaStore.put(Readable.from(png), { maxBytes: 1024 });
    const corrupted = await repository.create(owner, meal.id, "image/png", stored, null, "deepseek-flash", "test-context", true, photoContext("meal", "无效跨账号参考", [foreign.id]));
    const attempt = await repository.beginAttempt(corrupted.id);
    if (typeof attempt === "string") throw new Error(attempt);
    expect(await repository.prepareCall(corrupted.id, attempt.attemptId, { callId: randomUUID(), configuredModel: "deepseek-flash", preparedAt: new Date().toISOString() })).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(3);
    const attemptIds = retried.attempts.map(value => value.id);
    await admin.pool.query("delete from users where id = $1", [owner]);
    expect((await admin.pool.query("select 1 from meal_image_analyses where id = $1", [primary.id])).rowCount).toBe(0);
    expect((await admin.pool.query("select 1 from meal_image_analysis_attempts where id = any($1::uuid[])", [attemptIds])).rowCount).toBe(0);
  } finally { await admin.pool.query("delete from users where id = any($1::uuid[])", [[owner, other]]); }
});
