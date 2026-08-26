import { describe, expect, it } from "vitest";

import { loadTestDatabaseUrl, validateTestDatabaseUrl } from "./test-database-url.js";

describe("validateTestDatabaseUrl", () => {
  it("accepts only explicit PostgreSQL test databases", () => {
    expect(
      validateTestDatabaseUrl("postgresql://exercise:secret@127.0.0.1/exercise_test"),
    ).toContain("exercise_test");

    expect(() => validateTestDatabaseUrl(undefined)).toThrow(/required/);
    expect(() =>
      validateTestDatabaseUrl("postgresql://exercise:secret@127.0.0.1/exercise"),
    ).toThrow(/ends with _test/);
    expect(() => validateTestDatabaseUrl("https://127.0.0.1/exercise_test")).toThrow(
      /PostgreSQL protocol/,
    );
  });

  it("builds a safe URL from container components and a password file", () => {
    const url = loadTestDatabaseUrl(
      {
        TEST_DATABASE_HOST: "postgres",
        TEST_DATABASE_NAME: "exercise_test",
        TEST_DATABASE_USER: "exercise",
        TEST_DATABASE_PASSWORD_FILE: "/run/secrets/database_password",
      },
      () => "a p@ssword\n",
    );

    expect(url).toBe(
      "postgresql://exercise:a%20p%40ssword@postgres:5432/exercise_test",
    );
  });

  it("rejects ambiguous component configuration", () => {
    expect(() =>
      loadTestDatabaseUrl({
        TEST_DATABASE_URL: "postgresql://exercise:secret@postgres/exercise_test",
        TEST_DATABASE_NAME: "exercise_test",
      }),
    ).toThrow(/cannot be combined/);
    expect(() =>
      loadTestDatabaseUrl({
        TEST_DATABASE_NAME: "exercise_test",
        TEST_DATABASE_USER: "exercise",
        TEST_DATABASE_PASSWORD: "direct",
        TEST_DATABASE_PASSWORD_FILE: "/run/secrets/database_password",
      }),
    ).toThrow(/exactly one/);
  });
});
