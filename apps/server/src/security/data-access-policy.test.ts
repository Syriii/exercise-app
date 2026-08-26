import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { schema } from "../db/schema/index.js";
import { directAccountTables, inheritedAccountTables, internalTables, rlsTables } from "./data-access-policy.js";

describe("database access classification", () => {
  it("classifies every table exactly once", () => {
    const classified = [...rlsTables, ...Object.keys(internalTables)];
    const actual = Object.values(schema).map((table) => getTableName(table));

    expect(new Set(classified).size).toBe(classified.length);
    expect(classified.toSorted()).toEqual(actual.toSorted());
  });

  it("keeps every account-owned root and child table in the RLS migration", async () => {
    const migration = (await Promise.all([
      readFile(resolve(import.meta.dirname, "../../drizzle/0013_api_rls.sql"), "utf8"),
      readFile(resolve(import.meta.dirname, "../../drizzle/0014_reflective_mimic.sql"), "utf8"),
      readFile(resolve(import.meta.dirname, "../../drizzle/0018_wakeful_carmella_unuscione.sql"), "utf8"),
    ])).join("\n");
    for (const table of [...directAccountTables, ...inheritedAccountTables]) {
      expect(migration).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      expect(migration).toContain(`ON "${table}" TO "exercise_api"`);
    }
    for (const table of Object.keys(internalTables)) {
      expect(migration).not.toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
    }
  });

  it("keeps the deployment smoke-check RLS count aligned with the access policy", async () => {
    const smokeCheck = await readFile(
      resolve(import.meta.dirname, "../../../../deployment/scripts/smoke-check.sh"),
      "utf8",
    );
    expect(smokeCheck).toContain(`[ "$rls_tables" = "${rlsTables.length}" ]`);
  });
});
