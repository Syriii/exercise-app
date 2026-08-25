import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../../app.js";
import type { AppConfig } from "../../config/environment.js";
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
  temporaryMediaRoot: "/tmp/exercise-app-test-media",
  webDistDirectory: "/directory-that-does-not-exist",
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
});
