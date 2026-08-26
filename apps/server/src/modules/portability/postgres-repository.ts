import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";

import type { Database } from "../../db/database.js";
import { backgroundTaskAttempts, backgroundTasks, temporaryMedia } from "../../db/schema/index.js";
import type { StoredTemporaryMedia } from "../media/temporary-media-store.js";
import type { PortabilityRepository } from "./repository.js";
import type { PortabilityTask, PortabilityTaskType, PortabilityWorkItem } from "./types.js";

const taskTypes: PortabilityTaskType[] = ["data_export", "account_deletion"];

export class PostgresPortabilityRepository implements PortabilityRepository {
  public constructor(private readonly database: Database) {}

  public async createTask(userId: string, type: PortabilityTaskType): Promise<PortabilityTask> {
    const [row] = await this.database.insert(backgroundTasks).values({ userId, type }).returning();
    if (row === undefined) throw new Error("portability task insert returned no row");
    return this.toTask(row, null);
  }

  public async listTasks(userId: string): Promise<readonly PortabilityTask[]> {
    const rows = await this.database.select({ task: backgroundTasks, media: temporaryMedia }).from(backgroundTasks).leftJoin(temporaryMedia, eq(backgroundTasks.subjectId, temporaryMedia.id)).where(and(eq(backgroundTasks.userId, userId), inArray(backgroundTasks.type, taskTypes))).orderBy(desc(backgroundTasks.createdAt));
    return rows.map((row) => this.toTask(row.task, row.media));
  }

  public async getTask(userId: string, taskId: string): Promise<PortabilityTask | null> {
    const [row] = await this.database.select({ task: backgroundTasks, media: temporaryMedia }).from(backgroundTasks).leftJoin(temporaryMedia, eq(backgroundTasks.subjectId, temporaryMedia.id)).where(and(eq(backgroundTasks.id, taskId), eq(backgroundTasks.userId, userId), inArray(backgroundTasks.type, taskTypes))).limit(1);
    return row === undefined ? null : this.toTask(row.task, row.media);
  }

  public async getWorkItem(taskId: string): Promise<PortabilityWorkItem | null> {
    const [row] = await this.database.select({ task: backgroundTasks, media: temporaryMedia }).from(backgroundTasks).leftJoin(temporaryMedia, eq(backgroundTasks.subjectId, temporaryMedia.id)).where(and(eq(backgroundTasks.id, taskId), inArray(backgroundTasks.type, taskTypes))).limit(1);
    if (row === undefined || row.task.userId === null) return null;
    return { ...this.toTask(row.task, row.media), userId: row.task.userId, subjectId: row.task.subjectId };
  }

  public async listPendingTaskIds(): Promise<readonly string[]> {
    const rows = await this.database.select({ id: backgroundTasks.id }).from(backgroundTasks).where(and(eq(backgroundTasks.status, "pending"), inArray(backgroundTasks.type, taskTypes)));
    return rows.map((row) => row.id);
  }

  public async beginAttempt(taskId: string) {
    const attemptId = await this.database.transaction(async (transaction) => {
      const [task] = await transaction.select().from(backgroundTasks).where(eq(backgroundTasks.id, taskId)).for("update").limit(1);
      if (task === undefined || task.userId === null || !taskTypes.includes(task.type as PortabilityTaskType)) return "not_found" as const;
      if (task.status !== "pending") return "not_ready" as const;
      const [countRow] = await transaction.select({ count: sql<number>`count(*)::int` }).from(backgroundTaskAttempts).where(eq(backgroundTaskAttempts.taskId, taskId));
      const [attempt] = await transaction.insert(backgroundTaskAttempts).values({ taskId, sequence: (countRow?.count ?? 0) + 1 }).returning({ id: backgroundTaskAttempts.id });
      if (attempt === undefined) throw new Error("portability attempt insert returned no row");
      await transaction.update(backgroundTasks).set({ status: "running", updatedAt: new Date() }).where(eq(backgroundTasks.id, taskId));
      return attempt.id;
    });
    if (attemptId === "not_found" || attemptId === "not_ready") return attemptId;
    const work = await this.getWorkItem(taskId); return work === null ? "not_found" as const : { work, attemptId };
  }

  public async completeExport(taskId: string, attemptId: string, stored: StoredTemporaryMedia, expiresAt: Date) {
    return this.database.transaction(async (transaction) => {
      const [task] = await transaction.select().from(backgroundTasks).where(eq(backgroundTasks.id, taskId)).for("update").limit(1);
      const [attempt] = await transaction.select().from(backgroundTaskAttempts).where(and(eq(backgroundTaskAttempts.id, attemptId), eq(backgroundTaskAttempts.taskId, taskId))).for("update").limit(1);
      if (task?.status !== "running" || task.userId === null || attempt?.status !== "running") return "not_running" as const;
      const [media] = await transaction.insert(temporaryMedia).values({ userId: task.userId, objectKey: stored.objectKey, contentType: "application/json", byteSize: stored.byteSize, sha256: stored.sha256, expiresAt }).returning({ id: temporaryMedia.id });
      if (media === undefined) throw new Error("export media insert returned no row");
      const now = new Date();
      await transaction.update(backgroundTaskAttempts).set({ status: "succeeded", finishedAt: now }).where(eq(backgroundTaskAttempts.id, attemptId));
      await transaction.update(backgroundTasks).set({ status: "succeeded", subjectId: media.id, completedAt: now, updatedAt: now }).where(eq(backgroundTasks.id, taskId));
      return "succeeded" as const;
    });
  }

  public async fail(taskId: string, attemptId: string, errorCode: string): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction.update(backgroundTaskAttempts).set({ status: "failed", errorCode, finishedAt: new Date() }).where(and(eq(backgroundTaskAttempts.id, attemptId), eq(backgroundTaskAttempts.status, "running")));
      await transaction.update(backgroundTasks).set({ status: "failed", lastErrorCode: errorCode, updatedAt: new Date() }).where(and(eq(backgroundTasks.id, taskId), eq(backgroundTasks.status, "running")));
    });
  }

  public async getDownload(userId: string, taskId: string) {
    const [row] = await this.database.select({ objectKey: temporaryMedia.objectKey, contentType: temporaryMedia.contentType, byteSize: temporaryMedia.byteSize, sha256: temporaryMedia.sha256, status: temporaryMedia.status }).from(backgroundTasks).innerJoin(temporaryMedia, eq(backgroundTasks.subjectId, temporaryMedia.id)).where(and(eq(backgroundTasks.id, taskId), eq(backgroundTasks.userId, userId), eq(backgroundTasks.type, "data_export"), eq(backgroundTasks.status, "succeeded"))).limit(1);
    return row === undefined || row.status !== "available" ? null : { objectKey: row.objectKey, contentType: row.contentType, byteSize: row.byteSize, sha256: row.sha256 };
  }

  public async listUserMedia(userId: string) { return this.database.select({ id: temporaryMedia.id, objectKey: temporaryMedia.objectKey, status: temporaryMedia.status }).from(temporaryMedia).where(eq(temporaryMedia.userId, userId)); }
  public async listExpiredMedia(now: Date) { return this.database.select({ id: temporaryMedia.id, objectKey: temporaryMedia.objectKey }).from(temporaryMedia).where(and(eq(temporaryMedia.status, "available"), lte(temporaryMedia.expiresAt, now))); }
  public async markMediaStatus(mediaId: string, status: "available" | "deletion_pending" | "deleted" | "missing") { await this.database.update(temporaryMedia).set({ status, deletedAt: status === "deleted" || status === "missing" ? new Date() : null, updatedAt: new Date() }).where(eq(temporaryMedia.id, mediaId)); }
  public async removeTask(taskId: string) { await this.database.delete(backgroundTasks).where(eq(backgroundTasks.id, taskId)); }

  private toTask(row: typeof backgroundTasks.$inferSelect, media: typeof temporaryMedia.$inferSelect | null): PortabilityTask {
    const exportAvailable = row.type === "data_export" && row.status === "succeeded" && media?.status === "available";
    return { id: row.id, type: row.type as PortabilityTaskType, status: row.status, lastErrorCode: row.lastErrorCode, downloadAvailable: exportAvailable, expiresAt: exportAvailable ? media.expiresAt : null, createdAt: row.createdAt, updatedAt: row.updatedAt, completedAt: row.completedAt };
  }
}
