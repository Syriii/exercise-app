import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../../app.js";
import type { AppConfig } from "../../config/environment.js";
import type { OperationsSummary } from "../operations/service.js";
import { MemoryIdentityRepository } from "./memory-repository.js";
import { sessionCookieName } from "./routes.js";
import { IdentityService } from "./service.js";

const config: AppConfig = {
  mode: "test",
  host: "127.0.0.1",
  port: 3000,
  logLevel: "silent",
  databaseUrl: "postgresql://unused",
  sessionSecret: "a-route-test-session-secret-that-is-long-enough",
  sessionTtlHours: 168,
  cookieSecure: false,
  workerHeartbeatIntervalSeconds: 15,
  workerHeartbeatStaleSeconds: 45,
  temporaryMediaRoot: "/tmp/exercise-app-test-media",
  webDistDirectory: "/directory-that-does-not-exist",
  deepseekApiKey: null,
  deepseekBaseUrl: "https://api.deepseek.com",
  deepseekVisionModel: "test-vision-model",
  deepseekTimeoutMs: 5_000,
  imageUploadMaxBytes: 1024 * 1024,
  exportMaxBytes: 4 * 1024 * 1024,
  exportRetentionHours: 24,
  mediaCleanupIntervalSeconds: 3600,
  maxAccounts: 100,
  authRateLimitMax: 10_000,
  authRateLimitWindowSeconds: 300,
  writeRateLimitMax: 10_000,
  writeRateLimitWindowSeconds: 60,
  imageRateLimitMax: 10_000,
  imageRateLimitWindowSeconds: 3600,
  maxActiveImageAnalysesPerAccount: 100,
  temporaryMediaMaxBytesPerAccount: 1024 * 1024 * 1024,
};

const password = "correct horse battery staple";
const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

async function createApp() {
  const repository = new MemoryIdentityRepository();
  const service = new IdentityService({
    repository,
    sessionSecret: config.sessionSecret,
    sessionTtlHours: config.sessionTtlHours,
  });
  const app = await buildApp({
    config,
    checkDatabase: async () => undefined,
    identityService: service,
  });
  apps.push(app);
  return { app, repository, service };
}

async function createAppWithOperations() {
  const repository = new MemoryIdentityRepository();
  const service = new IdentityService({
    repository,
    sessionSecret: config.sessionSecret,
    sessionTtlHours: config.sessionTtlHours,
  });
  const app = await buildApp({
    config,
    checkDatabase: async () => undefined,
    identityService: service,
    operationsHealthReader: {
      getHealth: async () => ({
        checkedAt: "2026-08-25T08:00:00.000Z",
        api: { status: "healthy", lastSeenAt: "2026-08-25T08:00:00.000Z" },
        database: { status: "healthy", lastSeenAt: "2026-08-25T08:00:00.000Z" },
        worker: { status: "stale", lastSeenAt: "2026-08-25T07:58:00.000Z" },
      }),
    },
    operationsSummaryReader: {
      getSummary: async () =>
        ({
          checkedAt: "2026-08-25T08:00:00.000Z",
          model: { configured: true, model: "vision-model" },
          tasks: { pending: 1, running: 2, succeeded: 3, failed: 4, cancelled: 5 },
          media: {
            available: 6,
            deletion_pending: 7,
            deleted: 8,
            missing: 9,
            expiredAvailable: 1,
          },
          disk: { availableBytes: 1_073_741_824 },
          backup: { lastSucceededAt: "2026-08-24T08:00:00.000Z", lastFailedAt: null },
          restoreVerification: { lastSucceededAt: null, lastFailedAt: null },
          secretThatMustNeverBeSerialized: "private",
        }) as OperationsSummary & { secretThatMustNeverBeSerialized: string },
    },
  });
  apps.push(app);
  return { app, service };
}

function cookieFrom(response: { headers: Record<string, unknown> }): string {
  const header = response.headers["set-cookie"];
  if (typeof header !== "string") {
    throw new Error("expected a set-cookie header");
  }
  return header.split(";", 1)[0] ?? "";
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe("identity routes", () => {
  it("registers through a normal page API and keeps the token in an HttpOnly cookie", async () => {
    const { app } = await createApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      headers: { origin: "http://exercise.local", host: "exercise.local" },
      payload: { username: "friend", password },
    });

    expect(response.statusCode).toBe(201);
    expect(response.headers["set-cookie"]).toContain(`${sessionCookieName}=`);
    expect(response.headers["set-cookie"]).toContain("HttpOnly");
    expect(response.headers["set-cookie"]).toContain("SameSite=Strict");
    expect(response.body).not.toContain(password);
  });

  it("rejects cross-origin credential requests", async () => {
    const { app } = await createApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { origin: "https://attacker.example", host: "exercise.local" },
      payload: { username: "friend", password },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: "invalid_origin" });
  });

  it("does not expose administrator routes to a normal account", async () => {
    const { app } = await createApp();
    const registration = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: { username: "friend", password },
    });
    const cookie = cookieFrom(registration);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/admin/accounts",
      headers: { cookie },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: "admin_required" });
  });

  it("replaces the session cookie after changing a password", async () => {
    const { app, service } = await createApp();
    await service.initializeAdmin(password);
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "admin", password },
    });
    const oldCookie = cookieFrom(login);

    const changed = await app.inject({
      method: "PUT",
      url: "/api/v1/auth/password",
      headers: { cookie: oldCookie },
      payload: {
        currentPassword: password,
        newPassword: "a newer secure administrator password",
      },
    });

    expect(changed.statusCode).toBe(200);
    expect(changed.json()).toMatchObject({ passwordChangeRequired: false });
    expect(cookieFrom(changed)).not.toBe(oldCookie);
    const oldSession = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { cookie: oldCookie },
    });
    expect(oldSession.statusCode).toBe(401);
  });

  it("exposes component health only to an administrator", async () => {
    const { app, service } = await createAppWithOperations();
    await service.initializeAdmin(password);
    const adminLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "admin", password },
    });
    const registration = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: { username: "friend", password },
    });

    const adminResponse = await app.inject({
      method: "GET",
      url: "/api/v1/admin/operations/health",
      headers: { cookie: cookieFrom(adminLogin) },
    });
    const userResponse = await app.inject({
      method: "GET",
      url: "/api/v1/admin/operations/health",
      headers: { cookie: cookieFrom(registration) },
    });
    const adminSummary = await app.inject({
      method: "GET",
      url: "/api/v1/admin/operations/summary",
      headers: { cookie: cookieFrom(adminLogin) },
    });
    const userSummary = await app.inject({
      method: "GET",
      url: "/api/v1/admin/operations/summary",
      headers: { cookie: cookieFrom(registration) },
    });

    expect(adminResponse.statusCode).toBe(200);
    expect(adminResponse.json()).toMatchObject({
      api: { status: "healthy" },
      database: { status: "healthy" },
      worker: { status: "stale" },
    });
    expect(userResponse.statusCode).toBe(403);
    expect(adminSummary.statusCode).toBe(200);
    expect(adminSummary.json()).toMatchObject({
      model: { configured: true, model: "vision-model" },
      tasks: { pending: 1, running: 2, failed: 4 },
      media: { available: 6, expiredAvailable: 1 },
      disk: { availableBytes: 1_073_741_824 },
    });
    expect(adminSummary.body).not.toContain("private");
    expect(userSummary.statusCode).toBe(403);
  });

  it("lets an administrator reset another account without exposing the temporary password", async () => {
    const { app, service } = await createApp();
    await service.initializeAdmin(password);
    const userRegistration = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: { username: "reset-friend", password },
    });
    const adminLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "admin", password },
    });
    const userId = userRegistration.json<{ id: string }>().id;
    const temporaryPassword = "temporary route password";

    const reset = await app.inject({
      method: "PUT",
      url: `/api/v1/admin/accounts/${userId}/password`,
      headers: { cookie: cookieFrom(adminLogin) },
      payload: { temporaryPassword },
    });
    const oldSession = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { cookie: cookieFrom(userRegistration) },
    });
    const newLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "reset-friend", password: temporaryPassword },
    });

    expect(reset.statusCode).toBe(200);
    expect(reset.json()).toMatchObject({ id: userId, passwordChangeRequired: true });
    expect(reset.body).not.toContain(temporaryPassword);
    expect(oldSession.statusCode).toBe(401);
    expect(newLogin.statusCode).toBe(200);
    expect(newLogin.json()).toMatchObject({ passwordChangeRequired: true });
  });
});
