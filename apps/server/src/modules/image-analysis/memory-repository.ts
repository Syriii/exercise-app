import { randomUUID } from "node:crypto";
import type { StoredTemporaryMedia } from "../media/temporary-media-store.js";
import type { ImageAnalysisRepository } from "./repository.js";
import type { AnalysisWorkItem, ImageAnalysisAttempt, ImageNutritionCandidate, MealImageAnalysis } from "./types.js";

function clone<T>(value: T): T { return structuredClone(value); }

export class MemoryImageAnalysisRepository implements ImageAnalysisRepository {
  readonly #items = new Map<string, AnalysisWorkItem>();
  readonly #settings = new Map<string, import("./types.js").PhotoAnalysisSettings>();
  readonly #expires = new Map<string, Date>();
  public async getSettings(userId: string) { return clone(this.#settings.get(userId) ?? { automatic: false, consentAt: null, revision: 1 }); }
  public async saveSettings(userId: string, revision: number, automatic: boolean, consent: boolean) {
    const value = await this.getSettings(userId);
    if (value.revision !== revision) return "revision_conflict" as const;
    const saved = { automatic, consentAt: consent ? new Date() : value.consentAt, revision: revision + 1 };
    this.#settings.set(userId, saved); return clone(saved);
  }
  public async enqueueFailed(userId: string, id: string) { const value = this.#items.get(id); if (value?.userId === userId && value.status === "pending") this.#items.set(id, { ...value, status: "failed", lastErrorCode: "queue_unavailable", revision: value.revision + 1 }); }
  public async reanalyze(userId: string, id: string, revision: number, provider?: { model: string; promptVersion: string }) {
    const value = this.#items.get(id);
    if (!value || value.userId !== userId) return "not_found" as const;
    if (value.revision !== revision) return "revision_conflict" as const;
    if (value.status !== "succeeded" || !value.imageAvailable || (this.#expires.get(value.mediaId)?.getTime() ?? 0) <= Date.now()) return "not_ready" as const;
    const saved = { ...value, ...provider, id: randomUUID(), status: "pending" as const, candidate: null, adoptedAt: null, revision: 1, attempts: [], lastErrorCode: null, createdAt: new Date(), updatedAt: new Date() };
    // Advance the source revision so a repeated reanalysis click cannot create another task.
    this.#items.set(id, { ...value, revision: value.revision + 1 });
    this.#items.set(saved.id, saved); return clone(saved);
  }
  readonly #mediaBytes = new Map<string, number>();

  public async getUsage(userId: string) {
    const values = [...this.#items.values()].filter((value) => value.userId === userId);
    return {
      activeAnalyses: values.filter((value) => value.status === "pending" || value.status === "running").length,
      temporaryMediaBytes: [...new Set(values.filter((value) => value.imageAvailable).map(value => value.mediaId))].reduce((total, mediaId) => total + (this.#mediaBytes.get(mediaId) ?? 0), 0),
    };
  }

  public async create(userId: string, mealId: string, contentType: string, stored: StoredTemporaryMedia, _expiresAt: Date, model: string, promptVersion: string, automatic = true): Promise<MealImageAnalysis> {
    const now = new Date();
    const item: AnalysisWorkItem = { id: randomUUID(), userId, mealId, mediaId: randomUUID(), objectKey: stored.objectKey, contentType, status: automatic ? "pending" : "waiting", model, promptVersion, candidate: null, lastErrorCode: null, imageAvailable: true, adoptedAt: null, revision: 1, attempts: [], createdAt: now, updatedAt: now };
    this.#items.set(item.id, item); this.#expires.set(item.mediaId, _expiresAt); this.#mediaBytes.set(item.mediaId, stored.byteSize); return clone(item);
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
    if (!value.imageAvailable) { this.#items.set(id, { ...value, status: "cancelled", lastErrorCode: "image_unavailable", revision: value.revision + 1, attempts: value.attempts.map(item => item.id === attemptId ? { ...item, status: "failed", errorCode: "image_unavailable", finishedAt: new Date() } : item) }); return "not_running" as const; }
    const attempts = value.attempts.map((item) => item.id === attemptId ? { ...item, status: "succeeded" as const, providerRequestId, finishedAt: new Date() } : item);
    this.#items.set(id, { ...value, status: "succeeded", candidate, lastErrorCode: null, attempts, revision: value.revision + 1, updatedAt: new Date() }); return { status: "succeeded" as const, tentativeHandled: false };
  }
  public async fail(id: string, attemptId: string, errorCode: string) { const value = this.#items.get(id); if (value === undefined) return; const attempts = value.attempts.map((item) => item.id === attemptId && item.status === "running" ? { ...item, status: "failed" as const, errorCode, finishedAt: new Date() } : item); this.#items.set(id, { ...value, status: "failed", lastErrorCode: errorCode, attempts, revision: value.revision + 1, updatedAt: new Date() }); }
  public async retry(userId: string, id: string, revision: number, provider?: { model: string; promptVersion: string }) { const value = this.#items.get(id); if (value === undefined || value.userId !== userId) return "not_found" as const; if (value.revision !== revision) return "revision_conflict" as const; if (!["failed", "waiting", "cancelled"].includes(value.status) || !value.imageAvailable || (this.#expires.get(value.mediaId)?.getTime() ?? 0) <= Date.now()) return "not_failed" as const; const saved = { ...value, ...provider, status: "pending" as const, lastErrorCode: null, revision: value.revision + 1, updatedAt: new Date() }; this.#items.set(id, saved); return clone(saved); }
  public async markAdopted(userId: string, id: string, revision: number) { const value = this.#items.get(id); if (value === undefined || value.userId !== userId) return "not_found" as const; if (value.revision !== revision) return "revision_conflict" as const; if (value.status !== "succeeded" || value.candidate === null || value.adoptedAt !== null) return "not_ready" as const; const saved = { ...value, adoptedAt: new Date(), revision: value.revision + 1, updatedAt: new Date() }; this.#items.set(id, saved); return clone(saved); }
  public async markMediaStatus(mediaId: string, status: "available" | "deletion_pending" | "deleted" | "missing") { for (const [id, value] of this.#items) if (value.mediaId === mediaId) this.#items.set(id, { ...value, imageAvailable: status === "available", updatedAt: new Date() }); }
}
