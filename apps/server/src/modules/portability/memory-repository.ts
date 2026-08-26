import { randomUUID } from "node:crypto";

import type { StoredTemporaryMedia } from "../media/temporary-media-store.js";
import type { PortabilityRepository } from "./repository.js";
import type { ExportDownload, PortabilityTask, PortabilityTaskType, PortabilityWorkItem } from "./types.js";

type StoredTask = PortabilityWorkItem & { attemptId: string | null };
type StoredMedia = ExportDownload & { id: string; userId: string; status: "available" | "deletion_pending" | "deleted" | "missing"; expiresAt: Date };
const clone = <T>(value: T): T => structuredClone(value);

export class MemoryPortabilityRepository implements PortabilityRepository {
  readonly #tasks = new Map<string, StoredTask>();
  readonly #media = new Map<string, StoredMedia>();

  public async createTask(userId: string, type: PortabilityTaskType): Promise<PortabilityTask> {
    const now = new Date();
    const value: StoredTask = { id: randomUUID(), userId, type, status: "pending", subjectId: null, lastErrorCode: null, downloadAvailable: false, expiresAt: null, createdAt: now, updatedAt: now, completedAt: null, attemptId: null };
    this.#tasks.set(value.id, value); return clone(value);
  }
  public async listTasks(userId: string) { return clone([...this.#tasks.values()].filter((value) => value.userId === userId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map((value) => this.toPublic(value))); }
  public async getTask(userId: string, taskId: string) { const value = this.#tasks.get(taskId); return value === undefined || value.userId !== userId ? null : clone(this.toPublic(value)); }
  public async getWorkItem(taskId: string) { const value = this.#tasks.get(taskId); return value === undefined ? null : clone(value); }
  public async listPendingTaskIds() { return [...this.#tasks.values()].filter((value) => value.status === "pending").map((value) => value.id); }
  public async beginAttempt(taskId: string) { const value = this.#tasks.get(taskId); if (value === undefined) return "not_found" as const; if (value.status !== "pending") return "not_ready" as const; const attemptId = randomUUID(); const saved = { ...value, status: "running" as const, attemptId, updatedAt: new Date() }; this.#tasks.set(taskId, saved); return { work: clone(saved), attemptId }; }
  public async completeExport(taskId: string, attemptId: string, stored: StoredTemporaryMedia, expiresAt: Date) { const task = this.#tasks.get(taskId); if (task?.status !== "running" || task.attemptId !== attemptId) return "not_running" as const; const mediaId = randomUUID(); this.#media.set(mediaId, { id: mediaId, userId: task.userId, objectKey: stored.objectKey, contentType: "application/json", byteSize: stored.byteSize, sha256: stored.sha256, status: "available", expiresAt }); const now = new Date(); this.#tasks.set(taskId, { ...task, status: "succeeded", subjectId: mediaId, downloadAvailable: true, expiresAt, completedAt: now, updatedAt: now }); return "succeeded" as const; }
  public async fail(taskId: string, attemptId: string, errorCode: string) { const task = this.#tasks.get(taskId); if (task?.status === "running" && task.attemptId === attemptId) this.#tasks.set(taskId, { ...task, status: "failed", lastErrorCode: errorCode, updatedAt: new Date() }); }
  public async getDownload(userId: string, taskId: string) { const task = this.#tasks.get(taskId); if (task === undefined || task.userId !== userId || task.status !== "succeeded" || task.subjectId === null) return null; const media = this.#media.get(task.subjectId); return media === undefined || media.status !== "available" ? null : clone(media); }
  public async listUserMedia(userId: string) { return clone([...this.#media.values()].filter((value) => value.userId === userId).map(({ id, objectKey, status }) => ({ id, objectKey, status }))); }
  public async listExpiredMedia(now: Date) { return clone([...this.#media.values()].filter((value) => value.status === "available" && value.expiresAt <= now).map(({ id, objectKey }) => ({ id, objectKey }))); }
  public async markMediaStatus(mediaId: string, status: StoredMedia["status"]) { const value = this.#media.get(mediaId); if (value !== undefined) this.#media.set(mediaId, { ...value, status }); }
  public async removeTask(taskId: string) { this.#tasks.delete(taskId); }

  private toPublic(value: StoredTask): StoredTask { const media = value.subjectId === null ? undefined : this.#media.get(value.subjectId); return { ...value, downloadAvailable: value.type === "data_export" && value.status === "succeeded" && media?.status === "available", expiresAt: media?.status === "available" ? media.expiresAt : null }; }
}
