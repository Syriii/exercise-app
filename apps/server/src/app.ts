import { existsSync } from "node:fs";

import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import staticPlugin from "@fastify/static";
import swagger from "@fastify/swagger";
import Fastify, { type FastifyInstance } from "fastify";

import type { AppConfig } from "./config/environment.js";
import { IdentityError } from "./modules/identity/errors.js";
import { registerIdentityRoutes } from "./modules/identity/routes.js";
import type { IdentityService } from "./modules/identity/service.js";

export interface AppDependencies {
  readonly config: AppConfig;
  readonly checkDatabase: () => Promise<void>;
  readonly identityService?: IdentityService;
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
    if (error instanceof IdentityError) {
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
