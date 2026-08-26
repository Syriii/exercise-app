import { Readable } from "node:stream";

import type { Account } from "../identity/types.js";
import type { IdentityService } from "../identity/service.js";
import type { TemporaryMediaStore } from "../media/temporary-media-store.js";
import type { TaskQueue } from "../tasks/task-queue.js";
import { PortabilityError } from "./errors.js";
import type { PortabilityRepository, UserDataExporter } from "./repository.js";
import type { UserExportEnvelope } from "./types.js";

export const portabilityQueue = "portability";
export const portabilityQueueDefinition = { name: portabilityQueue, retryLimit: 0, retryDelaySeconds: 30, retryBackoff: false, expireInSeconds: 600, heartbeatSeconds: 30, deleteAfterSeconds: 86_400 } as const;

export class PortabilityService {
  public constructor(private readonly options: { repository: PortabilityRepository; exporter: UserDataExporter; mediaStore: TemporaryMediaStore; queue: TaskQueue; identityService: IdentityService; exportMaxBytes: number; exportRetentionHours: number; now?: () => Date }) {}

  public listTasks(userId: string) { return this.options.repository.listTasks(userId); }

  public async requestExport(userId: string) {
    const task = await this.options.repository.createTask(userId, "data_export");
    await this.options.queue.enqueue(portabilityQueue, task.id);
    return task;
  }

  public async getDownload(userId: string, taskId: string) {
    const task = await this.options.repository.getTask(userId, taskId);
    if (task === null) throw new PortabilityError("portability_task_not_found", "找不到这次导出", 404);
    const value = await this.options.repository.getDownload(userId, taskId);
    if (value === null) throw new PortabilityError("export_not_ready", "导出尚未完成或已经过期", 409);
    return { ...value, stream: await this.options.mediaStore.open(value.objectKey) };
  }

  public async requestAccountDeletion(account: Account, confirmationUsername: string, password: string) {
    if (confirmationUsername !== account.username) throw new PortabilityError("account_confirmation_mismatch", "请输入当前用户名以确认删除范围", 400);
    if (account.role === "admin") throw new PortabilityError("account_deletion_not_allowed", "预置管理员账号不能在应用内删除", 409);
    await this.options.identityService.confirmAccountDeletion(account, password);
    const task = await this.options.repository.createTask(account.id, "account_deletion");
    try { await this.options.identityService.disableForDeletion(account); }
    catch (error) { await this.options.repository.removeTask(task.id); throw error; }
    await this.options.queue.enqueue(portabilityQueue, task.id);
    return task;
  }

  public async recoverPendingTasks(): Promise<number> {
    const ids = await this.options.repository.listPendingTaskIds();
    for (const id of ids) await this.options.queue.enqueue(portabilityQueue, id);
    return ids.length;
  }

  public async process(taskId: string): Promise<void> {
    const started = await this.options.repository.beginAttempt(taskId);
    if (started === "not_found" || started === "not_ready") return;
    try {
      if (started.work.type === "data_export") {
        await this.#processExport(started.work.userId, taskId, started.attemptId);
        return;
      }
      await this.#processDeletion(started.work.userId, taskId);
    } catch (error) {
      const code = error instanceof Error ? error.message.slice(0, 100) : "portability_task_failed";
      await this.options.repository.fail(taskId, started.attemptId, code);
      throw error;
    }
  }

  public async cleanupExpiredMedia(): Promise<{ deleted: number; missing: number }> {
    let deleted = 0; let missing = 0;
    for (const media of await this.options.repository.listExpiredMedia(this.#now())) {
      await this.options.repository.markMediaStatus(media.id, "deletion_pending");
      const removed = await this.options.mediaStore.delete(media.objectKey);
      await this.options.repository.markMediaStatus(media.id, removed ? "deleted" : "missing");
      if (removed) deleted += 1; else missing += 1;
    }
    return { deleted, missing };
  }

  async #processExport(userId: string, taskId: string, attemptId: string) {
    const envelope = await this.options.exporter.exportUserData(userId, this.#now());
    const value = Buffer.from(`${JSON.stringify(envelope, null, 2)}\n`, "utf8");
    if (value.byteLength > this.options.exportMaxBytes) throw new Error("export_too_large");
    const stored = await this.options.mediaStore.put(Readable.from(value), { maxBytes: this.options.exportMaxBytes });
    const expiresAt = new Date(this.#now().getTime() + this.options.exportRetentionHours * 60 * 60 * 1000);
    const result = await this.options.repository.completeExport(taskId, attemptId, stored, expiresAt);
    if (result !== "succeeded") await this.options.mediaStore.delete(stored.objectKey);
  }

  async #processDeletion(userId: string, taskId: string) {
    for (const media of await this.options.repository.listUserMedia(userId)) {
      if (media.status === "deleted" || media.status === "missing") continue;
      await this.options.repository.markMediaStatus(media.id, "deletion_pending");
      const removed = await this.options.mediaStore.delete(media.objectKey);
      await this.options.repository.markMediaStatus(media.id, removed ? "deleted" : "missing");
    }
    await this.options.identityService.deleteAccountPermanently(userId);
    await this.options.repository.removeTask(taskId);
  }

  #now() { return this.options.now?.() ?? new Date(); }
}

export class FixedUserDataExporter implements UserDataExporter {
  public constructor(private readonly value: Omit<UserExportEnvelope, "exportedAt">) {}
  public async exportUserData(_userId: string, exportedAt: Date): Promise<UserExportEnvelope> { return { ...this.value, exportedAt: exportedAt.toISOString() }; }
}
