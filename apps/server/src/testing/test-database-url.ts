import { readFileSync } from "node:fs";

type TestEnvironment = Readonly<Record<string, string | undefined>>;
type SecretReader = (path: string) => string;

export function validateTestDatabaseUrl(value: string | undefined): string {
  if (value === undefined || value.length === 0) {
    throw new Error("TEST_DATABASE_URL is required for PostgreSQL integration tests");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("TEST_DATABASE_URL must be a valid PostgreSQL URL");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("TEST_DATABASE_URL must use the PostgreSQL protocol");
  }

  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (!databaseName.endsWith("_test")) {
    throw new Error("integration tests only run against a database whose name ends with _test");
  }
  return value;
}

export function loadTestDatabaseUrl(
  environment: TestEnvironment = process.env,
  secretReader: SecretReader = (path) => readFileSync(path, "utf8"),
): string {
  const directUrl = environment.TEST_DATABASE_URL;
  const componentNames = [
    "TEST_DATABASE_HOST",
    "TEST_DATABASE_PORT",
    "TEST_DATABASE_NAME",
    "TEST_DATABASE_USER",
    "TEST_DATABASE_PASSWORD",
    "TEST_DATABASE_PASSWORD_FILE",
  ] as const;
  if (directUrl !== undefined) {
    if (componentNames.some((name) => environment[name] !== undefined)) {
      throw new Error("TEST_DATABASE_URL cannot be combined with test database components");
    }
    return validateTestDatabaseUrl(directUrl);
  }

  const name = environment.TEST_DATABASE_NAME;
  const user = environment.TEST_DATABASE_USER;
  const passwordFile = environment.TEST_DATABASE_PASSWORD_FILE;
  const directPassword = environment.TEST_DATABASE_PASSWORD;
  if (name === undefined || user === undefined) {
    throw new Error("TEST_DATABASE_NAME and TEST_DATABASE_USER are required");
  }
  if ((passwordFile === undefined) === (directPassword === undefined)) {
    throw new Error(
      "exactly one of TEST_DATABASE_PASSWORD or TEST_DATABASE_PASSWORD_FILE is required",
    );
  }

  const password =
    passwordFile === undefined ? directPassword : secretReader(passwordFile).trim();
  if (password === undefined || password.length === 0) {
    throw new Error("test database password cannot be empty");
  }
  const host = environment.TEST_DATABASE_HOST ?? "postgres";
  const port = environment.TEST_DATABASE_PORT ?? "5432";
  if (!/^\d+$/.test(port)) {
    throw new Error("TEST_DATABASE_PORT must be numeric");
  }

  return validateTestDatabaseUrl(
    `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(name)}`,
  );
}
