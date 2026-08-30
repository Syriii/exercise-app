import type { FastifyInstance, FastifyRequest } from "fastify";

import { sessionCookieName } from "../identity/routes.js";
import type { IdentityService } from "../identity/service.js";
import type { PlanningService } from "./service.js";
import type { MacroPreference, PalCategory, PlanningSexCategory, WeightStrategy } from "./types.js";

const nullableString = { anyOf: [{ type: "null" }, { type: "string" }] } as const;
const nullableNumber = { anyOf: [{ type: "null" }, { type: "number" }] } as const;
const nullableDate = { anyOf: [{ type: "null" }, { type: "string", format: "date" }] } as const;
const nullableDateTime = { anyOf: [{ type: "null" }, { type: "string", format: "date-time" }] } as const;

const profileProperties = {
  birthDate: nullableDate,
  sexCategory: { anyOf: [{ type: "null" }, { type: "string", enum: ["male", "female"] }] },
  heightCm: nullableNumber,
  pregnantOrBreastfeeding: { type: "boolean" },
  medicalNutritionCondition: { type: "boolean" },
  specialBodyComposition: { type: "boolean" },
  palCategory: { anyOf: [{ type: "null" }, { type: "string", enum: ["inactive", "low_active", "active", "very_active"] }] },
} as const;

const profileResponse = {
  type: "object",
  additionalProperties: false,
  required: [...Object.keys(profileProperties), "revision", "updatedAt"],
  properties: { ...profileProperties, revision: { type: "integer" }, updatedAt: nullableDateTime },
} as const;

const strategyProperties = {
  weightStrategy: { type: "string", enum: ["maintain", "lose", "gain"] },
  macroPreference: { type: "string", enum: ["balanced", "high_protein", "lower_fat"] },
  regularExercise: { type: "boolean" },
  trainingIntent: nullableString,
  targetWeightKg: nullableNumber,
  targetDate: nullableDate,
} as const;

const strategyResponse = {
  type: "object",
  additionalProperties: false,
  required: [...Object.keys(strategyProperties), "revision", "updatedAt"],
  properties: { ...strategyProperties, revision: { type: "integer" }, updatedAt: nullableDateTime },
} as const;

const measurementProperties = {
  id: { type: "string", format: "uuid" },
  measuredAt: { type: "string", format: "date-time" },
  localDate: { type: "string", format: "date" },
  timeZone: { type: "string" },
  weightKg: { type: "number" },
  waistCm: nullableNumber,
  note: nullableString,
  revision: { type: "integer" },
  createdAt: { type: "string", format: "date-time" },
  updatedAt: { type: "string", format: "date-time" },
} as const;
const measurementResponse = { type: "object", additionalProperties: false, required: Object.keys(measurementProperties), properties: measurementProperties } as const;

const measurementInputProperties = {
  measuredAt: { type: "string", format: "date-time" },
  localDate: { type: "string", format: "date" },
  timeZone: { type: "string", minLength: 1, maxLength: 100 },
  weightKg: { type: "number", minimum: 20, maximum: 400 },
  waistCm: { anyOf: [{ type: "null" }, { type: "number", minimum: 30, maximum: 300 }] },
  note: { anyOf: [{ type: "null" }, { type: "string", maxLength: 500 }] },
} as const;

function serializeMeasurement<T extends { measuredAt: Date; createdAt: Date; updatedAt: Date }>(value: T) {
  return { ...value, measuredAt: value.measuredAt.toISOString(), createdAt: value.createdAt.toISOString(), updatedAt: value.updatedAt.toISOString() };
}

export async function registerPlanningRoutes(app: FastifyInstance, options: { readonly identityService: IdentityService; readonly planningService: PlanningService }): Promise<void> {
  async function userId(request: FastifyRequest): Promise<string> {
    return (await options.identityService.authenticate(request.cookies[sessionCookieName])).id;
  }

  app.get("/api/v1/planning/profile", {
    schema: { response: { 200: profileResponse } },
    handler: async (request) => {
      const value = await options.planningService.getProfile(await userId(request));
      return { ...value, updatedAt: value.updatedAt?.toISOString() ?? null };
    },
  });

  app.put<{ Body: { revision: number; birthDate: string | null; sexCategory: PlanningSexCategory | null; heightCm: number | null; pregnantOrBreastfeeding: boolean; medicalNutritionCondition: boolean; specialBodyComposition: boolean; palCategory: PalCategory | null } }>("/api/v1/planning/profile", {
    schema: {
      body: { type: "object", additionalProperties: false, required: ["revision", ...Object.keys(profileProperties)], properties: { revision: { type: "integer", minimum: 0 }, ...profileProperties } },
      response: { 200: profileResponse },
    },
    handler: async (request) => {
      const { revision, ...input } = request.body;
      const value = await options.planningService.updateProfile(await userId(request), revision, input);
      return { ...value, updatedAt: value.updatedAt?.toISOString() ?? null };
    },
  });

  app.get("/api/v1/planning/strategy", {
    schema: { response: { 200: strategyResponse } },
    handler: async (request) => {
      const value = await options.planningService.getStrategy(await userId(request));
      return { ...value, updatedAt: value.updatedAt?.toISOString() ?? null };
    },
  });

  app.put<{ Body: { revision: number; weightStrategy: WeightStrategy; macroPreference: MacroPreference; regularExercise: boolean; trainingIntent: string | null; targetWeightKg: number | null; targetDate: string | null } }>("/api/v1/planning/strategy", {
    schema: {
      body: { type: "object", additionalProperties: false, required: ["revision", ...Object.keys(strategyProperties)], properties: { revision: { type: "integer", minimum: 0 }, ...strategyProperties } },
      response: { 200: strategyResponse },
    },
    handler: async (request) => {
      const { revision, ...input } = request.body;
      const value = await options.planningService.updateStrategy(await userId(request), revision, input);
      return { ...value, updatedAt: value.updatedAt?.toISOString() ?? null };
    },
  });

  app.get("/api/v1/planning/measurements", {
    schema: { response: { 200: { type: "array", items: measurementResponse } } },
    handler: async (request) => (await options.planningService.listMeasurements(await userId(request))).map(serializeMeasurement),
  });

  app.post<{ Body: { measuredAt: string; localDate: string; timeZone: string; weightKg: number; waistCm: number | null; note: string | null } }>("/api/v1/planning/measurements", {
    schema: { body: { type: "object", additionalProperties: false, required: Object.keys(measurementInputProperties), properties: measurementInputProperties }, response: { 201: measurementResponse } },
    handler: async (request, reply) => reply.status(201).send(serializeMeasurement(await options.planningService.createMeasurement(await userId(request), request.body))),
  });

  app.put<{ Params: { measurementId: string }; Body: { revision: number; measuredAt: string; localDate: string; timeZone: string; weightKg: number; waistCm: number | null; note: string | null } }>("/api/v1/planning/measurements/:measurementId", {
    schema: {
      params: { type: "object", additionalProperties: false, required: ["measurementId"], properties: { measurementId: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["revision", ...Object.keys(measurementInputProperties)], properties: { revision: { type: "integer", minimum: 1 }, ...measurementInputProperties } },
      response: { 200: measurementResponse },
    },
    handler: async (request) => serializeMeasurement(await options.planningService.updateMeasurement(await userId(request), request.params.measurementId, request.body.revision, request.body)),
  });

  app.get<{ Params: { measurementId: string } }>("/api/v1/planning/measurements/:measurementId/revisions", {
    schema: {
      params: { type: "object", additionalProperties: false, required: ["measurementId"], properties: { measurementId: { type: "string", format: "uuid" } } },
      response: { 200: { type: "array", items: { type: "object", additionalProperties: true } } },
    },
    handler: async (request) => (await options.planningService.listMeasurementRevisions(await userId(request), request.params.measurementId)).map((value) => ({ ...value, measuredAt: value.measuredAt.toISOString(), createdAt: value.createdAt.toISOString() })),
  });

  app.get<{ Querystring: { localDate: string; timeZone: string } }>("/api/v1/planning/daily-reference", {
    schema: {
      querystring: { type: "object", additionalProperties: false, required: ["localDate", "timeZone"], properties: { localDate: { type: "string", format: "date" }, timeZone: { type: "string", minLength: 1, maxLength: 100 } } },
      response: { 200: { type: "object", additionalProperties: true } },
    },
    handler: async (request) => {
      const value = await options.planningService.getDailyReference(await userId(request), request.query.localDate, request.query.timeZone);
      return { ...value, createdAt: value.createdAt.toISOString() };
    },
  });
}
