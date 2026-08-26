import type { FastifyInstance, FastifyRequest } from "fastify";

import { sessionCookieName } from "../identity/routes.js";
import type { IdentityService } from "../identity/service.js";
import type { PortabilityService } from "./service.js";
import type { PortabilityTask } from "./types.js";

const nullableDateTime = { anyOf: [{ type: "null" }, { type: "string", format: "date-time" }] } as const;
const taskSchema = { type: "object", additionalProperties: false, required: ["id", "type", "status", "lastErrorCode", "downloadAvailable", "expiresAt", "createdAt", "updatedAt", "completedAt"], properties: { id: { type: "string", format: "uuid" }, type: { type: "string", enum: ["data_export", "account_deletion"] }, status: { type: "string", enum: ["pending", "running", "succeeded", "failed", "cancelled"] }, lastErrorCode: { anyOf: [{ type: "null" }, { type: "string" }] }, downloadAvailable: { type: "boolean" }, expiresAt: nullableDateTime, createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" }, completedAt: nullableDateTime } } as const;
const taskIdParams = { type: "object", additionalProperties: false, required: ["taskId"], properties: { taskId: { type: "string", format: "uuid" } } } as const;

function serializeTask(value: PortabilityTask) { return { ...value, expiresAt: value.expiresAt?.toISOString() ?? null, createdAt: value.createdAt.toISOString(), updatedAt: value.updatedAt.toISOString(), completedAt: value.completedAt?.toISOString() ?? null }; }

export async function registerPortabilityRoutes(app: FastifyInstance, options: { identityService: IdentityService; portabilityService: PortabilityService }) {
  async function account(request: FastifyRequest) { return options.identityService.authenticate(request.cookies[sessionCookieName]); }

  app.get("/api/v1/portability/tasks", { schema: { response: { 200: { type: "array", items: taskSchema } } }, handler: async (request) => (await options.portabilityService.listTasks((await account(request)).id)).map(serializeTask) });
  app.post("/api/v1/portability/exports", { schema: { response: { 202: taskSchema } }, handler: async (request, reply) => reply.status(202).send(serializeTask(await options.portabilityService.requestExport((await account(request)).id))) });
  app.get<{ Params: { taskId: string } }>("/api/v1/portability/exports/:taskId/download", { schema: { params: taskIdParams }, handler: async (request, reply) => { const value = await options.portabilityService.getDownload((await account(request)).id, request.params.taskId); return reply.header("content-type", value.contentType).header("content-length", value.byteSize).header("content-disposition", `attachment; filename="exercise-app-export-${request.params.taskId}.json"`).header("x-content-sha256", value.sha256).send(value.stream); } });
  app.post<{ Body: { confirmationUsername: string; password: string } }>("/api/v1/portability/account-deletion", { schema: { body: { type: "object", additionalProperties: false, required: ["confirmationUsername", "password"], properties: { confirmationUsername: { type: "string", minLength: 1, maxLength: 32 }, password: { type: "string", minLength: 1, maxLength: 128 } } }, response: { 202: taskSchema } }, handler: async (request, reply) => { const task = await options.portabilityService.requestAccountDeletion(await account(request), request.body.confirmationUsername, request.body.password); reply.clearCookie(sessionCookieName, { path: "/" }); return reply.status(202).send(serializeTask(task)); } });
}
