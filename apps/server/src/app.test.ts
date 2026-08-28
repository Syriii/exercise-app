import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";
import { DatabaseUserContext } from "./db/user-context.js";
import { MemoryIdentityRepository } from "./modules/identity/memory-repository.js";
import { sessionCookieName } from "./modules/identity/routes.js";
import { IdentityService } from "./modules/identity/service.js";
import { MemoryPlanningRepository } from "./modules/planning/memory-repository.js";
import { PlanningService } from "./modules/planning/service.js";
import type { DailyPlanningResult, PlanningInputSnapshot } from "./modules/planning/types.js";
import { createTestConfig } from "./testing/test-config.js";

const config = createTestConfig({ webDistDirectory: "/directory-that-does-not-exist" });

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => rm(directory, { recursive: true })),
  );
});

describe("health routes", () => {
  it("reports process liveness without requiring the database", async () => {
    const app = await buildApp({
      config,
      checkDatabase: async () => {
        throw new Error("not called");
      },
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/v1/health/live" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("reports database readiness without leaking the connection error", async () => {
    const app = await buildApp({
      config,
      checkDatabase: async () => {
        throw new Error("postgresql://user:secret@private-host/database");
      },
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/v1/health/ready" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: "unavailable",
      code: "database_unavailable",
    });
    expect(response.body).not.toContain("secret");
  });

  it("does not expose unexpected server error details to the browser", async () => {
    const app = await buildApp({
      config,
      checkDatabase: async () => undefined,
    });
    apps.push(app);
    app.get("/api/v1/test-internal-error", async () => {
      throw new Error('Failed query: insert into "private_table" params: private-user-id');
    });

    const response = await app.inject({ method: "GET", url: "/api/v1/test-internal-error" });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      code: "internal_error",
      message: "服务器暂时无法处理请求",
      requestId: response.json<{ requestId: string }>().requestId,
    });
    expect(response.body).not.toContain("private_table");
    expect(response.body).not.toContain("private-user-id");
  });

  it("serves the web entry for browser history routes without swallowing API 404s", async () => {
    const webDistDirectory = await mkdtemp(join(tmpdir(), "exercise-app-web-"));
    temporaryDirectories.push(webDistDirectory);
    await writeFile(join(webDistDirectory, "index.html"), "<main>Exercise App</main>");
    const app = await buildApp({
      config: { ...config, webDistDirectory },
      checkDatabase: async () => undefined,
    });
    apps.push(app);

    const documentResponse = await app.inject({ method: "GET", url: "/training" });
    const apiResponse = await app.inject({ method: "GET", url: "/api/v1/unknown" });
    const apiRootResponse = await app.inject({ method: "GET", url: "/api?probe=true" });

    expect(documentResponse.statusCode).toBe(200);
    expect(documentResponse.body).toContain("Exercise App");
    expect(apiResponse.statusCode).toBe(404);
    expect(apiResponse.json()).toMatchObject({ code: "not_found" });
    expect(apiRootResponse.statusCode).toBe(404);
    expect(apiRootResponse.json()).toMatchObject({ code: "not_found" });
  });

  it("rate limits repeated authentication attempts through the real request hook", async () => {
    const limitedConfig = createTestConfig({
      webDistDirectory: "/directory-that-does-not-exist",
      authRateLimitMax: 2,
      authRateLimitWindowSeconds: 300,
    });
    const identityService = new IdentityService({
      repository: new MemoryIdentityRepository(),
      sessionSecret: limitedConfig.sessionSecret,
      sessionTtlHours: limitedConfig.sessionTtlHours,
    });
    const app = await buildApp({
      config: limitedConfig,
      checkDatabase: async () => undefined,
      identityService,
    });
    apps.push(app);
    const request = () => app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "missing-user", password: "valid-length-password" },
    });

    expect((await request()).statusCode).toBe(401);
    expect((await request()).statusCode).toBe(401);
    const blocked = await request();

    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers["retry-after"]).toBe("300");
    expect(blocked.json()).toMatchObject({ code: "rate_limit_exceeded" });
  });

  it("keeps an authenticated database user context around the complete route handler", async () => {
    const identityService = new IdentityService({
      repository: new MemoryIdentityRepository(),
      sessionSecret: config.sessionSecret,
      sessionTtlHours: config.sessionTtlHours,
    });
    const databaseUserContext = new DatabaseUserContext();
    const contextsSeenByWrite: Array<{ userId: string; before: string | null; after: string | null }> = [];
    class ContextCheckingPlanningRepository extends MemoryPlanningRepository {
      public override async createReference(
        userId: string,
        methodVersion: string,
        evidenceIds: readonly string[],
        inputSnapshot: PlanningInputSnapshot,
        result: DailyPlanningResult,
      ) {
        const before = databaseUserContext.userId;
        await new Promise<void>((resolveDelay) => setImmediate(resolveDelay));
        contextsSeenByWrite.push({ userId, before, after: databaseUserContext.userId });
        return super.createReference(userId, methodVersion, evidenceIds, inputSnapshot, result);
      }
    }
    const app = await buildApp({
      config,
      checkDatabase: async () => undefined,
      identityService,
      planningService: new PlanningService(new ContextCheckingPlanningRepository()),
      databaseUserContext,
    });
    apps.push(app);
    const registrationA = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: { username: "context-user-a", password: "context route test password" },
    });
    const registrationB = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: { username: "context-user-b", password: "context route test password" },
    });
    const cookieFor = (response: typeof registrationA) => {
      const setCookie = response.headers["set-cookie"];
      if (typeof setCookie !== "string") throw new Error("expected session cookie");
      const value = setCookie.split(";", 1)[0] ?? "";
      expect(value).toContain(`${sessionCookieName}=`);
      return value;
    };

    const responses = await Promise.all([
      app.inject({
        method: "GET",
        url: "/api/v1/planning/daily-reference?localDate=2026-08-28&timeZone=Asia%2FShanghai",
        headers: { cookie: cookieFor(registrationA) },
      }),
      app.inject({
        method: "GET",
        url: "/api/v1/planning/daily-reference?localDate=2026-08-28&timeZone=Asia%2FShanghai",
        headers: { cookie: cookieFor(registrationB) },
      }),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([200, 200]);
    expect(contextsSeenByWrite).toHaveLength(2);
    expect(contextsSeenByWrite).toEqual(expect.arrayContaining([
      {
        userId: registrationA.json<{ id: string }>().id,
        before: registrationA.json<{ id: string }>().id,
        after: registrationA.json<{ id: string }>().id,
      },
      {
        userId: registrationB.json<{ id: string }>().id,
        before: registrationB.json<{ id: string }>().id,
        after: registrationB.json<{ id: string }>().id,
      },
    ]));
  });
});
