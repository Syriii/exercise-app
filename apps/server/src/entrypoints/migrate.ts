import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { migrate } from "drizzle-orm/node-postgres/migrator";

import { loadConfig, readSecretValue } from "../config/environment.js";
import { createDatabase } from "../db/database.js";
import { ensureApiDatabaseRole, grantApiDatabaseRole } from "../db/runtime-role.js";

const config = loadConfig();
const database = createDatabase(config.databaseUrl);

try {
  const apiDatabasePassword = readSecretValue("API_DATABASE_PASSWORD", process.env, (path) =>
    readFileSync(path, "utf8"),
  );
  await ensureApiDatabaseRole(database.pool, apiDatabasePassword);
  await migrate(database.database, {
    migrationsFolder: resolve("apps/server/drizzle"),
  });
  await grantApiDatabaseRole(database.pool);
} finally {
  await database.close();
}
