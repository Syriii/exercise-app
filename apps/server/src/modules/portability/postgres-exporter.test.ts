import { describe, expect, it } from "vitest";

import { directAccountTables } from "../../security/data-access-policy.js";
import { userExportRootTables } from "./postgres-exporter.js";

describe("PostgresUserDataExporter", () => {
  it("exports every directly account-owned product table", () => {
    const missing = directAccountTables.filter((table) => !userExportRootTables.includes(table));
    expect(missing).toEqual([]);
  });
});
