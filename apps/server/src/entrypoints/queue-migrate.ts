import { loadConfig } from "../config/environment.js";
import { migratePgBoss } from "../modules/tasks/pgboss-task-queue.js";

const config = loadConfig();
await migratePgBoss(config.databaseUrl);
process.stdout.write("pg-boss schema migration completed.\n");
