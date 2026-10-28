import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool, PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";

import { installUserContext } from "../../db/database.js";
import { schema } from "../../db/schema/index.js";
import { DatabaseUserContext } from "../../db/user-context.js";
import { directAccountTables } from "../../security/data-access-policy.js";
import { PostgresUserDataExporter, userExportRootTables } from "./postgres-exporter.js";

const owner = "00000000-0000-4000-8000-000000000001";
const exportedAt = new Date("2026-10-28T04:00:00.000Z");

function createExporterDouble(options: { missingAccount?: boolean; failTable?: string } = {}) {
  const release = vi.fn();
  const rawQuery = vi.fn(async (query: string | { text: string; rowMode?: string }, _values?: unknown[]) => {
    const text = typeof query === "string" ? query : query.text;
    if (options.failTable && text.includes(`from "${options.failTable}" record`)) throw new Error("export_query_failed");
    if (typeof query !== "string" && query.rowMode === "array") {
      if (text.includes('"photo_analysis_automatic"')) return { rows: [[true, null]] };
      return { rows: options.missingAccount ? [] : [[owner, "export-user", "user", "active", false, exportedAt.toISOString(), exportedAt.toISOString()]] };
    }
    return { rows: text.startsWith("select (to_jsonb") || text.startsWith("select to_jsonb") ? [{ value: { snapshot: "same-client" } }] : [] };
  });
  const client = { query: rawQuery, release } as unknown as PoolClient;
  // Keep the real Drizzle pool transaction path, without creating a network connection.
  class ExportPool {
    public connect = vi.fn(async () => client);
    public query = vi.fn(async () => { throw new Error("export_query_outside_transaction"); });
  }
  const pool = new ExportPool();
  const connect = pool.connect;
  const poolQuery = pool.query;
  const context = new DatabaseUserContext();
  installUserContext(pool as unknown as Pool, context);
  const exporter = new PostgresUserDataExporter(drizzle(pool as unknown as Pool, { schema }));
  const statements = () => rawQuery.mock.calls.map(([query]) => typeof query === "string" ? query : query.text);
  return { context, exporter, connect, poolQuery, rawQuery, release, statements };
}

describe("PostgresUserDataExporter", () => {
  it("exports every directly account-owned product table", () => {
    const missing = directAccountTables.filter((table) => !userExportRootTables.includes(table));
    expect(missing).toEqual([]);
  });

  it("uses one read-only repeatable-read client with account context before every export query", async () => {
    const values = createExporterDouble();
    const result = await values.context.run(owner, () => values.exporter.exportUserData(owner, exportedAt));

    expect(values.statements().slice(0, 2)).toEqual([
      "begin isolation level repeatable read read only",
      "select set_config('exercise.user_id', $1, true)",
    ]);
    expect(values.rawQuery).toHaveBeenNthCalledWith(2, "select set_config('exercise.user_id', $1, true)", [owner]);
    expect(values.statements().filter(text => text.startsWith("begin"))).toHaveLength(1);
    expect(values.statements().at(-1)).toBe("commit");
    expect(values.connect).toHaveBeenCalledTimes(1);
    expect(values.poolQuery).not.toHaveBeenCalled();
    expect(values.release).toHaveBeenCalledTimes(1);
    expect(result.account).toMatchObject({ id: owner, username: "export-user" });
    expect(result.data.photo_analysis_settings).toEqual([{ automatic: true, consentAt: null }]);
    for (const table of userExportRootTables) expect(result.data[table]).toEqual([{ snapshot: "same-client" }]);
    expect(result.data.meal_image_analysis_attempts).toEqual([{ snapshot: "same-client" }]);
    expect(result.lifecycle.temporaryMedia).toEqual([{ snapshot: "same-client" }]);
  });

  it("rolls back and releases the snapshot when the account is unavailable", async () => {
    const values = createExporterDouble({ missingAccount: true });
    await expect(values.context.run(owner, () => values.exporter.exportUserData(owner, exportedAt))).rejects.toThrow("export_account_not_found");
    expect(values.statements()).toHaveLength(4);
    expect(values.statements().at(-1)).toBe("rollback");
    expect(values.release).toHaveBeenCalledTimes(1);
  });

  it("rejects the whole export and releases its snapshot after a later table read fails", async () => {
    const values = createExporterDouble({ failTable: "meals" });
    await expect(values.context.run(owner, () => values.exporter.exportUserData(owner, exportedAt))).rejects.toThrow();
    expect(values.statements().at(-1)).toBe("rollback");
    expect(values.statements()).not.toContain("commit");
    expect(values.statements().some(text => text.includes("from temporary_media record"))).toBe(false);
    expect(values.release).toHaveBeenCalledTimes(1);
  });
});
