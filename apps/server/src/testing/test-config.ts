import { resolve } from "node:path";

import type { AppConfig } from "../config/environment.js";

export function createTestConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    mode: "test",
    host: "127.0.0.1",
    port: 3000,
    logLevel: "silent",
    databaseUrl: "postgresql://unused",
    sessionSecret: "a-test-only-session-secret-with-at-least-32-characters",
    sessionTtlHours: 168,
    cookieSecure: false,
    workerHeartbeatIntervalSeconds: 15,
    workerHeartbeatStaleSeconds: 45,
    temporaryMediaRoot: resolve(".runtime/test-media"),
    webDistDirectory: resolve("apps/web/dist"),
    deepseekApiKey: null,
    deepseekBaseUrl: "https://api.deepseek.com",
    deepseekVisionModel: "test-vision-model",
    deepseekTimeoutMs: 5_000,
    publicFoodSearchEnabled: false,
    openFoodFactsSearchUrl: "https://search.openfoodfacts.org/search",
    publicFoodSearchTimeoutMs: 1_000,
    publicFoodSearchCacheSeconds: 60,
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
    ...overrides,
  };
}
