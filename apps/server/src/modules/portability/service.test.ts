import { describe, expect, it } from "vitest";

import { MemoryIdentityRepository } from "../identity/memory-repository.js";
import { IdentityService } from "../identity/service.js";
import { MemoryTemporaryMediaStore } from "../media/memory-temporary-media-store.js";
import { MemoryTaskQueue } from "../tasks/memory-task-queue.js";
import { MemoryPortabilityRepository } from "./memory-repository.js";
import { FixedUserDataExporter, PortabilityService } from "./service.js";

async function fixture() {
  let now = new Date("2026-08-26T00:00:00.000Z");
  const identityRepository = new MemoryIdentityRepository();
  const identityService = new IdentityService({ repository: identityRepository, sessionSecret: "portability-test-secret-that-is-long-enough", sessionTtlHours: 24, now: () => now });
  const session = await identityService.register("portable-user", "correct horse battery staple");
  const repository = new MemoryPortabilityRepository();
  const mediaStore = new MemoryTemporaryMediaStore();
  const queue = new MemoryTaskQueue();
  const service = new PortabilityService({ repository, mediaStore, queue, identityService, exporter: new FixedUserDataExporter({ schemaVersion: "exercise-app-user-export-v1", account: { username: "portable-user" }, data: { meals: [{ id: "meal-1" }] }, lifecycle: { includesOriginalPhotos: false, excludesCredentialsAndSessions: true, temporaryMedia: [] } }), exportMaxBytes: 1024 * 1024, exportRetentionHours: 1, now: () => now });
  return { identityRepository, identityService, repository, mediaStore, service, session, advance: (milliseconds: number) => { now = new Date(now.getTime() + milliseconds); } };
}

describe("PortabilityService", () => {
  it("creates a background JSON export without photos, credentials, or sessions", async () => {
    const values = await fixture();
    const task = await values.service.requestExport(values.session.account.id);
    await values.service.process(task.id);
    const [completed] = await values.service.listTasks(values.session.account.id);
    expect(completed).toMatchObject({ status: "succeeded", downloadAvailable: true });
    const download = await values.service.getDownload(values.session.account.id, task.id);
    const chunks: Buffer[] = [];
    for await (const chunk of download.stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
    expect(body).toMatchObject({ schemaVersion: "exercise-app-user-export-v1", lifecycle: { includesOriginalPhotos: false, excludesCredentialsAndSessions: true } });
    expect(JSON.stringify(body)).not.toContain("passwordHash");
    expect(JSON.stringify(body)).not.toContain("tokenHash");
  });

  it("requires both the username and current password before deleting a non-admin account", async () => {
    const values = await fixture();
    await expect(values.service.requestAccountDeletion(values.session.account, "wrong-user", "correct horse battery staple")).rejects.toMatchObject({ code: "account_confirmation_mismatch" });
    await expect(values.service.requestAccountDeletion(values.session.account, "portable-user", "wrong password")).rejects.toMatchObject({ code: "invalid_current_password" });
    const task = await values.service.requestAccountDeletion(values.session.account, "portable-user", "correct horse battery staple");
    await expect(values.identityService.authenticate(values.session.token)).rejects.toMatchObject({ code: "authentication_required" });
    await values.service.process(task.id);
    expect(values.identityRepository.accounts.has(values.session.account.id)).toBe(false);
  });

  it("cleans expired export artifacts while preserving the task lifecycle", async () => {
    const values = await fixture();
    const task = await values.service.requestExport(values.session.account.id);
    await values.service.process(task.id);
    values.advance(2 * 60 * 60 * 1000);
    await expect(values.service.cleanupExpiredMedia()).resolves.toEqual({ deleted: 1, missing: 0 });
    await expect(values.service.getDownload(values.session.account.id, task.id)).rejects.toMatchObject({ code: "export_not_ready" });
    expect((await values.service.listTasks(values.session.account.id))[0]).toMatchObject({ status: "succeeded", downloadAvailable: false });
  });

  it("never lists or downloads another account's export", async () => {
    const values = await fixture();
    const other = await values.identityService.register("other-portable-user", "correct horse battery staple");
    const task = await values.service.requestExport(values.session.account.id);
    await values.service.process(task.id);

    await expect(values.service.listTasks(other.account.id)).resolves.toEqual([]);
    await expect(values.service.getDownload(other.account.id, task.id)).rejects.toMatchObject({
      code: "portability_task_not_found",
      statusCode: 404,
    });
  });
});
