import { buildApp } from "../app.js";
import { loadConfig } from "../config/environment.js";
import { createDatabase } from "../db/database.js";
import { DatabaseUserContext } from "../db/user-context.js";
import { DeepSeekImageAnalyzer } from "../modules/image-analysis/deepseek-analyzer.js";
import { PostgresImageAnalysisRepository } from "../modules/image-analysis/postgres-repository.js";
import {
  ImageAnalysisService,
  mealImageQueueDefinition,
} from "../modules/image-analysis/service.js";
import { PostgresIdentityRepository } from "../modules/identity/postgres-repository.js";
import { IdentityService } from "../modules/identity/service.js";
import { FileSystemTemporaryMediaStore } from "../modules/media/filesystem-temporary-media-store.js";
import { PostgresOperationsService } from "../modules/operations/service.js";
import { PostgresNutritionRepository } from "../modules/nutrition/postgres-repository.js";
import { NutritionService } from "../modules/nutrition/service.js";
import { PostgresPlanningRepository } from "../modules/planning/postgres-repository.js";
import { PlanningService } from "../modules/planning/service.js";
import { PostgresUserDataExporter } from "../modules/portability/postgres-exporter.js";
import { PostgresPortabilityRepository } from "../modules/portability/postgres-repository.js";
import { PortabilityService, portabilityQueueDefinition } from "../modules/portability/service.js";
import { PostgresReminderRepository } from "../modules/reminders/postgres-repository.js";
import { ReminderService } from "../modules/reminders/service.js";
import { PgBossTaskQueue } from "../modules/tasks/pgboss-task-queue.js";
import { PostgresTrainingRepository } from "../modules/training/postgres-repository.js";
import { TrainingService } from "../modules/training/service.js";
import { PostgresTrainingSuggestionRepository } from "../modules/training-suggestions/postgres-repository.js";
import { TrainingSuggestionService } from "../modules/training-suggestions/service.js";

const config = loadConfig();
const databaseUserContext = new DatabaseUserContext();
const database = createDatabase(config.databaseUrl, databaseUserContext);
const queue = new PgBossTaskQueue({
  databaseUrl: config.databaseUrl,
  applicationName: "exercise-app-api",
});
const mediaStore = new FileSystemTemporaryMediaStore(config.temporaryMediaRoot);
const identityService = new IdentityService({
  repository: new PostgresIdentityRepository(database.database),
  sessionSecret: config.sessionSecret,
  sessionTtlHours: config.sessionTtlHours,
  maxAccounts: config.maxAccounts,
});
const operationsService = new PostgresOperationsService({
  database: database.database,
  checkDatabase: database.check,
  workerStaleAfterSeconds: config.workerHeartbeatStaleSeconds,
  modelConfigured: config.deepseekApiKey !== null,
  modelName: config.deepseekVisionModel,
  mediaRoot: config.temporaryMediaRoot,
});
const planningService = new PlanningService(new PostgresPlanningRepository(database.database));
const nutritionRepository = new PostgresNutritionRepository(database.database);
const nutritionService = new NutritionService(nutritionRepository);
const trainingService = new TrainingService({
  repository: new PostgresTrainingRepository(database.database),
  planningService,
});
const trainingSuggestionService = new TrainingSuggestionService({
  repository: new PostgresTrainingSuggestionRepository(database.database),
  planningService,
  trainingService,
});
const reminderService = new ReminderService({
  repository: new PostgresReminderRepository(database.database),
  trainingService,
  nutritionService,
  planningService,
});
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
const portabilityService = new PortabilityService({
  repository: new PostgresPortabilityRepository(database.database),
  exporter: new PostgresUserDataExporter(database.database),
  mediaStore,
  queue,
  identityService,
  exportMaxBytes: config.exportMaxBytes,
  exportRetentionHours: config.exportRetentionHours,
});

await queue.start();
await queue.ensureQueue(mealImageQueueDefinition);
await queue.ensureQueue(portabilityQueueDefinition);
const app = await buildApp({
  config,
  checkDatabase: database.check,
  identityService,
  imageAnalysisService,
  nutritionService,
  operationsHealthReader: operationsService,
  operationsSummaryReader: operationsService,
  planningService,
  portabilityService,
  reminderService,
  trainingService,
  trainingSuggestionService,
  databaseUserContext,
});

async function shutDown(signal: string): Promise<void> {
  app.log.info({ signal }, "shutting down");
  await app.close();
  await queue.stop();
  await database.close();
  process.exitCode = 0;
}

process.once("SIGINT", () => void shutDown("SIGINT"));
process.once("SIGTERM", () => void shutDown("SIGTERM"));

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.fatal({ err: error }, "server failed to start");
  await queue.stop();
  await database.close();
  process.exitCode = 1;
}
