import type { FastifyInstance } from "fastify";

import { sessionCookieName } from "../identity/routes.js";
import type { IdentityService } from "../identity/service.js";
import type { OperationsHealthReader, OperationsSummaryReader } from "./service.js";

interface OperationsRouteOptions {
  readonly identityService: IdentityService;
  readonly healthReader: OperationsHealthReader;
  readonly summaryReader?: OperationsSummaryReader;
}

const componentHealthSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "lastSeenAt"],
  properties: {
    status: { type: "string", enum: ["healthy", "stale", "unavailable", "unknown"] },
    lastSeenAt: { anyOf: [{ type: "string", format: "date-time" }, { type: "null" }] },
  },
} as const;

const nullableDateTimeSchema = {
  anyOf: [{ type: "string", format: "date-time" }, { type: "null" }],
} as const;

const maintenanceStatusSchema = {
  type: "object",
  additionalProperties: false,
  required: ["lastSucceededAt", "lastFailedAt"],
  properties: {
    lastSucceededAt: nullableDateTimeSchema,
    lastFailedAt: nullableDateTimeSchema,
  },
} as const;

const operationsSummarySchema = {
  type: "object",
  additionalProperties: false,
  required: ["checkedAt", "model", "tasks", "media", "disk", "backup", "restoreVerification"],
  properties: {
    checkedAt: { type: "string", format: "date-time" },
    model: {
      type: "object",
      additionalProperties: false,
      required: ["configured", "model"],
      properties: {
        configured: { type: "boolean" },
        model: { anyOf: [{ type: "string" }, { type: "null" }] },
      },
    },
    tasks: {
      type: "object",
      additionalProperties: false,
      required: ["pending", "running", "succeeded", "failed", "cancelled"],
      properties: Object.fromEntries(
        ["pending", "running", "succeeded", "failed", "cancelled"].map((status) => [
          status,
          { type: "integer", minimum: 0 },
        ]),
      ),
    },
    media: {
      type: "object",
      additionalProperties: false,
      required: ["available", "deletion_pending", "deleted", "missing", "expiredAvailable"],
      properties: Object.fromEntries(
        ["available", "deletion_pending", "deleted", "missing", "expiredAvailable"].map((status) => [
          status,
          { type: "integer", minimum: 0 },
        ]),
      ),
    },
    disk: {
      type: "object",
      additionalProperties: false,
      required: ["availableBytes"],
      properties: {
        availableBytes: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
      },
    },
    backup: maintenanceStatusSchema,
    restoreVerification: maintenanceStatusSchema,
  },
} as const;

export async function registerOperationsRoutes(
  app: FastifyInstance,
  options: OperationsRouteOptions,
): Promise<void> {
  app.get("/api/v1/admin/operations/health", {
    schema: {
      response: {
        200: {
          type: "object",
          additionalProperties: false,
          required: ["checkedAt", "api", "database", "worker"],
          properties: {
            checkedAt: { type: "string", format: "date-time" },
            api: componentHealthSchema,
            database: componentHealthSchema,
            worker: componentHealthSchema,
          },
        },
      },
    },
    handler: async (request) => {
      await options.identityService.authenticateAdmin(request.cookies[sessionCookieName]);
      return options.healthReader.getHealth();
    },
  });

  if (options.summaryReader !== undefined) {
    app.get("/api/v1/admin/operations/summary", {
      schema: { response: { 200: operationsSummarySchema } },
      handler: async (request) => {
        await options.identityService.authenticateAdmin(request.cookies[sessionCookieName]);
        return options.summaryReader!.getSummary();
      },
    });
  }
}
