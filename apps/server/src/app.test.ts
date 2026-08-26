import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";
import { MemoryIdentityRepository } from "./modules/identity/memory-repository.js";
import { IdentityService } from "./modules/identity/service.js";
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
});
