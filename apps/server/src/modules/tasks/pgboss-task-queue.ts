import { sql } from "drizzle-orm";
import { PgBoss, fromDrizzle, type DrizzleTransactionLike } from "pg-boss";

import type { QueueDefinition, TaskQueue } from "./task-queue.js";

interface QueueLogger {
  error(details: Readonly<Record<string, unknown>>, message: string): void;
  warn(details: Readonly<Record<string, unknown>>, message: string): void;
}

interface PgBossTaskQueueOptions {
  readonly databaseUrl: string;
  readonly schema?: string;
  readonly applicationName?: string;
  readonly logger?: QueueLogger;
}

interface TaskJobData {
  readonly taskId: string;
}

export class PgBossTaskQueue implements TaskQueue {
  readonly #boss: PgBoss;

  public constructor(options: PgBossTaskQueueOptions) {
    this.#boss = new PgBoss({
      connectionString: options.databaseUrl,
      schema: options.schema ?? "pgboss",
      application_name: options.applicationName ?? "exercise-app-worker",
      createSchema: false,
      migrate: false,
      supervise: true,
    });

    this.#boss.on("error", (error) => {
      options.logger?.error({ error }, "pg-boss error");
    });
    this.#boss.on("warning", (warning) => {
      options.logger?.warn({ warning }, "pg-boss warning");
    });
  }

  public async start(): Promise<void> {
    await this.#boss.start();
  }

  public async stop(): Promise<void> {
    await this.#boss.stop({ close: true, graceful: true, timeout: 30_000 });
  }

  public async ensureQueue(definition: QueueDefinition): Promise<void> {
    const existing = await this.#boss.getQueue(definition.name);
    const options = {
      retryLimit: definition.retryLimit,
      retryDelay: definition.retryDelaySeconds,
      retryBackoff: definition.retryBackoff,
      expireInSeconds: definition.expireInSeconds,
      heartbeatSeconds: definition.heartbeatSeconds,
      deleteAfterSeconds: definition.deleteAfterSeconds,
    };
    if (existing === null) {
      await this.#boss.createQueue(definition.name, options);
      return;
    }
    await this.#boss.updateQueue(definition.name, options);
  }

  public async enqueue(queueName: string, taskId: string): Promise<string> {
    const jobId = await this.#boss.send(queueName, { taskId });
    if (jobId === null) {
      throw new Error(`pg-boss rejected task ${taskId} for queue ${queueName}`);
    }
    return jobId;
  }

  public async enqueueInTransaction(
    queueName: string,
    taskId: string,
    transaction: DrizzleTransactionLike,
  ): Promise<string> {
    const jobId = await this.#boss.send(queueName, { taskId }, {
      db: fromDrizzle(transaction, sql),
    });
    if (jobId === null) {
      throw new Error(`pg-boss rejected transactional task ${taskId} for queue ${queueName}`);
    }
    return jobId;
  }

  public async work(
    queueName: string,
    handler: (taskId: string) => Promise<void>,
    options: { readonly concurrency?: number } = {},
  ): Promise<void> {
    await this.#boss.work<TaskJobData>(
      queueName,
      {
        batchSize: 1,
        localConcurrency: options.concurrency ?? 1,
      },
      async (jobs) => {
        for (const job of jobs) {
          const taskId = job.data?.taskId;
          if (typeof taskId !== "string" || taskId.length === 0) {
            throw new Error(`queue ${queueName} received a job without a taskId`);
          }
          await handler(taskId);
        }
      },
    );
  }
}

export async function migratePgBoss(databaseUrl: string, schema = "pgboss"): Promise<void> {
  const boss = new PgBoss({
    connectionString: databaseUrl,
    schema,
    application_name: "exercise-app-queue-migration",
    createSchema: true,
    migrate: true,
    supervise: false,
    schedule: false,
  });
  boss.on("error", () => undefined);
  await boss.start();
  await boss.stop({ close: true, graceful: true, timeout: 30_000 });
}
