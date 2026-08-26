import { buildApp } from "../app.js";
import { MemoryImageAnalysisRepository } from "../modules/image-analysis/memory-repository.js";
import { FixedImageAnalyzer, ImageAnalysisService } from "../modules/image-analysis/service.js";
import { MemoryIdentityRepository } from "../modules/identity/memory-repository.js";
import { IdentityService } from "../modules/identity/service.js";
import { MemoryTemporaryMediaStore } from "../modules/media/memory-temporary-media-store.js";
import { MemoryNutritionRepository } from "../modules/nutrition/memory-repository.js";
import { NutritionService } from "../modules/nutrition/service.js";
import { MemoryPlanningRepository } from "../modules/planning/memory-repository.js";
import { PlanningService } from "../modules/planning/service.js";
import { MemoryTrainingRepository } from "../modules/training/memory-repository.js";
import { TrainingService } from "../modules/training/service.js";
import { MemoryTrainingSuggestionRepository } from "../modules/training-suggestions/memory-repository.js";
import { TrainingSuggestionService } from "../modules/training-suggestions/service.js";
import { MemoryTaskQueue } from "../modules/tasks/memory-task-queue.js";
import { createTestConfig } from "./test-config.js";

export async function buildContractApp() {
  const config = createTestConfig({ webDistDirectory: "/directory-that-does-not-exist" });
  const identityService = new IdentityService({
    repository: new MemoryIdentityRepository(),
    sessionSecret: config.sessionSecret,
    sessionTtlHours: config.sessionTtlHours,
  });
  const nutritionService = new NutritionService(new MemoryNutritionRepository());
  const imageAnalysisService = new ImageAnalysisService({
    repository: new MemoryImageAnalysisRepository(),
    mediaStore: new MemoryTemporaryMediaStore(),
    queue: new MemoryTaskQueue(),
    analyzer: new FixedImageAnalyzer({
      title: "测试餐食",
      observedFoods: [],
      energyKcal: null,
      proteinGrams: null,
      carbohydrateGrams: null,
      fatGrams: null,
      confidence: "low",
      assumptions: [],
      uncertaintyNote: "测试",
    }),
    nutritionService,
    maxUploadBytes: config.imageUploadMaxBytes,
  });

  const planningService = new PlanningService(new MemoryPlanningRepository());
  const trainingService = new TrainingService({ repository: new MemoryTrainingRepository(), planningService });
  return buildApp({
    config,
    checkDatabase: async () => undefined,
    identityService,
    imageAnalysisService,
    nutritionService,
    planningService,
    trainingService,
    trainingSuggestionService: new TrainingSuggestionService({ repository: new MemoryTrainingSuggestionRepository(), planningService, trainingService }),
    operationsHealthReader: {
      getHealth: async () => ({
        checkedAt: "2026-08-25T00:00:00.000Z",
        api: { status: "healthy", lastSeenAt: "2026-08-25T00:00:00.000Z" },
        database: { status: "healthy", lastSeenAt: "2026-08-25T00:00:00.000Z" },
        worker: { status: "unknown", lastSeenAt: null },
      }),
    },
  });
}
