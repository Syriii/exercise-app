import type { StoredTemporaryMedia } from "../media/temporary-media-store.js";
import type { ExportDownload, PortabilityTask, PortabilityTaskType, PortabilityWorkItem, UserExportEnvelope } from "./types.js";

export interface UserDataExporter {
  exportUserData(userId: string, exportedAt: Date): Promise<UserExportEnvelope>;
}

export interface PortabilityRepository {
  createTask(userId: string, type: PortabilityTaskType): Promise<PortabilityTask>;
  listTasks(userId: string): Promise<readonly PortabilityTask[]>;
  getTask(userId: string, taskId: string): Promise<PortabilityTask | null>;
  getWorkItem(taskId: string): Promise<PortabilityWorkItem | null>;
  listPendingTaskIds(): Promise<readonly string[]>;
  beginAttempt(taskId: string): Promise<{ work: PortabilityWorkItem; attemptId: string } | "not_found" | "not_ready">;
  completeExport(taskId: string, attemptId: string, stored: StoredTemporaryMedia, expiresAt: Date): Promise<"succeeded" | "not_running">;
  fail(taskId: string, attemptId: string, errorCode: string): Promise<void>;
  getDownload(userId: string, taskId: string): Promise<ExportDownload | null>;
  listUserMedia(userId: string): Promise<readonly { id: string; objectKey: string; status: "available" | "deletion_pending" | "deleted" | "missing" }[]>;
  listExpiredMedia(now: Date): Promise<readonly { id: string; objectKey: string }[]>;
  markMediaStatus(mediaId: string, status: "available" | "deletion_pending" | "deleted" | "missing"): Promise<void>;
  removeTask(taskId: string): Promise<void>;
}
