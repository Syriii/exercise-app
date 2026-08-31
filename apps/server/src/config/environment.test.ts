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
    expect(config.workerHeartbeatIntervalSeconds).toBe(15);
    expect(config.workerHeartbeatStaleSeconds).toBe(45);
    expect(config.deepseekApiKey).toBeNull();
    expect(config.deepseekBaseUrl).toBe("https://api.deepseek.com");
    expect(config.deepseekVisionModel).toBe("deepseek-v4-flash-vision-exp");
    expect(config.imageUploadMaxBytes).toBe(8 * 1024 * 1024);
    expect(config.exportRetentionHours).toBe(168);
  });

  it("loads optional DeepSeek configuration from a file without making it required", () => {
    const config = loadConfig(
      {
        ...validEnvironment,
        DEEPSEEK_API_KEY_FILE: "/run/secrets/deepseek_api_key",
        DEEPSEEK_VISION_MODEL: "configured-vision-model",
        DEEPSEEK_TIMEOUT_MS: "90000",
        IMAGE_UPLOAD_MAX_BYTES: "4194304",
      },
      () => "deepseek-test-key\n",
    );

    expect(config.deepseekApiKey).toBe("deepseek-test-key");
    expect(config.deepseekVisionModel).toBe("configured-vision-model");
    expect(config.deepseekTimeoutMs).toBe(90_000);
    expect(config.imageUploadMaxBytes).toBe(4 * 1024 * 1024);
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

    expect(() =>
      loadConfig({
        ...validEnvironment,
        WORKER_HEARTBEAT_INTERVAL_SECONDS: "60",
        WORKER_HEARTBEAT_STALE_SECONDS: "45",
      }),
    ).toThrow(/must exceed/);

    expect(() =>
      loadConfig({
        ...validEnvironment,
        DEEPSEEK_API_KEY: "direct",
        DEEPSEEK_API_KEY_FILE: "/run/secrets/deepseek_api_key",
      }),
    ).toThrow(/cannot both be set/);
  });

  it("rejects public example placeholders even when they satisfy length rules", () => {
    expect(() =>
      loadConfig({
        ...validEnvironment,
        SESSION_SECRET: "replace-with-at-least-32-random-characters-for-session-hmac",
      }),
    ).toThrow(/public example placeholder/);

    expect(() =>
      loadConfig({
        ...validEnvironment,
        DATABASE_URL:
          "postgresql://exercise:replace-with-a-long-random-password@postgres:5432/exercise",
      }),
    ).toThrow(/public example placeholder/);

    expect(() =>
      loadConfig({
        ...validEnvironment,
        DEEPSEEK_API_KEY_FILE: "/run/secrets/deepseek_api_key",
      }, () => "replace-with-your-deepseek-api-key\n"),
    ).toThrow(/public example placeholder/);
  });
});
