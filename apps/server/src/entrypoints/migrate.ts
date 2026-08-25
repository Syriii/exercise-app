import { resolve } from "node:path";

import { migrate } from "drizzle-orm/node-postgres/migrator";

import { loadConfig } from "../config/environment.js";
import { createDatabase } from "../db/database.js";

const config = loadConfig();
const database = createDatabase(config.databaseUrl);

try {
  await migrate(database.database, {
    migrationsFolder: resolve("apps/server/drizzle"),
  });
} finally {
  await database.close();
}
