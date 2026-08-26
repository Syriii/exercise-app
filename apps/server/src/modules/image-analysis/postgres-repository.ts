import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Database } from "../../db/database.js";
import { mealContributions, mealImageAnalysisAttempts, mealImageAnalyses, meals, temporaryMedia } from "../../db/schema/index.js";
import type { StoredTemporaryMedia } from "../media/temporary-media-store.js";
import type { ImageAnalysisRepository } from "./repository.js";
import type { AnalysisWorkItem, ImageAnalysisAttempt, ImageNutritionCandidate, MealImageAnalysis } from "./types.js";

export class PostgresImageAnalysisRepository implements ImageAnalysisRepository {
  public constructor(private readonly database: Database) {}
  public async getUsage(userId: string) {
    const [active] = await this.database.select({ count: sql<number>`count(*)::int` }).from(mealImageAnalyses).where(and(eq(mealImageAnalyses.userId, userId), inArray(mealImageAnalyses.status, ["pending", "running"])));
    const [media] = await this.database.select({ bytes: sql<number>`coalesce(sum(${temporaryMedia.byteSize}), 0)::bigint` }).from(temporaryMedia).where(and(eq(temporaryMedia.userId, userId), inArray(temporaryMedia.status, ["available", "deletion_pending"])));
    return { activeAnalyses: active?.count ?? 0, temporaryMediaBytes: Number(media?.bytes ?? 0) };
  }
  public async create(userId: string, mealId: string, contentType: string, stored: StoredTemporaryMedia, expiresAt: Date, model: string, promptVersion: string): Promise<MealImageAnalysis> {
    const id = await this.database.transaction(async (tx) => {
      const [owned] = await tx.select({ id: meals.id }).from(meals).where(and(eq(meals.id, mealId), eq(meals.userId, userId), isNull(meals.deletedAt))).limit(1); if (owned === undefined) throw new Error("meal_not_found");
      const [media] = await tx.insert(temporaryMedia).values({ userId, objectKey: stored.objectKey, contentType, byteSize: stored.byteSize, sha256: stored.sha256, expiresAt }).returning({ id: temporaryMedia.id }); if (media === undefined) throw new Error("media_not_returned");
      const [analysis] = await tx.insert(mealImageAnalyses).values({ userId, mealId, mediaId: media.id, model, promptVersion }).returning({ id: mealImageAnalyses.id }); if (analysis === undefined) throw new Error("analysis_not_returned"); return analysis.id;
    });
    const saved = await this.get(userId, id); if (saved === null) throw new Error("created analysis not found"); return saved;
  }
  public async list(userId: string, mealId: string) { const rows = await this.database.select().from(mealImageAnalyses).where(and(eq(mealImageAnalyses.userId, userId), eq(mealImageAnalyses.mealId, mealId))).orderBy(desc(mealImageAnalyses.createdAt)); return this.attachAttempts(rows); }
  public async get(userId: string, id: string) { const [row] = await this.database.select().from(mealImageAnalyses).where(and(eq(mealImageAnalyses.id, id), eq(mealImageAnalyses.userId, userId))).limit(1); return row === undefined ? null : (await this.attachAttempts([row]))[0] ?? null; }
  public async getWorkItem(id: string): Promise<AnalysisWorkItem | null> { const [row] = await this.database.select({ analysis: mealImageAnalyses, media: temporaryMedia }).from(mealImageAnalyses).innerJoin(temporaryMedia, eq(mealImageAnalyses.mediaId, temporaryMedia.id)).where(eq(mealImageAnalyses.id, id)).limit(1); if (row === undefined) return null; const publicValue = (await this.attachAttempts([row.analysis]))[0]!; return { ...publicValue, userId: row.analysis.userId, mediaId: row.media.id, objectKey: row.media.objectKey, contentType: row.media.contentType }; }
  public async beginAttempt(id: string) {
    const attemptId = await this.database.transaction(async (tx) => { const [analysis] = await tx.select().from(mealImageAnalyses).where(eq(mealImageAnalyses.id, id)).for("update").limit(1); if (analysis === undefined) return "not_found" as const; if (analysis.status !== "pending") return "not_ready" as const; const [countRow] = await tx.select({ count: sql<number>`count(*)::int` }).from(mealImageAnalysisAttempts).where(eq(mealImageAnalysisAttempts.analysisId, id)); const [attempt] = await tx.insert(mealImageAnalysisAttempts).values({ analysisId: id, sequence: (countRow?.count ?? 0) + 1 }).returning({ id: mealImageAnalysisAttempts.id }); await tx.update(mealImageAnalyses).set({ status: "running", revision: sql`${mealImageAnalyses.revision} + 1`, updatedAt: new Date() }).where(eq(mealImageAnalyses.id, id)); return attempt!.id; });
    if (attemptId === "not_found" || attemptId === "not_ready") return attemptId; const work = await this.getWorkItem(id); if (work === null) return "not_found"; return { work, attemptId };
  }
  public async succeed(id: string, attemptId: string, candidate: ImageNutritionCandidate, providerRequestId: string | null) {
    return this.database.transaction(async (tx) => {
      const [analysis] = await tx.select().from(mealImageAnalyses).where(eq(mealImageAnalyses.id, id)).for("update").limit(1);
      const [attempt] = await tx.select().from(mealImageAnalysisAttempts).where(and(eq(mealImageAnalysisAttempts.id, attemptId), eq(mealImageAnalysisAttempts.analysisId, id))).for("update").limit(1);
      if (analysis?.status !== "running" || attempt?.status !== "running") return "not_running" as const;
      const [meal] = await tx.select().from(meals).where(and(eq(meals.id, analysis.mealId), eq(meals.userId, analysis.userId), isNull(meals.deletedAt))).for("update").limit(1);
      if (meal === undefined) return "not_running" as const;
      const active = await tx.select({ id: mealContributions.id }).from(mealContributions).where(and(eq(mealContributions.mealId, meal.id), isNull(mealContributions.supersededAt))).for("update");
      const hasNutrient = [candidate.energyKcal, candidate.proteinGrams, candidate.carbohydrateGrams, candidate.fatGrams].some((value) => value !== null);
      if (active.length === 0 && hasNutrient) {
        await tx.insert(mealContributions).values({
          mealId: meal.id,
          mode: "whole_meal",
          source: "model_adopted",
          reviewStatus: "tentative",
          sourceAnalysisId: analysis.id,
          label: candidate.title.trim() || "照片营养估算",
          basisDescription: candidate.uncertaintyNote.trim() || "按照片中可见盛取量估算",
          energyKcal: candidate.energyKcal?.toString() ?? null,
          proteinGrams: candidate.proteinGrams?.toString() ?? null,
          carbohydrateGrams: candidate.carbohydrateGrams?.toString() ?? null,
          fatGrams: candidate.fatGrams?.toString() ?? null,
        });
        await tx.update(meals).set({ revision: sql`${meals.revision} + 1`, updatedAt: new Date() }).where(eq(meals.id, meal.id));
      }
      await tx.update(mealImageAnalysisAttempts).set({ status: "succeeded", providerRequestId, finishedAt: new Date() }).where(eq(mealImageAnalysisAttempts.id, attemptId));
      await tx.update(mealImageAnalyses).set({ status: "succeeded", rawCandidate: candidate as unknown as Record<string, unknown>, uncertaintyNote: candidate.uncertaintyNote, lastErrorCode: null, revision: sql`${mealImageAnalyses.revision} + 1`, updatedAt: new Date() }).where(eq(mealImageAnalyses.id, id));
      return { status: "succeeded" as const, tentativeHandled: true };
    });
  }
  public async fail(id: string, attemptId: string, errorCode: string) { await this.database.transaction(async (tx) => { await tx.update(mealImageAnalysisAttempts).set({ status: "failed", errorCode, finishedAt: new Date() }).where(and(eq(mealImageAnalysisAttempts.id, attemptId), eq(mealImageAnalysisAttempts.status, "running"))); await tx.update(mealImageAnalyses).set({ status: "failed", lastErrorCode: errorCode, revision: sql`${mealImageAnalyses.revision} + 1`, updatedAt: new Date() }).where(and(eq(mealImageAnalyses.id, id), eq(mealImageAnalyses.status, "running"))); }); }
  public async retry(userId: string, id: string, revision: number) { const [row] = await this.database.select().from(mealImageAnalyses).where(and(eq(mealImageAnalyses.id, id), eq(mealImageAnalyses.userId, userId))).limit(1); if (row === undefined) return "not_found" as const; if (row.revision !== revision) return "revision_conflict" as const; if (row.status !== "failed") return "not_failed" as const; const [saved] = await this.database.update(mealImageAnalyses).set({ status: "pending", lastErrorCode: null, revision: sql`${mealImageAnalyses.revision} + 1`, updatedAt: new Date() }).where(and(eq(mealImageAnalyses.id, id), eq(mealImageAnalyses.revision, revision), eq(mealImageAnalyses.status, "failed"))).returning(); if (saved === undefined) return "revision_conflict" as const; return (await this.attachAttempts([saved]))[0]!; }
  public async markAdopted(userId: string, id: string, revision: number) { const [row] = await this.database.select().from(mealImageAnalyses).where(and(eq(mealImageAnalyses.id, id), eq(mealImageAnalyses.userId, userId))).limit(1); if (row === undefined) return "not_found" as const; if (row.revision !== revision) return "revision_conflict" as const; if (row.status !== "succeeded" || row.rawCandidate === null || row.adoptedAt !== null) return "not_ready" as const; const [saved] = await this.database.update(mealImageAnalyses).set({ adoptedAt: new Date(), revision: sql`${mealImageAnalyses.revision} + 1`, updatedAt: new Date() }).where(and(eq(mealImageAnalyses.id, id), eq(mealImageAnalyses.revision, revision))).returning(); return saved === undefined ? "revision_conflict" as const : (await this.attachAttempts([saved]))[0]!; }
  public async markMediaStatus(mediaId: string, status: "available" | "deletion_pending" | "deleted" | "missing") { await this.database.update(temporaryMedia).set({ status, deletedAt: status === "deleted" || status === "missing" ? new Date() : null, updatedAt: new Date() }).where(eq(temporaryMedia.id, mediaId)); }

  private async attachAttempts(rows: readonly (typeof mealImageAnalyses.$inferSelect)[]): Promise<MealImageAnalysis[]> { if (rows.length === 0) return []; const attempts = await this.database.select().from(mealImageAnalysisAttempts).where(inArray(mealImageAnalysisAttempts.analysisId, rows.map((row) => row.id))).orderBy(asc(mealImageAnalysisAttempts.sequence)); const grouped = new Map<string, ImageAnalysisAttempt[]>(); for (const row of attempts) grouped.set(row.analysisId, [...(grouped.get(row.analysisId) ?? []), { id: row.id, sequence: row.sequence, status: row.status, providerRequestId: row.providerRequestId, errorCode: row.errorCode, startedAt: row.startedAt, finishedAt: row.finishedAt }]); const mediaRows = await this.database.select({ id: temporaryMedia.id, status: temporaryMedia.status }).from(temporaryMedia).where(inArray(temporaryMedia.id, rows.map((row) => row.mediaId))); const media = new Map(mediaRows.map((row) => [row.id, row.status])); return rows.map((row) => ({ id: row.id, mealId: row.mealId, status: row.status, model: row.model, promptVersion: row.promptVersion, candidate: row.rawCandidate as unknown as ImageNutritionCandidate | null, lastErrorCode: row.lastErrorCode, imageAvailable: media.get(row.mediaId) === "available", adoptedAt: row.adoptedAt, revision: row.revision, attempts: grouped.get(row.id) ?? [], createdAt: row.createdAt, updatedAt: row.updatedAt })); }
}
