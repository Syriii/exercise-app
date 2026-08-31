import type { FastifyInstance, FastifyRequest } from "fastify";

import { sessionCookieName } from "../identity/routes.js";
import type { IdentityService } from "../identity/service.js";
import type { PlanningService } from "../planning/service.js";
import type { ContributionRequest, NutritionService } from "./service.js";
import type { PublicFoodSearchResult } from "./public-food-provider.js";
import type { DietPlan, DietPlanInput, FoodSearchResult, Meal, PersonalFoodTemplate } from "./types.js";

const nullableNumber = { anyOf: [{ type: "null" }, { type: "number" }] } as const;
const nullableString = { anyOf: [{ type: "null" }, { type: "string" }] } as const;
const nutrientProperties = { energyKcal: nullableNumber, proteinGrams: nullableNumber, carbohydrateGrams: nullableNumber, fatGrams: nullableNumber } as const;
const contributionProperties = { id: { type: "string", format: "uuid" }, mealId: { type: "string", format: "uuid" }, mode: { type: "string", enum: ["item", "whole_meal", "supplement"] }, source: { type: "string", enum: ["manual", "model_adopted"] }, reviewStatus: { type: "string", enum: ["tentative", "confirmed"] }, sourceAnalysisId: { anyOf: [{ type: "null" }, { type: "string", format: "uuid" }] }, label: { type: "string" }, portionAmount: nullableNumber, portionUnit: nullableString, basisDescription: nullableString, ...nutrientProperties, revision: { type: "integer" }, createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" } } as const;
const contributionResponse = { type: "object", additionalProperties: false, required: Object.keys(contributionProperties), properties: contributionProperties } as const;
const mealProperties = { id: { type: "string", format: "uuid" }, occurredAt: { type: "string", format: "date-time" }, localDate: { type: "string", format: "date" }, timeZone: { type: "string" }, name: nullableString, note: nullableString, revision: { type: "integer" }, contributions: { type: "array", items: contributionResponse }, createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" } } as const;
const mealResponse = { type: "object", additionalProperties: false, required: Object.keys(mealProperties), properties: mealProperties } as const;
const mealInput = { type: "object", additionalProperties: false, required: ["occurredAt", "localDate", "timeZone", "name", "note"], properties: { occurredAt: { type: "string", format: "date-time" }, localDate: { type: "string", format: "date" }, timeZone: { type: "string", minLength: 1, maxLength: 100 }, name: { anyOf: [{ type: "null" }, { type: "string", maxLength: 100 }] }, note: { anyOf: [{ type: "null" }, { type: "string", maxLength: 500 }] } } } as const;
const contributionInput = { type: "object", additionalProperties: false, required: ["mode", "label", "portionAmount", "portionUnit", "basisDescription", ...Object.keys(nutrientProperties)], properties: { mode: { type: "string", enum: ["item", "whole_meal", "supplement"] }, label: { type: "string", minLength: 1, maxLength: 100 }, portionAmount: nullableNumber, portionUnit: nullableString, basisDescription: nullableString, ...nutrientProperties } } as const;
const templateProperties = { id: { type: "string", format: "uuid" }, label: { type: "string" }, portionAmount: nullableNumber, portionUnit: nullableString, basisDescription: nullableString, ...nutrientProperties, revision: { type: "integer" }, createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" } } as const;
const templateResponse = { type: "object", additionalProperties: false, required: Object.keys(templateProperties), properties: templateProperties } as const;
const foodSearchProperties = { id: { type: "string" }, source: { type: "string", enum: ["personal_template", "recent_meal"] }, label: { type: "string" }, portionAmount: nullableNumber, portionUnit: nullableString, basisDescription: nullableString, ...nutrientProperties, lastUsedAt: { type: "string", format: "date-time" } } as const;
const foodSearchResponse = { type: "object", additionalProperties: false, required: Object.keys(foodSearchProperties), properties: foodSearchProperties } as const;
const publicFoodSearchProperties = { id: { type: "string" }, provider: { type: "string", const: "open_food_facts" }, label: { type: "string" }, brand: nullableString, barcode: { type: "string" }, basisAmount: { type: "number", const: 100 }, basisUnit: { type: "string", const: "g" }, ...nutrientProperties, sourceUrl: { type: "string", format: "uri" } } as const;
const publicFoodSearchResponse = { type: "object", additionalProperties: false, required: Object.keys(publicFoodSearchProperties), properties: publicFoodSearchProperties } as const;
const dietPlanEntryInput = { type: "object", additionalProperties: false, required: ["localDate", "mealName", "foodPlan", "note"], properties: { localDate: { anyOf: [{ type: "null" }, { type: "string", format: "date" }] }, mealName: nullableString, foodPlan: { type: "string", minLength: 1, maxLength: 500 }, note: nullableString } } as const;
const dietPlanInput = { type: "object", additionalProperties: false, required: ["dateFrom", "dateTo", "title", "note", "entries"], properties: { dateFrom: { type: "string", format: "date" }, dateTo: { type: "string", format: "date" }, title: { type: "string", minLength: 1, maxLength: 100 }, note: nullableString, entries: { type: "array", maxItems: 50, items: dietPlanEntryInput } } } as const;
const dietPlanResponse = { type: "object", additionalProperties: false, required: ["id", "dateFrom", "dateTo", "title", "note", "entries", "revision", "archivedAt", "createdAt", "updatedAt"], properties: { id: { type: "string", format: "uuid" }, dateFrom: { type: "string", format: "date" }, dateTo: { type: "string", format: "date" }, title: { type: "string" }, note: nullableString, entries: { type: "array", items: { ...dietPlanEntryInput, required: ["id", ...dietPlanEntryInput.required], properties: { id: { type: "string", format: "uuid" }, ...dietPlanEntryInput.properties } } }, revision: { type: "integer" }, archivedAt: { anyOf: [{ type: "null" }, { type: "string", format: "date-time" }] }, createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" } } } as const;

type MealInput = { occurredAt: string; localDate: string; timeZone: string; name: string | null; note: string | null };
type ContributionBody = ContributionRequest & { replaceExisting: boolean };

function serializeMeal(meal: Meal) { return { ...meal, occurredAt: meal.occurredAt.toISOString(), createdAt: meal.createdAt.toISOString(), updatedAt: meal.updatedAt.toISOString(), contributions: meal.contributions.map((value) => ({ ...value, createdAt: value.createdAt.toISOString(), updatedAt: value.updatedAt.toISOString() })) }; }
function serializeTemplate(value: PersonalFoodTemplate) { return { ...value, createdAt: value.createdAt.toISOString(), updatedAt: value.updatedAt.toISOString() }; }
function serializeFoodSearch(value: FoodSearchResult) { return { ...value, lastUsedAt: value.lastUsedAt.toISOString() }; }
function serializePublicFoodSearch(value: PublicFoodSearchResult) { return value; }
function serializeDietPlan(value: DietPlan) { const { userId: _userId, ...plan } = value; return { ...plan, archivedAt: plan.archivedAt?.toISOString() ?? null, createdAt: plan.createdAt.toISOString(), updatedAt: plan.updatedAt.toISOString() }; }

export async function registerNutritionRoutes(app: FastifyInstance, options: { identityService: IdentityService; nutritionService: NutritionService; planningService: PlanningService }): Promise<void> {
  async function userId(request: FastifyRequest) { return (await options.identityService.authenticate(request.cookies[sessionCookieName])).id; }

  app.get<{ Querystring: { from: string; to: string; includeArchived?: string } }>("/api/v1/nutrition/diet-plans", { schema: { querystring: { type: "object", additionalProperties: false, required: ["from", "to"], properties: { from: { type: "string", format: "date" }, to: { type: "string", format: "date" }, includeArchived: { type: "string", enum: ["true", "false"] } } }, response: { 200: { type: "array", items: dietPlanResponse } } }, handler: async (request) => (await options.nutritionService.listDietPlans(await userId(request), request.query.from, request.query.to, request.query.includeArchived === "true")).map(serializeDietPlan) });
  app.post<{ Body: DietPlanInput }>("/api/v1/nutrition/diet-plans", { schema: { body: dietPlanInput, response: { 201: dietPlanResponse } }, handler: async (request, reply) => reply.status(201).send(serializeDietPlan(await options.nutritionService.createDietPlan(await userId(request), request.body))) });
  app.put<{ Params: { planId: string }; Body: DietPlanInput & { revision: number } }>("/api/v1/nutrition/diet-plans/:planId", { schema: { params: idParams("planId"), body: { ...dietPlanInput, required: ["revision", ...dietPlanInput.required], properties: { revision: { type: "integer", minimum: 1 }, ...dietPlanInput.properties } }, response: { 200: dietPlanResponse } }, handler: async (request) => serializeDietPlan(await options.nutritionService.updateDietPlan(await userId(request), request.params.planId, request.body.revision, request.body)) });
  app.post<{ Params: { planId: string }; Body: { revision: number } }>("/api/v1/nutrition/diet-plans/:planId/archive", { schema: { params: idParams("planId"), body: { type: "object", additionalProperties: false, required: ["revision"], properties: { revision: { type: "integer", minimum: 1 } } }, response: { 200: dietPlanResponse } }, handler: async (request) => serializeDietPlan(await options.nutritionService.archiveDietPlan(await userId(request), request.params.planId, request.body.revision)) });

  app.get<{ Querystring: { from: string; to: string } }>("/api/v1/nutrition/meals", { schema: { querystring: { type: "object", additionalProperties: false, required: ["from", "to"], properties: { from: { type: "string", format: "date" }, to: { type: "string", format: "date" } } }, response: { 200: { type: "array", items: mealResponse } } }, handler: async (request) => (await options.nutritionService.listMeals(await userId(request), request.query.from, request.query.to)).map(serializeMeal) });
  app.post<{ Body: MealInput }>("/api/v1/nutrition/meals", { schema: { body: mealInput, response: { 201: mealResponse } }, handler: async (request, reply) => reply.status(201).send(serializeMeal(await options.nutritionService.createMeal(await userId(request), request.body))) });
  app.put<{ Params: { mealId: string }; Body: MealInput & { revision: number } }>("/api/v1/nutrition/meals/:mealId", { schema: { params: idParams("mealId"), body: { ...mealInput, required: ["revision", ...mealInput.required], properties: { revision: { type: "integer", minimum: 1 }, ...mealInput.properties } }, response: { 200: mealResponse } }, handler: async (request) => serializeMeal(await options.nutritionService.updateMeal(await userId(request), request.params.mealId, request.body.revision, request.body)) });
  app.delete<{ Params: { mealId: string }; Querystring: { revision: number } }>("/api/v1/nutrition/meals/:mealId", { schema: { params: idParams("mealId"), querystring: revisionQuery, response: { 204: { type: "null" } } }, handler: async (request, reply) => { await options.nutritionService.deleteMeal(await userId(request), request.params.mealId, request.query.revision); return reply.status(204).send(); } });
  app.get<{ Params: { mealId: string } }>("/api/v1/nutrition/meals/:mealId/revisions", { schema: { params: idParams("mealId"), response: { 200: { type: "array", items: { type: "object", additionalProperties: true } } } }, handler: async (request) => (await options.nutritionService.listMealRevisions(await userId(request), request.params.mealId)).map((value) => ({ ...value, occurredAt: value.occurredAt.toISOString(), createdAt: value.createdAt.toISOString() })) });

  app.post<{ Params: { mealId: string }; Body: ContributionBody & { mealRevision: number } }>("/api/v1/nutrition/meals/:mealId/contributions", { schema: { params: idParams("mealId"), body: contributionMutationSchema(false), response: { 201: mealResponse } }, handler: async (request, reply) => reply.status(201).send(serializeMeal(await options.nutritionService.addContribution(await userId(request), request.params.mealId, request.body.mealRevision, request.body, request.body.replaceExisting))) });
  app.put<{ Params: { mealId: string; contributionId: string }; Body: ContributionBody & { mealRevision: number; contributionRevision: number } }>("/api/v1/nutrition/meals/:mealId/contributions/:contributionId", { schema: { params: twoIdParams, body: contributionMutationSchema(true), response: { 200: mealResponse } }, handler: async (request) => serializeMeal(await options.nutritionService.updateContribution(await userId(request), request.params.mealId, request.params.contributionId, request.body.mealRevision, request.body.contributionRevision, request.body, request.body.replaceExisting)) });
  app.delete<{ Params: { mealId: string; contributionId: string }; Querystring: { mealRevision: number; contributionRevision: number } }>("/api/v1/nutrition/meals/:mealId/contributions/:contributionId", { schema: { params: twoIdParams, querystring: { type: "object", additionalProperties: false, required: ["mealRevision", "contributionRevision"], properties: { mealRevision: { type: "integer", minimum: 1 }, contributionRevision: { type: "integer", minimum: 1 } } }, response: { 200: mealResponse } }, handler: async (request) => serializeMeal(await options.nutritionService.deleteContribution(await userId(request), request.params.mealId, request.params.contributionId, request.query.mealRevision, request.query.contributionRevision)) });
  app.get<{ Params: { mealId: string } }>("/api/v1/nutrition/meals/:mealId/contribution-revisions", { schema: { params: idParams("mealId"), response: { 200: { type: "array", items: { type: "object", additionalProperties: true } } } }, handler: async (request) => (await options.nutritionService.listContributionRevisions(await userId(request), request.params.mealId)).map((value) => ({ ...value, createdAt: value.createdAt.toISOString() })) });

  app.get<{ Querystring: { localDate: string; timeZone: string } }>("/api/v1/nutrition/day-summary", { schema: { querystring: { type: "object", additionalProperties: false, required: ["localDate", "timeZone"], properties: { localDate: { type: "string", format: "date" }, timeZone: { type: "string" } } }, response: { 200: { type: "object", additionalProperties: true } } }, handler: async (request) => { const id = await userId(request); const reference = await options.planningService.getDailyReference(id, request.query.localDate, request.query.timeZone); return options.nutritionService.getDaySummary(id, request.query.localDate, { energyKcal: reference.result.targetEnergyKcal, proteinGrams: reference.result.proteinGrams, carbohydrateGrams: reference.result.carbohydrateGrams, fatGrams: reference.result.fatGrams }); } });
  app.put<{ Body: { localDate: string; coverageConfirmed: boolean } }>(
    "/api/v1/nutrition/day-coverage",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["localDate", "coverageConfirmed"],
          properties: {
            localDate: { type: "string", format: "date" },
            coverageConfirmed: { type: "boolean" },
          },
        },
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["coverageConfirmed"],
            properties: { coverageConfirmed: { type: "boolean" } },
          },
        },
      },
      handler: async (request) => ({
        coverageConfirmed: await options.nutritionService.setCoverageConfirmed(
          await userId(request),
          request.body.localDate,
          request.body.coverageConfirmed,
        ),
      }),
    },
  );

  app.get("/api/v1/nutrition/food-templates", { schema: { response: { 200: { type: "array", items: templateResponse } } }, handler: async (request) => (await options.nutritionService.listFoodTemplates(await userId(request))).map(serializeTemplate) });
  app.get<{ Querystring: { query: string; asOfDate: string } }>("/api/v1/nutrition/food-search", { schema: { querystring: { type: "object", additionalProperties: false, required: ["query", "asOfDate"], properties: { query: { type: "string", maxLength: 100 }, asOfDate: { type: "string", format: "date" } } }, response: { 200: { type: "array", items: foodSearchResponse } } }, handler: async (request) => (await options.nutritionService.searchFoods(await userId(request), request.query.query, request.query.asOfDate)).map(serializeFoodSearch) });
  app.post<{ Body: { query: string } }>("/api/v1/nutrition/public-food-search", { schema: { body: { type: "object", additionalProperties: false, required: ["query"], properties: { query: { type: "string", minLength: 2, maxLength: 100 } } }, response: { 200: { type: "array", items: publicFoodSearchResponse } } }, handler: async (request) => { await userId(request); return (await options.nutritionService.searchPublicFoods(request.body.query)).map(serializePublicFoodSearch); } });
  app.post<{ Body: ContributionRequest }>("/api/v1/nutrition/food-templates", { schema: { body: contributionInput, response: { 201: templateResponse } }, handler: async (request, reply) => reply.status(201).send(serializeTemplate(await options.nutritionService.createFoodTemplate(await userId(request), request.body))) });
  app.put<{ Params: { templateId: string }; Body: ContributionRequest & { revision: number } }>("/api/v1/nutrition/food-templates/:templateId", { schema: { params: idParams("templateId"), body: { ...contributionInput, required: ["revision", ...contributionInput.required], properties: { revision: { type: "integer", minimum: 1 }, ...contributionInput.properties } }, response: { 200: templateResponse } }, handler: async (request) => serializeTemplate(await options.nutritionService.updateFoodTemplate(await userId(request), request.params.templateId, request.body.revision, request.body)) });
  app.delete<{ Params: { templateId: string }; Querystring: { revision: number } }>("/api/v1/nutrition/food-templates/:templateId", { schema: { params: idParams("templateId"), querystring: revisionQuery, response: { 204: { type: "null" } } }, handler: async (request, reply) => { await options.nutritionService.deleteFoodTemplate(await userId(request), request.params.templateId, request.query.revision); return reply.status(204).send(); } });
}

function idParams(name: string) { return { type: "object", additionalProperties: false, required: [name], properties: { [name]: { type: "string", format: "uuid" } } } as const; }
const twoIdParams = { type: "object", additionalProperties: false, required: ["mealId", "contributionId"], properties: { mealId: { type: "string", format: "uuid" }, contributionId: { type: "string", format: "uuid" } } } as const;
const revisionQuery = { type: "object", additionalProperties: false, required: ["revision"], properties: { revision: { type: "integer", minimum: 1 } } } as const;
function contributionMutationSchema(includeContributionRevision: boolean) { return { ...contributionInput, required: ["mealRevision", ...(includeContributionRevision ? ["contributionRevision"] : []), "replaceExisting", ...contributionInput.required], properties: { mealRevision: { type: "integer", minimum: 1 }, ...(includeContributionRevision ? { contributionRevision: { type: "integer", minimum: 1 } } : {}), replaceExisting: { type: "boolean" }, ...contributionInput.properties } } as const; }
