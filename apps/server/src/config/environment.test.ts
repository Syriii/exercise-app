import { describe, expect, it } from "vitest";

import { loadConfig } from "./environment.js";

const validEnvironment = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://exercise:secret@127.0.0.1:5432/exercise",
  SESSION_SECRET: "a-development-only-secret-with-32-chars",
} as const;

describe("loadConfig", () => {
  it("loads safe local defaults without inventing database credentials", () => {
    const config = loadConfig(validEnvironment);

    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(3000);
    expect(config.cookieSecure).toBe(false);
    expect(config.sessionTtlHours).toBe(168);
  });

  it("supports file-backed secrets", () => {
    const config = loadConfig(
      {
        NODE_ENV: "production",
        DATABASE_URL_FILE: "/run/secrets/database_url",
        SESSION_SECRET_FILE: "/run/secrets/session_secret",
      },
      (path) =>
        path.endsWith("database_url")
          ? "postgresql://exercise:secret@postgres:5432/exercise\n"
          : "a-production-secret-that-is-long-enough\n",
    );

    expect(config.databaseUrl).toContain("@postgres:5432");
    expect(config.cookieSecure).toBe(true);
  });

  it("builds a container connection URL from one shared password secret", () => {
    const config = loadConfig(
      {
        NODE_ENV: "production",
        DATABASE_HOST: "postgres",
        DATABASE_NAME: "exercise",
        DATABASE_USER: "exercise",
        DATABASE_PASSWORD_FILE: "/run/secrets/database_password",
        SESSION_SECRET_FILE: "/run/secrets/session_secret",
      },
      (path) =>
        path.endsWith("database_password")
          ? "a p@ssword\n"
          : "a-production-secret-that-is-long-enough\n",
    );

    expect(config.databaseUrl).toBe(
      "postgresql://exercise:a%20p%40ssword@postgres:5432/exercise",
    );
  });

  it("rejects ambiguous or weak secret configuration", () => {
    expect(() =>
      loadConfig({
        ...validEnvironment,
        SESSION_SECRET_FILE: "/run/secrets/session_secret",
      }),
    ).toThrow(/cannot both be set/);

    expect(() =>
      loadConfig({
        ...validEnvironment,
        SESSION_SECRET: "too-short",
      }),
    ).toThrow(/at least 32 characters/);

    expect(() =>
      loadConfig({
        ...validEnvironment,
        DATABASE_PASSWORD: "ambiguous",
      }),
    ).toThrow(/cannot be combined/);
  });
});
