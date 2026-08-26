import { PgBossTaskQueue } from "../modules/tasks/pgboss-task-queue.js";
import { loadTestDatabaseUrl } from "./test-database-url.js";

const queueName = process.env.TEST_QUEUE_NAME;
if (queueName === undefined || queueName.length === 0) {
  throw new Error("TEST_QUEUE_NAME is required");
}

const queue = new PgBossTaskQueue({
  databaseUrl: loadTestDatabaseUrl(),
  applicationName: "exercise-app-crash-test-worker",
  superviseIntervalSeconds: 1,
});
await queue.start();
await queue.work(queueName, async (taskId) => {
  process.send?.({ type: "started", taskId });
  await new Promise<never>(() => undefined);
});
