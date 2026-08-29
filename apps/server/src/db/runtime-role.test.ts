import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { ensureApiDatabaseRole } from "./runtime-role.js";

function poolWithExistingRole(exists: boolean) {
  const query = vi.fn().mockResolvedValueOnce({ rows: [{ exists }] });
  return { pool: { query } as unknown as Pool, query };
}

describe("API database role setup", () => {
  it("does not rewrite an existing role password during shared-cluster verification", async () => {
    const { pool, query } = poolWithExistingRole(true);

    await ensureApiDatabaseRole(pool, "mounted-production-password", {
      preserveExistingPassword: true,
    });

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toContain("select exists");
  });

  it("still rotates an existing role password during normal setup", async () => {
    const { pool, query } = poolWithExistingRole(true);

    await ensureApiDatabaseRole(pool, "new-production-password");

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1]?.[0]).toContain("alter role exercise_api password");
  });

  it("creates and passwords the role on a fresh test instance", async () => {
    const { pool, query } = poolWithExistingRole(false);

    await ensureApiDatabaseRole(pool, "new-test-role-password", {
      preserveExistingPassword: true,
    });

    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[1]?.[0]).toContain("create role exercise_api");
    expect(query.mock.calls[2]?.[0]).toContain("alter role exercise_api password");
  });
});
