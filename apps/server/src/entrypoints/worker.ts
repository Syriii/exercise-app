import { loadConfig } from "../config/environment.js";
import { createDatabase } from "../db/database.js";
import { PgBossTaskQueue } from "../modules/tasks/pgboss-task-queue.js";

const config = loadConfig();
const database = createDatabase(config.databaseUrl);
const queue = new PgBossTaskQueue({ databaseUrl: config.databaseUrl });

await database.check();
await queue.start();
process.stdout.write("Exercise App worker database and task queue are ready.\n");

async function shutDown(): Promise<void> {
  await queue.stop();
  await database.close();
  process.exitCode = 0;
}

process.once("SIGINT", () => void shutDown());
process.once("SIGTERM", () => void shutDown());
