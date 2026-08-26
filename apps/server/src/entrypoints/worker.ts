import { randomUUID } from "node:crypto";

import { loadConfig } from "../config/environment.js";
import { createDatabase } from "../db/database.js";
import { DeepSeekImageAnalyzer } from "../modules/image-analysis/deepseek-analyzer.js";
import { PostgresImageAnalysisRepository } from "../modules/image-analysis/postgres-repository.js";
import {
  ImageAnalysisService,
  mealImageQueue,
  mealImageQueueDefinition,
} from "../modules/image-analysis/service.js";
import { PostgresIdentityRepository } from "../modules/identity/postgres-repository.js";
import { IdentityService } from "../modules/identity/service.js";
import { FileSystemTemporaryMediaStore } from "../modules/media/filesystem-temporary-media-store.js";
import { PostgresNutritionRepository } from "../modules/nutrition/postgres-repository.js";
import { NutritionService } from "../modules/nutrition/service.js";
import { PostgresOperationsService } from "../modules/operations/service.js";
import { PostgresUserDataExporter } from "../modules/portability/postgres-exporter.js";
import { PostgresPortabilityRepository } from "../modules/portability/postgres-repository.js";
import { PortabilityService, portabilityQueue, portabilityQueueDefinition } from "../modules/portability/service.js";
import { PgBossTaskQueue } from "../modules/tasks/pgboss-task-queue.js";

const config = loadConfig();
const database = createDatabase(config.databaseUrl);
const queue = new PgBossTaskQueue({ databaseUrl: config.databaseUrl });
const identityService = new IdentityService({ repository: new PostgresIdentityRepository(database.database), sessionSecret: config.sessionSecret, sessionTtlHours: config.sessionTtlHours });
const mediaStore = new FileSystemTemporaryMediaStore(config.temporaryMediaRoot);
const nutritionService = new NutritionService(new PostgresNutritionRepository(database.database));
const imageAnalyzer =
  config.deepseekApiKey === null
    ? null
    : new DeepSeekImageAnalyzer({
        apiKey: config.deepseekApiKey,
        baseUrl: config.deepseekBaseUrl,
        model: config.deepseekVisionModel,
        timeoutMs: config.deepseekTimeoutMs,
      });
const imageAnalysisService = new ImageAnalysisService({
  repository: new PostgresImageAnalysisRepository(database.database),
  mediaStore,
  queue,
  analyzer: imageAnalyzer,
  nutritionService,
  maxUploadBytes: config.imageUploadMaxBytes,
  maxActiveAnalysesPerAccount: config.maxActiveImageAnalysesPerAccount,
  temporaryMediaMaxBytesPerAccount: config.temporaryMediaMaxBytesPerAccount,
});
const portabilityService = new PortabilityService({ repository: new PostgresPortabilityRepository(database.database), exporter: new PostgresUserDataExporter(database.database), mediaStore, queue, identityService, exportMaxBytes: config.exportMaxBytes, exportRetentionHours: config.exportRetentionHours });
const operationsService = new PostgresOperationsService({
  database: database.database,
  checkDatabase: database.check,
  workerStaleAfterSeconds: config.workerHeartbeatStaleSeconds,
});
const workerInstanceId = randomUUID();
const workerStartedAt = new Date();
let heartbeatRunning = false;

await database.check();
await queue.start();
await queue.ensureQueue(mealImageQueueDefinition);
await queue.ensureQueue(portabilityQueueDefinition);
if (imageAnalyzer !== null) {
  await queue.work(mealImageQueue, (analysisId) => imageAnalysisService.process(analysisId));
}
await queue.work(portabilityQueue, (taskId) => portabilityService.process(taskId));
await portabilityService.recoverPendingTasks();
await portabilityService.cleanupExpiredMedia();
const mediaCleanupTimer = setInterval(() => void portabilityService.cleanupExpiredMedia().catch((error: unknown) => process.stderr.write(`Temporary media cleanup failed: ${error instanceof Error ? error.message : "unknown error"}\n`)), config.mediaCleanupIntervalSeconds * 1000);
await operationsService.recordWorkerHeartbeat(workerInstanceId, workerStartedAt);
const heartbeatTimer = setInterval(() => {
  if (heartbeatRunning) {
    return;
  }
  heartbeatRunning = true;
  void operationsService
    .recordWorkerHeartbeat(workerInstanceId, workerStartedAt)
    .catch((error: unknown) => {
      process.stderr.write(
        `Worker heartbeat failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
      );
    })
    .finally(() => {
      heartbeatRunning = false;
    });
}, config.workerHeartbeatIntervalSeconds * 1000);
process.stdout.write("Exercise App worker database and task queue are ready.\n");

async function shutDown(): Promise<void> {
  clearInterval(heartbeatTimer);
  clearInterval(mediaCleanupTimer);
  await queue.stop();
  await database.close();
  process.exitCode = 0;
}

process.once("SIGINT", () => void shutDown());
process.once("SIGTERM", () => void shutDown());
