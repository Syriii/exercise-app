import { resolve } from "node:path";

import { buildApp } from "../app.js";
import { MemoryImageAnalysisRepository } from "../modules/image-analysis/memory-repository.js";
import {
  FixedImageAnalyzer,
  ImageAnalysisService,
  mealImageQueue,
  mealImageQueueDefinition,
} from "../modules/image-analysis/service.js";
import { MemoryIdentityRepository } from "../modules/identity/memory-repository.js";
import { hashPassword } from "../modules/identity/passwords.js";
import { IdentityService } from "../modules/identity/service.js";
import { MemoryTemporaryMediaStore } from "../modules/media/memory-temporary-media-store.js";
import { MemoryNutritionRepository } from "../modules/nutrition/memory-repository.js";
import { NutritionService } from "../modules/nutrition/service.js";
import { MemoryReminderRepository } from "../modules/reminders/memory-repository.js";
import { ReminderService } from "../modules/reminders/service.js";
import { MemoryTaskQueue } from "../modules/tasks/memory-task-queue.js";
import { MemoryPlanningRepository } from "../modules/planning/memory-repository.js";
import { PlanningService } from "../modules/planning/service.js";
import { MemoryPortabilityRepository } from "../modules/portability/memory-repository.js";
import { FixedUserDataExporter, PortabilityService, portabilityQueue, portabilityQueueDefinition } from "../modules/portability/service.js";
import { MemoryTrainingRepository } from "../modules/training/memory-repository.js";
import { TrainingService } from "../modules/training/service.js";
import { MemoryTrainingSuggestionRepository } from "../modules/training-suggestions/memory-repository.js";
import { TrainingSuggestionService } from "../modules/training-suggestions/service.js";
import { createTestConfig } from "./test-config.js";

const port = Number.parseInt(process.env.E2E_PORT ?? "4174", 10);
const config = createTestConfig({
  port,
  webDistDirectory: resolve(import.meta.dirname, "../../../web/dist"),
  exerciseMediaRoot: process.env.EXERCISE_MEDIA_ROOT === undefined
    ? null
    : resolve(process.env.EXERCISE_MEDIA_ROOT),
});
const identityRepository = new MemoryIdentityRepository();
const identityService = new IdentityService({
  repository: identityRepository,
  sessionSecret: config.sessionSecret,
  sessionTtlHours: config.sessionTtlHours,
  maxAccounts: config.maxAccounts,
});
const planningService = new PlanningService(new MemoryPlanningRepository());
const trainingService = new TrainingService({ repository: new MemoryTrainingRepository(), planningService, exerciseMediaRoot: config.exerciseMediaRoot });
const trainingSuggestionService = new TrainingSuggestionService({ repository: new MemoryTrainingSuggestionRepository(), planningService, trainingService });
const nutritionService = new NutritionService(new MemoryNutritionRepository());
const queue = new MemoryTaskQueue();
const mediaStore = new MemoryTemporaryMediaStore();
const imageAnalysisService = new ImageAnalysisService({
  repository: new MemoryImageAnalysisRepository(),
  mediaStore,
  queue,
  analyzer: new FixedImageAnalyzer({
    title: "食堂鸡腿套餐",
    observedFoods: [
      { label: "米饭", estimatedPortion: "约 200 克", note: null },
      { label: "鸡腿", estimatedPortion: "1 个", note: "烹调油无法从照片准确判断" },
    ],
    energyKcal: 620,
    proteinGrams: 32,
    carbohydrateGrams: 76,
    fatGrams: 20,
    confidence: "medium",
    assumptions: ["按常见食堂份量估算"],
    uncertaintyNote: "照片无法确认烹调油和实际剩余量，请在采用前修正。",
  }),
  nutritionService,
  maxUploadBytes: config.imageUploadMaxBytes,
  maxActiveAnalysesPerAccount: config.maxActiveImageAnalysesPerAccount,
  temporaryMediaMaxBytesPerAccount: config.temporaryMediaMaxBytesPerAccount,
});
const portabilityService = new PortabilityService({ repository: new MemoryPortabilityRepository(), exporter: new FixedUserDataExporter({ schemaVersion: "exercise-app-user-export-v1", account: { source: "e2e" }, data: { records: [] }, lifecycle: { includesOriginalPhotos: false, excludesCredentialsAndSessions: true, temporaryMedia: [] } }), mediaStore, queue, identityService, exportMaxBytes: config.exportMaxBytes, exportRetentionHours: config.exportRetentionHours });
const reminderService = new ReminderService({
  repository: new MemoryReminderRepository(),
  trainingService,
  nutritionService,
  planningService,
});
await identityService.initializeAdmin("administrator test password");
for (const username of ["desktop_admin", "mobile_admin"]) {
  await identityRepository.createAccount(
    {
      username,
      normalizedUsername: username,
      passwordHash: await hashPassword("operations test password"),
      role: "admin",
      passwordChangeRequired: false,
    },
    { bypassRegistration: true },
  );
}

await queue.start();
await queue.ensureQueue(mealImageQueueDefinition);
await queue.work(mealImageQueue, (analysisId) => imageAnalysisService.process(analysisId));
await queue.ensureQueue(portabilityQueueDefinition);
await queue.work(portabilityQueue, (taskId) => portabilityService.process(taskId));

const app = await buildApp({
  config,
  checkDatabase: async () => undefined,
  identityService,
  imageAnalysisService,
  nutritionService,
  planningService,
  portabilityService,
  reminderService,
  trainingService,
  trainingSuggestionService,
  operationsHealthReader: {
    getHealth: async () => ({
      checkedAt: new Date().toISOString(),
      api: { status: "healthy", lastSeenAt: new Date().toISOString() },
      database: { status: "healthy", lastSeenAt: new Date().toISOString() },
      worker: { status: "unknown", lastSeenAt: null },
    }),
  },
  operationsSummaryReader: {
    getSummary: async () => ({ checkedAt: new Date().toISOString(), model: { configured: true, model: "test-vision-model" }, tasks: { pending: 0, running: 0, succeeded: 0, failed: 0, cancelled: 0 }, media: { available: 0, deletion_pending: 0, deleted: 0, missing: 0, expiredAvailable: 0 }, disk: { availableBytes: 1024 * 1024 * 1024 }, backup: { lastSucceededAt: null, lastFailedAt: null }, restoreVerification: { lastSucceededAt: null, lastFailedAt: null } }),
  },
});

await app.listen({ host: "127.0.0.1", port });

async function shutDown(): Promise<void> {
  await app.close();
  await queue.stop();
}

process.once("SIGINT", () => void shutDown());
process.once("SIGTERM", () => void shutDown());
