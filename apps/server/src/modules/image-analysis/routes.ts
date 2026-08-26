import type { FastifyInstance, FastifyRequest } from "fastify";

import { sessionCookieName } from "../identity/routes.js";
import type { IdentityService } from "../identity/service.js";
import type { ImageAnalysisService } from "./service.js";
import type { MealImageAnalysis } from "./types.js";

const supportedImageTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const nullableNumber = { anyOf: [{ type: "null" }, { type: "number" }] } as const;
const nullableString = { anyOf: [{ type: "null" }, { type: "string" }] } as const;
const candidateSchema = {
  anyOf: [
    { type: "null" },
    {
      type: "object",
      additionalProperties: false,
      required: [
        "title",
        "observedFoods",
        "energyKcal",
        "proteinGrams",
        "carbohydrateGrams",
        "fatGrams",
        "confidence",
        "assumptions",
        "uncertaintyNote",
      ],
      properties: {
        title: { type: "string" },
        observedFoods: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["label", "estimatedPortion", "note"],
            properties: {
              label: { type: "string" },
              estimatedPortion: nullableString,
              note: nullableString,
            },
          },
        },
        energyKcal: nullableNumber,
        proteinGrams: nullableNumber,
        carbohydrateGrams: nullableNumber,
        fatGrams: nullableNumber,
        confidence: { type: "string", enum: ["low", "medium", "high"] },
        assumptions: { type: "array", items: { type: "string" } },
        uncertaintyNote: { type: "string" },
      },
    },
  ],
} as const;
const attemptSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "sequence",
    "status",
    "providerRequestId",
    "errorCode",
    "startedAt",
    "finishedAt",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    sequence: { type: "integer" },
    status: { type: "string", enum: ["running", "succeeded", "failed"] },
    providerRequestId: nullableString,
    errorCode: nullableString,
    startedAt: { type: "string", format: "date-time" },
    finishedAt: { anyOf: [{ type: "null" }, { type: "string", format: "date-time" }] },
  },
} as const;
const analysisSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "mealId",
    "status",
    "model",
    "promptVersion",
    "candidate",
    "lastErrorCode",
    "imageAvailable",
    "adoptedAt",
    "revision",
    "attempts",
    "createdAt",
    "updatedAt",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    mealId: { type: "string", format: "uuid" },
    status: {
      type: "string",
      enum: ["pending", "running", "succeeded", "failed", "cancelled"],
    },
    model: { type: "string" },
    promptVersion: { type: "string" },
    candidate: candidateSchema,
    lastErrorCode: nullableString,
    imageAvailable: { type: "boolean" },
    adoptedAt: { anyOf: [{ type: "null" }, { type: "string", format: "date-time" }] },
    revision: { type: "integer" },
    attempts: { type: "array", items: attemptSchema },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
} as const;
const analysisIdParams = {
  type: "object",
  additionalProperties: false,
  required: ["analysisId"],
  properties: { analysisId: { type: "string", format: "uuid" } },
} as const;

type AdoptBody = {
  analysisRevision: number;
  mealRevision: number;
  mode: "whole_meal" | "supplement";
  label: string;
  portionAmount: number | null;
  portionUnit: string | null;
  basisDescription: string | null;
  energyKcal: number | null;
  proteinGrams: number | null;
  carbohydrateGrams: number | null;
  fatGrams: number | null;
  replaceExisting: boolean;
  deleteOriginal: boolean;
};

function serializeAnalysis(value: MealImageAnalysis) {
  return {
    ...value,
    adoptedAt: value.adoptedAt?.toISOString() ?? null,
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
    attempts: value.attempts.map((attempt) => ({
      ...attempt,
      startedAt: attempt.startedAt.toISOString(),
      finishedAt: attempt.finishedAt?.toISOString() ?? null,
    })),
  };
}

export async function registerImageAnalysisRoutes(
  app: FastifyInstance,
  options: { identityService: IdentityService; imageAnalysisService: ImageAnalysisService },
): Promise<void> {
  async function userId(request: FastifyRequest) {
    return (await options.identityService.authenticate(request.cookies[sessionCookieName])).id;
  }

  app.addContentTypeParser(
    supportedImageTypes,
    (_request, payload, done) => done(null, payload),
  );

  app.post<{
    Querystring: { mealId: string };
    Body: NodeJS.ReadableStream;
  }>(
    "/api/v1/image-analyses",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["mealId"],
          properties: { mealId: { type: "string", format: "uuid" } },
        },
        response: { 202: analysisSchema },
      },
      handler: async (request, reply) => {
        const contentType = request.headers["content-type"]?.split(";", 1)[0];
        const result = await options.imageAnalysisService.request(
          await userId(request),
          request.query.mealId,
          contentType,
          request.body,
        );
        return reply.status(202).send(serializeAnalysis(result));
      },
    },
  );

  app.get<{ Querystring: { mealId: string } }>(
    "/api/v1/image-analyses",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["mealId"],
          properties: { mealId: { type: "string", format: "uuid" } },
        },
        response: { 200: { type: "array", items: analysisSchema } },
      },
      handler: async (request) =>
        (await options.imageAnalysisService.list(await userId(request), request.query.mealId)).map(
          serializeAnalysis,
        ),
    },
  );

  app.post<{ Params: { analysisId: string }; Body: { revision: number } }>(
    "/api/v1/image-analyses/:analysisId/retry",
    {
      schema: {
        params: analysisIdParams,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["revision"],
          properties: { revision: { type: "integer", minimum: 1 } },
        },
        response: { 202: analysisSchema },
      },
      handler: async (request, reply) =>
        reply
          .status(202)
          .send(
            serializeAnalysis(
              await options.imageAnalysisService.retry(
                await userId(request),
                request.params.analysisId,
                request.body.revision,
              ),
            ),
          ),
    },
  );

  app.post<{ Params: { analysisId: string }; Body: AdoptBody }>(
    "/api/v1/image-analyses/:analysisId/adopt",
    {
      schema: {
        params: analysisIdParams,
        body: {
          type: "object",
          additionalProperties: false,
          required: [
            "analysisRevision",
            "mealRevision",
            "mode",
            "label",
            "portionAmount",
            "portionUnit",
            "basisDescription",
            "energyKcal",
            "proteinGrams",
            "carbohydrateGrams",
            "fatGrams",
            "replaceExisting",
            "deleteOriginal",
          ],
          properties: {
            analysisRevision: { type: "integer", minimum: 1 },
            mealRevision: { type: "integer", minimum: 1 },
            mode: { type: "string", enum: ["whole_meal", "supplement"] },
            label: { type: "string", minLength: 1, maxLength: 100 },
            portionAmount: nullableNumber,
            portionUnit: nullableString,
            basisDescription: nullableString,
            energyKcal: nullableNumber,
            proteinGrams: nullableNumber,
            carbohydrateGrams: nullableNumber,
            fatGrams: nullableNumber,
            replaceExisting: { type: "boolean" },
            deleteOriginal: { type: "boolean" },
          },
        },
        response: {
          200: {
            type: "object",
            additionalProperties: true,
          },
        },
      },
      handler: async (request) => {
        const result = await options.imageAnalysisService.adopt(
          await userId(request),
          request.params.analysisId,
          request.body.analysisRevision,
          request.body.mealRevision,
          request.body,
        );
        return {
          analysis: serializeAnalysis(result.analysis),
          meal: {
            ...result.meal,
            occurredAt: result.meal.occurredAt.toISOString(),
            createdAt: result.meal.createdAt.toISOString(),
            updatedAt: result.meal.updatedAt.toISOString(),
            contributions: result.meal.contributions.map((value) => ({
              ...value,
              createdAt: value.createdAt.toISOString(),
              updatedAt: value.updatedAt.toISOString(),
            })),
          },
        };
      },
    },
  );
}
