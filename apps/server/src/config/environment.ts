import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

export type RuntimeMode = "development" | "test" | "production";

export interface AppConfig {
  readonly mode: RuntimeMode;
  readonly host: string;
  readonly port: number;
  readonly logLevel: string;
  readonly databaseUrl: string;
  readonly sessionSecret: string;
  readonly sessionTtlHours: number;
  readonly cookieSecure: boolean;
  readonly workerHeartbeatIntervalSeconds: number;
  readonly workerHeartbeatStaleSeconds: number;
  readonly temporaryMediaRoot: string;
  readonly exerciseMediaRoot: string | null;
  readonly webDistDirectory: string;
  readonly deepseekApiKey: string | null;
  readonly deepseekBaseUrl: string;
  readonly deepseekVisionModel: string;
  readonly deepseekTimeoutMs: number;
  readonly imageUploadMaxBytes: number;
  readonly exportMaxBytes: number;
  readonly exportRetentionHours: number;
  readonly mediaCleanupIntervalSeconds: number;
  readonly maxAccounts: number;
  readonly authRateLimitMax: number;
  readonly authRateLimitWindowSeconds: number;
  readonly writeRateLimitMax: number;
  readonly writeRateLimitWindowSeconds: number;
  readonly imageRateLimitMax: number;
  readonly imageRateLimitWindowSeconds: number;
  readonly maxActiveImageAnalysesPerAccount: number;
  readonly temporaryMediaMaxBytesPerAccount: number;
}

type Environment = Readonly<Record<string, string | undefined>>;
type SecretReader = (path: string) => string;

const runtimeModes = new Set<RuntimeMode>(["development", "test", "production"]);

function rejectPublicExamplePlaceholder(name: string, value: string): string {
  if (value.toLowerCase().includes("replace-with-")) {
    throw new Error(`${name} still contains the public example placeholder`);
  }
  return value;
}

function parseMode(value: string | undefined): RuntimeMode {
  const mode = value ?? "development";
  if (!runtimeModes.has(mode as RuntimeMode)) {
    throw new Error(`NODE_ENV must be development, test, or production; received ${mode}`);
  }
  return mode as RuntimeMode;
}

function parseInteger(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseBoolean(name: string, value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new Error(`${name} must be true or false`);
}

function loadDatabaseUrl(environment: Environment, reader: SecretReader): string {
  const hasUrl = environment.DATABASE_URL !== undefined || environment.DATABASE_URL_FILE !== undefined;
  const componentNames = [
    "DATABASE_HOST",
    "DATABASE_PORT",
    "DATABASE_NAME",
    "DATABASE_USER",
    "DATABASE_PASSWORD",
    "DATABASE_PASSWORD_FILE",
  ] as const;
  const hasComponents = componentNames.some((name) => environment[name] !== undefined);
  if (hasUrl && hasComponents) {
    throw new Error("DATABASE_URL cannot be combined with database component settings");
  }
  if (hasUrl) {
    return readSecretValue("DATABASE_URL", environment, reader);
  }

  const host = environment.DATABASE_HOST ?? "postgres";
  const port = parseInteger("DATABASE_PORT", environment.DATABASE_PORT, 5432);
  const database = environment.DATABASE_NAME ?? "exercise";
  const user = environment.DATABASE_USER ?? "exercise";
  const password = readSecretValue("DATABASE_PASSWORD", environment, reader);
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(database)}`;
}

export function readSecretValue(
  name: string,
  environment: Environment,
  reader: SecretReader,
): string {
  const filePath = environment[`${name}_FILE`];
  const directValue = environment[name];

  if (filePath !== undefined && directValue !== undefined) {
    throw new Error(`${name} and ${name}_FILE cannot both be set`);
  }

  const value = filePath === undefined ? directValue : reader(filePath).trim();
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} or ${name}_FILE is required`);
  }
  return rejectPublicExamplePlaceholder(name, value);
}

function readOptionalSecretValue(
  name: string,
  environment: Environment,
  reader: SecretReader,
): string | null {
  const filePath = environment[`${name}_FILE`];
  const directValue = environment[name];
  if (filePath !== undefined && directValue !== undefined) {
    throw new Error(`${name} and ${name}_FILE cannot both be set`);
  }
  if (filePath === undefined && directValue === undefined) {
    return null;
  }
  const value = filePath === undefined ? directValue : reader(filePath).trim();
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} cannot be empty when configured`);
  }
  return rejectPublicExamplePlaceholder(name, value);
}

function optionalDirectory(
  name: string,
  value: string | undefined,
  requireAbsolute: boolean,
): string | null {
  const cleaned = value?.trim();
  if (cleaned === undefined || cleaned.length === 0) return null;
  if (requireAbsolute && !isAbsolute(cleaned)) {
    throw new Error(`${name} must be an absolute path in production`);
  }
  return resolve(cleaned);
}

export function loadConfig(
  environment: Environment = process.env,
  secretReader: SecretReader = (path) => readFileSync(path, "utf8"),
): AppConfig {
  const mode = parseMode(environment.NODE_ENV);
  const sessionSecret = readSecretValue("SESSION_SECRET", environment, secretReader);
  if (sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters");
  }

  const workerHeartbeatIntervalSeconds = parseInteger(
    "WORKER_HEARTBEAT_INTERVAL_SECONDS",
    environment.WORKER_HEARTBEAT_INTERVAL_SECONDS,
    15,
  );
  const workerHeartbeatStaleSeconds = parseInteger(
    "WORKER_HEARTBEAT_STALE_SECONDS",
    environment.WORKER_HEARTBEAT_STALE_SECONDS,
    45,
  );
  if (workerHeartbeatStaleSeconds <= workerHeartbeatIntervalSeconds) {
    throw new Error("WORKER_HEARTBEAT_STALE_SECONDS must exceed the heartbeat interval");
  }

  return {
    mode,
    host: environment.HOST ?? "127.0.0.1",
    port: parseInteger("PORT", environment.PORT, 3000),
    logLevel: environment.LOG_LEVEL ?? (mode === "test" ? "silent" : "info"),
    databaseUrl: loadDatabaseUrl(environment, secretReader),
    sessionSecret,
    sessionTtlHours: parseInteger("SESSION_TTL_HOURS", environment.SESSION_TTL_HOURS, 168),
    cookieSecure: parseBoolean("COOKIE_SECURE", environment.COOKIE_SECURE, mode === "production"),
    workerHeartbeatIntervalSeconds,
    workerHeartbeatStaleSeconds,
    temporaryMediaRoot: resolve(environment.TEMP_MEDIA_ROOT ?? ".runtime/media"),
    exerciseMediaRoot: optionalDirectory(
      "EXERCISE_MEDIA_ROOT",
      environment.EXERCISE_MEDIA_ROOT
        ?? (mode === "development" ? ".runtime/exercise-catalog/source" : undefined),
      mode === "production",
    ),
    webDistDirectory: resolve(environment.WEB_DIST_DIR ?? "apps/web/dist"),
    deepseekApiKey: readOptionalSecretValue("DEEPSEEK_API_KEY", environment, secretReader),
    deepseekBaseUrl: environment.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
    deepseekVisionModel:
      environment.DEEPSEEK_VISION_MODEL ?? "deepseek-v4-flash-vision-exp",
    deepseekTimeoutMs: parseInteger(
      "DEEPSEEK_TIMEOUT_MS",
      environment.DEEPSEEK_TIMEOUT_MS,
      120_000,
    ),
    imageUploadMaxBytes: parseInteger(
      "IMAGE_UPLOAD_MAX_BYTES",
      environment.IMAGE_UPLOAD_MAX_BYTES,
      8 * 1024 * 1024,
    ),
    exportMaxBytes: parseInteger("EXPORT_MAX_BYTES", environment.EXPORT_MAX_BYTES, 64 * 1024 * 1024),
    exportRetentionHours: parseInteger("EXPORT_RETENTION_HOURS", environment.EXPORT_RETENTION_HOURS, 168),
    mediaCleanupIntervalSeconds: parseInteger("MEDIA_CLEANUP_INTERVAL_SECONDS", environment.MEDIA_CLEANUP_INTERVAL_SECONDS, 3600),
    maxAccounts: parseInteger("MAX_ACCOUNTS", environment.MAX_ACCOUNTS, 10),
    authRateLimitMax: parseInteger("AUTH_RATE_LIMIT_MAX", environment.AUTH_RATE_LIMIT_MAX, 30),
    authRateLimitWindowSeconds: parseInteger("AUTH_RATE_LIMIT_WINDOW_SECONDS", environment.AUTH_RATE_LIMIT_WINDOW_SECONDS, 300),
    writeRateLimitMax: parseInteger("WRITE_RATE_LIMIT_MAX", environment.WRITE_RATE_LIMIT_MAX, 240),
    writeRateLimitWindowSeconds: parseInteger("WRITE_RATE_LIMIT_WINDOW_SECONDS", environment.WRITE_RATE_LIMIT_WINDOW_SECONDS, 60),
    imageRateLimitMax: parseInteger("IMAGE_RATE_LIMIT_MAX", environment.IMAGE_RATE_LIMIT_MAX, 20),
    imageRateLimitWindowSeconds: parseInteger("IMAGE_RATE_LIMIT_WINDOW_SECONDS", environment.IMAGE_RATE_LIMIT_WINDOW_SECONDS, 3600),
    maxActiveImageAnalysesPerAccount: parseInteger("MAX_ACTIVE_IMAGE_ANALYSES_PER_ACCOUNT", environment.MAX_ACTIVE_IMAGE_ANALYSES_PER_ACCOUNT, 3),
    temporaryMediaMaxBytesPerAccount: parseInteger("TEMP_MEDIA_MAX_BYTES_PER_ACCOUNT", environment.TEMP_MEDIA_MAX_BYTES_PER_ACCOUNT, 256 * 1024 * 1024),
  };
}
