import { randomUUID } from "node:crypto";
import type { StoredTemporaryMedia } from "../media/temporary-media-store.js";
import type { ImageAnalysisRepository } from "./repository.js";
import type { AnalysisWorkItem, ImageAnalysisAttempt, ImageNutritionCandidate, MealImageAnalysis } from "./types.js";

function clone<T>(value: T): T { return structuredClone(value); }

export class MemoryImageAnalysisRepository implements ImageAnalysisRepository {
  readonly #items = new Map<string, AnalysisWorkItem>();
  readonly #mediaBytes = new Map<string, number>();

  public async getUsage(userId: string) {
    const values = [...this.#items.values()].filter((value) => value.userId === userId);
    return {
      activeAnalyses: values.filter((value) => value.status === "pending" || value.status === "running").length,
      temporaryMediaBytes: values.filter((value) => value.imageAvailable).reduce((total, value) => total + (this.#mediaBytes.get(value.mediaId) ?? 0), 0),
    };
  }

  public async create(userId: string, mealId: string, contentType: string, stored: StoredTemporaryMedia, _expiresAt: Date, model: string, promptVersion: string): Promise<MealImageAnalysis> {
    const now = new Date();
    const item: AnalysisWorkItem = { id: randomUUID(), userId, mealId, mediaId: randomUUID(), objectKey: stored.objectKey, contentType, status: "pending", model, promptVersion, candidate: null, lastErrorCode: null, imageAvailable: true, adoptedAt: null, revision: 1, attempts: [], createdAt: now, updatedAt: now };
    this.#items.set(item.id, item); this.#mediaBytes.set(item.mediaId, stored.byteSize); return clone(item);
  }
  public async list(userId: string, mealId: string) { return clone([...this.#items.values()].filter((value) => value.userId === userId && value.mealId === mealId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())); }
  public async get(userId: string, id: string) { const value = this.#items.get(id); return value === undefined || value.userId !== userId ? null : clone(value); }
  public async getWorkItem(id: string) { const value = this.#items.get(id); return value === undefined ? null : clone(value); }
  public async beginAttempt(id: string) {
    const value = this.#items.get(id); if (value === undefined) return "not_found" as const; if (value.status !== "pending") return "not_ready" as const;
    const attempt: ImageAnalysisAttempt = { id: randomUUID(), sequence: value.attempts.length + 1, status: "running", providerRequestId: null, errorCode: null, startedAt: new Date(), finishedAt: null };
    const saved = { ...value, status: "running" as const, attempts: [...value.attempts, attempt], revision: value.revision + 1, updatedAt: new Date() }; this.#items.set(id, saved); return { work: clone(saved), attemptId: attempt.id };
  }
  public async succeed(id: string, attemptId: string, candidate: ImageNutritionCandidate, providerRequestId: string | null) {
    const value = this.#items.get(id); const attempt = value?.attempts.find((item) => item.id === attemptId); if (value === undefined || value.status !== "running" || attempt?.status !== "running") return "not_running" as const;
    const attempts = value.attempts.map((item) => item.id === attemptId ? { ...item, status: "succeeded" as const, providerRequestId, finishedAt: new Date() } : item);
    this.#items.set(id, { ...value, status: "succeeded", candidate, lastErrorCode: null, attempts, revision: value.revision + 1, updatedAt: new Date() }); return { status: "succeeded" as const, tentativeHandled: false };
  }
  public async fail(id: string, attemptId: string, errorCode: string) { const value = this.#items.get(id); if (value === undefined) return; const attempts = value.attempts.map((item) => item.id === attemptId && item.status === "running" ? { ...item, status: "failed" as const, errorCode, finishedAt: new Date() } : item); this.#items.set(id, { ...value, status: "failed", lastErrorCode: errorCode, attempts, revision: value.revision + 1, updatedAt: new Date() }); }
  public async retry(userId: string, id: string, revision: number) { const value = this.#items.get(id); if (value === undefined || value.userId !== userId) return "not_found" as const; if (value.revision !== revision) return "revision_conflict" as const; if (value.status !== "failed") return "not_failed" as const; const saved = { ...value, status: "pending" as const, lastErrorCode: null, revision: value.revision + 1, updatedAt: new Date() }; this.#items.set(id, saved); return clone(saved); }
  public async markAdopted(userId: string, id: string, revision: number) { const value = this.#items.get(id); if (value === undefined || value.userId !== userId) return "not_found" as const; if (value.revision !== revision) return "revision_conflict" as const; if (value.status !== "succeeded" || value.candidate === null || value.adoptedAt !== null) return "not_ready" as const; const saved = { ...value, adoptedAt: new Date(), revision: value.revision + 1, updatedAt: new Date() }; this.#items.set(id, saved); return clone(saved); }
  public async markMediaStatus(mediaId: string, status: "available" | "deletion_pending" | "deleted" | "missing") { for (const [id, value] of this.#items) if (value.mediaId === mediaId) this.#items.set(id, { ...value, imageAvailable: status === "available", updatedAt: new Date() }); }
}
