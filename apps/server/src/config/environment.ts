import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
  readonly temporaryMediaRoot: string;
  readonly webDistDirectory: string;
}

type Environment = Readonly<Record<string, string | undefined>>;
type SecretReader = (path: string) => string;

const runtimeModes = new Set<RuntimeMode>(["development", "test", "production"]);

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
  return value;
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

  return {
    mode,
    host: environment.HOST ?? "127.0.0.1",
    port: parseInteger("PORT", environment.PORT, 3000),
    logLevel: environment.LOG_LEVEL ?? (mode === "test" ? "silent" : "info"),
    databaseUrl: loadDatabaseUrl(environment, secretReader),
    sessionSecret,
    sessionTtlHours: parseInteger("SESSION_TTL_HOURS", environment.SESSION_TTL_HOURS, 168),
    cookieSecure: parseBoolean("COOKIE_SECURE", environment.COOKIE_SECURE, mode === "production"),
    temporaryMediaRoot: resolve(environment.TEMP_MEDIA_ROOT ?? ".runtime/media"),
    webDistDirectory: resolve(environment.WEB_DIST_DIR ?? "apps/web/dist"),
  };
}
