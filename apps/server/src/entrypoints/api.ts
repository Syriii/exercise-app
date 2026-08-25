import { buildApp } from "../app.js";
import { loadConfig } from "../config/environment.js";
import { createDatabase } from "../db/database.js";
import { PostgresIdentityRepository } from "../modules/identity/postgres-repository.js";
import { IdentityService } from "../modules/identity/service.js";

const config = loadConfig();
const database = createDatabase(config.databaseUrl);
const identityService = new IdentityService({
  repository: new PostgresIdentityRepository(database.database),
  sessionSecret: config.sessionSecret,
  sessionTtlHours: config.sessionTtlHours,
});
const app = await buildApp({
  config,
  checkDatabase: database.check,
  identityService,
});

async function shutDown(signal: string): Promise<void> {
  app.log.info({ signal }, "shutting down");
  await app.close();
  await database.close();
  process.exitCode = 0;
}

process.once("SIGINT", () => void shutDown("SIGINT"));
process.once("SIGTERM", () => void shutDown("SIGTERM"));

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.fatal({ err: error }, "server failed to start");
  await database.close();
  process.exitCode = 1;
}
