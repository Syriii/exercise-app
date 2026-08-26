import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { migrate } from "drizzle-orm/node-postgres/migrator";

import { loadConfig, readSecretValue } from "../config/environment.js";
import { createDatabase } from "../db/database.js";
import { ensureApiDatabaseRole, grantApiDatabaseRole } from "../db/runtime-role.js";
import { PostgresIdentityRepository } from "../modules/identity/postgres-repository.js";
import { IdentityService } from "../modules/identity/service.js";
import { migratePgBoss } from "../modules/tasks/pgboss-task-queue.js";

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
  await migratePgBoss(config.databaseUrl);
  await grantApiDatabaseRole(database.pool);
  const initialAdminPassword = readSecretValue("ADMIN_INITIAL_PASSWORD", process.env, (path) =>
    readFileSync(path, "utf8"),
  );
  const identity = new IdentityService({
    repository: new PostgresIdentityRepository(database.database),
    sessionSecret: config.sessionSecret,
    sessionTtlHours: config.sessionTtlHours,
  });
  const admin = await identity.initializeAdmin(initialAdminPassword);
  process.stdout.write(
    `Database and queue migrations completed; administrator ${admin.username} is ready.\n`,
  );
} finally {
  await database.close();
}
