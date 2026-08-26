import { existsSync } from "node:fs";

import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import staticPlugin from "@fastify/static";
import swagger from "@fastify/swagger";
import Fastify, { type FastifyInstance } from "fastify";

import type { AppConfig } from "./config/environment.js";
import type { DatabaseUserContext } from "./db/user-context.js";
import { ImageAnalysisError } from "./modules/image-analysis/errors.js";
import { registerImageAnalysisRoutes } from "./modules/image-analysis/routes.js";
import type { ImageAnalysisService } from "./modules/image-analysis/service.js";
import { IdentityError } from "./modules/identity/errors.js";
import { registerIdentityRoutes } from "./modules/identity/routes.js";
import type { IdentityService } from "./modules/identity/service.js";
import { NutritionError } from "./modules/nutrition/errors.js";
import { registerNutritionRoutes } from "./modules/nutrition/routes.js";
import type { NutritionService } from "./modules/nutrition/service.js";
import { registerOperationsRoutes } from "./modules/operations/routes.js";
import type { OperationsHealthReader } from "./modules/operations/service.js";
import type { OperationsSummaryReader } from "./modules/operations/service.js";
import { PlanningError } from "./modules/planning/errors.js";
import { registerPlanningRoutes } from "./modules/planning/routes.js";
import type { PlanningService } from "./modules/planning/service.js";
import { PortabilityError } from "./modules/portability/errors.js";
import { registerPortabilityRoutes } from "./modules/portability/routes.js";
import type { PortabilityService } from "./modules/portability/service.js";
import { ReminderError } from "./modules/reminders/errors.js";
import { registerReminderRoutes } from "./modules/reminders/routes.js";
import type { ReminderService } from "./modules/reminders/service.js";
import { TrainingError } from "./modules/training/errors.js";
import { registerTrainingRoutes } from "./modules/training/routes.js";
import type { TrainingService } from "./modules/training/service.js";
import { TrainingSuggestionError } from "./modules/training-suggestions/errors.js";
import { registerTrainingSuggestionRoutes } from "./modules/training-suggestions/routes.js";
import type { TrainingSuggestionService } from "./modules/training-suggestions/service.js";
import { registerRequestRateLimits } from "./security/request-rate-limiter.js";

export interface AppDependencies {
  readonly config: AppConfig;
  readonly checkDatabase: () => Promise<void>;
  readonly identityService?: IdentityService;
  readonly imageAnalysisService?: ImageAnalysisService;
  readonly nutritionService?: NutritionService;
  readonly operationsHealthReader?: OperationsHealthReader;
  readonly operationsSummaryReader?: OperationsSummaryReader;
  readonly planningService?: PlanningService;
  readonly portabilityService?: PortabilityService;
  readonly reminderService?: ReminderService;
  readonly trainingService?: TrainingService;
  readonly trainingSuggestionService?: TrainingSuggestionService;
  readonly databaseUserContext?: DatabaseUserContext;
}

export async function buildApp(dependencies: AppDependencies): Promise<FastifyInstance> {
  const { config } = dependencies;
  const app = Fastify({
    logger:
      config.logLevel === "silent"
        ? false
        : {
            level: config.logLevel,
            redact: [
              "req.headers.authorization",
              "req.headers.cookie",
              "res.headers.set-cookie",
              "password",
              "passwordHash",
            ],
    },
    requestIdHeader: "x-request-id",
  });
  if (dependencies.databaseUserContext !== undefined) {
    app.addHook("onRequest", async () => dependencies.databaseUserContext!.clear());
  }

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: false,
  });
  await app.register(swagger, {
    openapi: {
      info: {
        title: "Exercise App API",
        version: "0.0.0",
      },
    },
  });
  registerRequestRateLimits(app, config);

  app.get("/api/v1/health/live", {
    schema: {
      response: {
        200: {
          type: "object",
          additionalProperties: false,
          required: ["status"],
          properties: { status: { type: "string", const: "ok" } },
        },
      },
    },
    handler: async () => ({ status: "ok" as const }),
  });

  app.get("/api/v1/health/ready", {
    schema: {
      response: {
        200: {
          type: "object",
          additionalProperties: false,
          required: ["status"],
          properties: { status: { type: "string", const: "ready" } },
        },
        503: {
          type: "object",
          additionalProperties: false,
          required: ["status", "code"],
          properties: {
            status: { type: "string", const: "unavailable" },
            code: { type: "string", const: "database_unavailable" },
          },
        },
      },
    },
    handler: async (_request, reply) => {
      try {
        await dependencies.checkDatabase();
        return { status: "ready" as const };
      } catch {
        return reply.status(503).send({
          status: "unavailable",
          code: "database_unavailable",
        });
      }
    },
  });

  if (dependencies.identityService !== undefined) {
    await registerIdentityRoutes(app, {
      service: dependencies.identityService,
      config,
    });
  }

  if (
    dependencies.identityService !== undefined &&
    dependencies.operationsHealthReader !== undefined
  ) {
    await registerOperationsRoutes(app, {
      identityService: dependencies.identityService,
      healthReader: dependencies.operationsHealthReader,
      ...(dependencies.operationsSummaryReader === undefined ? {} : { summaryReader: dependencies.operationsSummaryReader }),
    });
  }

  if (dependencies.identityService !== undefined && dependencies.trainingService !== undefined) {
    await registerTrainingRoutes(app, {
      identityService: dependencies.identityService,
      trainingService: dependencies.trainingService,
    });
  }

  if (dependencies.identityService !== undefined && dependencies.trainingSuggestionService !== undefined) {
    await registerTrainingSuggestionRoutes(app, { identityService: dependencies.identityService, service: dependencies.trainingSuggestionService });
  }

  if (
    dependencies.identityService !== undefined &&
    dependencies.imageAnalysisService !== undefined
  ) {
    await registerImageAnalysisRoutes(app, {
      identityService: dependencies.identityService,
      imageAnalysisService: dependencies.imageAnalysisService,
    });
  }

  if (dependencies.identityService !== undefined && dependencies.reminderService !== undefined) {
    await registerReminderRoutes(app, {
      identityService: dependencies.identityService,
      reminderService: dependencies.reminderService,
    });
  }

  if (dependencies.identityService !== undefined && dependencies.planningService !== undefined) {
    await registerPlanningRoutes(app, {
      identityService: dependencies.identityService,
      planningService: dependencies.planningService,
    });
  }

  if (dependencies.identityService !== undefined && dependencies.portabilityService !== undefined) {
    await registerPortabilityRoutes(app, { identityService: dependencies.identityService, portabilityService: dependencies.portabilityService });
  }

  if (dependencies.identityService !== undefined && dependencies.nutritionService !== undefined && dependencies.planningService !== undefined) {
    await registerNutritionRoutes(app, {
      identityService: dependencies.identityService,
      nutritionService: dependencies.nutritionService,
      planningService: dependencies.planningService,
    });
  }

  if (existsSync(config.webDistDirectory)) {
    await app.register(staticPlugin, {
      root: config.webDistDirectory,
      wildcard: false,
      index: false,
    });

    app.get("/", async (_request, reply) => reply.sendFile("index.html"));
    app.setNotFoundHandler(async (request, reply) => {
      const isDocumentRequest = request.method === "GET" || request.method === "HEAD";
      const requestPath = request.url.split("?", 1)[0] ?? request.url;
      const isApiRequest = requestPath === "/api" || requestPath.startsWith("/api/");
      if (isDocumentRequest && !isApiRequest) {
        return reply.sendFile("index.html");
      }
      return reply.status(404).send({
        code: "not_found",
        message: "请求的资源不存在",
        requestId: request.id,
      });
    });
  }

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, "request failed");
    if (error instanceof IdentityError || error instanceof ImageAnalysisError || error instanceof NutritionError || error instanceof TrainingError || error instanceof TrainingSuggestionError || error instanceof ReminderError || error instanceof PlanningError || error instanceof PortabilityError) {
      void reply.status(error.statusCode).send({
        code: error.code,
        message: error.message,
        requestId: request.id,
      });
      return;
    }
    const statusCode =
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      typeof error.statusCode === "number"
        ? error.statusCode
        : 500;
    const publicMessage =
      statusCode < 500 && error instanceof Error ? error.message : "服务器暂时无法处理请求";

    void reply.status(statusCode).send({
      code: statusCode >= 500 ? "internal_error" : "request_error",
      message: publicMessage,
      requestId: request.id,
    });
  });

  return app;
}
