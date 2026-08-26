import type { FastifyInstance, FastifyRequest } from "fastify";

import { sessionCookieName } from "../identity/routes.js";
import type { IdentityService } from "../identity/service.js";
import { templateBodySchema, templateResponseSchema } from "../training/routes.js";
import type { TrainingSuggestionService } from "./service.js";
import type { TrainingSuggestionPreferences, TrainingSuggestionView } from "./types.js";

const preferencesSchema = { type: "object", additionalProperties: false, required: ["goal", "experience", "equipment", "availableDaysPerWeek", "sessionMinutes", "hasInjuryOrMedicalLimitation"], properties: { goal: { type: "string", enum: ["general", "strength", "hypertrophy", "power"] }, experience: { type: "string", enum: ["beginner", "intermediate", "advanced"] }, equipment: { type: "string", enum: ["minimal", "dumbbells", "full_gym"] }, availableDaysPerWeek: { type: "integer", minimum: 2, maximum: 6 }, sessionMinutes: { type: "integer", minimum: 20, maximum: 120 }, hasInjuryOrMedicalLimitation: { type: "boolean" } } } as const;
const nullableDateTime = { anyOf: [{ type: "null" }, { type: "string", format: "date-time" }] } as const;
const nullableUuid = { anyOf: [{ type: "null" }, { type: "string", format: "uuid" }] } as const;
const inputSnapshotSchema = {
  type: "object",
  additionalProperties: false,
  required: ["generatedOn", "profileRevision", "strategyRevision", "latestMeasurement", "preferences"],
  properties: {
    generatedOn: { type: "string", format: "date" },
    profileRevision: { type: "integer" },
    strategyRevision: { type: "integer" },
    latestMeasurement: {
      anyOf: [
        { type: "null" },
        { type: "object", additionalProperties: false, required: ["id", "revision", "localDate"], properties: { id: { type: "string", format: "uuid" }, revision: { type: "integer" }, localDate: { type: "string", format: "date" } } },
      ],
    },
    preferences: preferencesSchema,
  },
} as const;
const candidateSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "title", "weeklyResistanceDays", "publicHealthBaseline", "template", "messages", "limitations"],
  properties: {
    status: { type: "string", enum: ["ready", "stopped"] },
    title: { type: "string" },
    weeklyResistanceDays: { anyOf: [{ type: "null" }, { type: "integer" }] },
    publicHealthBaseline: { type: "array", items: { type: "string" } },
    template: { anyOf: [{ type: "null" }, templateBodySchema] },
    messages: { type: "array", items: { type: "string" } },
    limitations: { type: "array", items: { type: "string" } },
  },
} as const;
const suggestionResponse = {
  type: "object",
  additionalProperties: false,
  required: ["id", "status", "methodVersion", "evidenceIds", "inputSnapshot", "candidate", "adoptedTemplateId", "revision", "adoptedAt", "dismissedAt", "createdAt", "updatedAt", "stale"],
  properties: {
    id: { type: "string", format: "uuid" },
    status: { type: "string", enum: ["active", "adopted", "dismissed"] },
    methodVersion: { type: "string" },
    evidenceIds: { type: "array", items: { type: "string" } },
    inputSnapshot: inputSnapshotSchema,
    candidate: candidateSchema,
    adoptedTemplateId: nullableUuid,
    revision: { type: "integer" },
    adoptedAt: nullableDateTime,
    dismissedAt: nullableDateTime,
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
    stale: { type: "boolean" },
  },
} as const;
const suggestionParams = { type: "object", additionalProperties: false, required: ["suggestionId"], properties: { suggestionId: { type: "string", format: "uuid" } } } as const;
const revisionBody = { type: "object", additionalProperties: false, required: ["revision"], properties: { revision: { type: "integer", minimum: 1 } } } as const;

function publicSuggestion(value: TrainingSuggestionView) {
  const { userId: _userId, ...result } = value;
  return { ...result, adoptedAt: result.adoptedAt?.toISOString() ?? null, dismissedAt: result.dismissedAt?.toISOString() ?? null, createdAt: result.createdAt.toISOString(), updatedAt: result.updatedAt.toISOString() };
}

export async function registerTrainingSuggestionRoutes(app: FastifyInstance, options: { identityService: IdentityService; service: TrainingSuggestionService }): Promise<void> {
  async function userId(request: FastifyRequest) { return (await options.identityService.authenticate(request.cookies[sessionCookieName])).id; }
  app.get("/api/v1/training-suggestions", { schema: { response: { 200: { type: "array", items: suggestionResponse } } }, handler: async (request) => (await options.service.list(await userId(request))).map(publicSuggestion) });
  app.post<{ Body: TrainingSuggestionPreferences }>("/api/v1/training-suggestions", { schema: { body: preferencesSchema, response: { 201: suggestionResponse } }, handler: async (request, reply) => reply.status(201).send(publicSuggestion(await options.service.generate(await userId(request), request.body))) });
  app.post<{ Params: { suggestionId: string }; Body: { revision: number } }>("/api/v1/training-suggestions/:suggestionId/adopt", { schema: { params: suggestionParams, body: revisionBody, response: { 200: { type: "object", additionalProperties: false, required: ["suggestion", "template"], properties: { suggestion: suggestionResponse, template: templateResponseSchema } } } }, handler: async (request) => { const result = await options.service.adopt(await userId(request), request.params.suggestionId, request.body.revision); const { userId: _userId, ...template } = result.template; return { suggestion: publicSuggestion(result.suggestion), template }; } });
  app.post<{ Params: { suggestionId: string }; Body: { revision: number } }>("/api/v1/training-suggestions/:suggestionId/dismiss", { schema: { params: suggestionParams, body: revisionBody, response: { 200: suggestionResponse } }, handler: async (request) => publicSuggestion(await options.service.dismiss(await userId(request), request.params.suggestionId, request.body.revision)) });
}
