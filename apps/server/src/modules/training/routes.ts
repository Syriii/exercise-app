import type { FastifyInstance, FastifyRequest } from "fastify";

import type { IdentityService } from "../identity/service.js";
import { sessionCookieName } from "../identity/routes.js";
import type { TrainingService } from "./service.js";
import type {
  ExtraTrainingItemInput,
  TrainingExpenditureAssessmentInput,
  TrainingProgramInput,
  TrainingProgramUnitInput,
  TrainingScheduleInput,
  TrainingSessionItemUpdate,
  TrainingSessionStatus,
  TrainingTemplateInput,
} from "./types.js";

interface TrainingRouteOptions {
  readonly identityService: IdentityService;
  readonly trainingService: TrainingService;
}

interface RevisionBody {
  readonly revision: number;
}

interface TemplateBody extends TrainingTemplateInput {}
interface TemplateUpdateBody extends TrainingTemplateInput, RevisionBody {}
interface StartSessionBody {
  readonly templateId: string | null;
  readonly timeZone: string;
}
interface SessionItemBody extends TrainingSessionItemUpdate, RevisionBody {}
interface ExtraItemBody extends ExtraTrainingItemInput, RevisionBody {}
interface FinishSessionBody extends RevisionBody {
  readonly status: "completed" | "abandoned";
}
interface ExpenditureBody extends TrainingExpenditureAssessmentInput, RevisionBody {}
interface ProgramBody extends TrainingProgramInput {}
interface ProgramUpdateBody extends TrainingProgramInput, RevisionBody {}
interface ProgramUnitCreateBody extends TrainingProgramUnitInput, RevisionBody {
  readonly sourceTemplateId: string | null;
}
interface ProgramUnitUpdateBody extends TrainingProgramUnitInput, RevisionBody {}
interface StartProgramUnitBody {
  readonly timeZone: string;
}
interface ScheduleBody extends TrainingScheduleInput {}
interface ScheduleUpdateBody extends TrainingScheduleInput, RevisionBody {}

// Put null first: Fastify's Ajv type coercion would otherwise turn JSON null into
// an empty string or zero while evaluating the first union branch.
const nullableString = { anyOf: [{ type: "null" }, { type: "string" }] } as const;
const nullableInteger = { anyOf: [{ type: "null" }, { type: "integer" }] } as const;

const targetInputSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "exerciseName",
    "targetSets",
    "targetRepsMin",
    "targetRepsMax",
    "targetWeightKg",
    "targetDurationSeconds",
    "targetDistanceMeters",
    "note",
  ],
  properties: {
    exerciseName: { type: "string", minLength: 1, maxLength: 100 },
    targetSets: nullableInteger,
    targetRepsMin: nullableInteger,
    targetRepsMax: nullableInteger,
    targetWeightKg: nullableString,
    targetDurationSeconds: nullableInteger,
    targetDistanceMeters: nullableString,
    note: nullableString,
  },
} as const;

const setInputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["reps", "weightKg", "durationSeconds", "distanceMeters", "note"],
  properties: {
    reps: nullableInteger,
    weightKg: nullableString,
    durationSeconds: nullableInteger,
    distanceMeters: nullableString,
    note: nullableString,
  },
} as const;

export const templateBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "note", "items"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 80 },
    note: nullableString,
    items: { type: "array", minItems: 1, maxItems: 50, items: targetInputSchema },
  },
} as const;

const templateItemResponseSchema = {
  ...targetInputSchema,
  required: ["id", "sortOrder", ...targetInputSchema.required],
  properties: {
    id: { type: "string", format: "uuid" },
    sortOrder: { type: "integer" },
    ...targetInputSchema.properties,
  },
} as const;

export const templateResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "name", "note", "revision", "archivedAt", "createdAt", "updatedAt", "items"],
  properties: {
    id: { type: "string", format: "uuid" },
    name: { type: "string" },
    note: nullableString,
    revision: { type: "integer" },
    archivedAt: { anyOf: [{ type: "null" }, { type: "string", format: "date-time" }] },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
    items: { type: "array", items: templateItemResponseSchema },
  },
} as const;

const setResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "sequence", "reps", "weightKg", "durationSeconds", "distanceMeters", "note"],
  properties: {
    id: { type: "string", format: "uuid" },
    sequence: { type: "integer" },
    reps: nullableInteger,
    weightKg: nullableString,
    durationSeconds: nullableInteger,
    distanceMeters: nullableString,
    note: nullableString,
  },
} as const;

const targetResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["targetSets", "targetRepsMin", "targetRepsMax", "targetWeightKg", "targetDurationSeconds", "targetDistanceMeters", "note"],
  properties: {
    targetSets: nullableInteger,
    targetRepsMin: nullableInteger,
    targetRepsMax: nullableInteger,
    targetWeightKg: nullableString,
    targetDurationSeconds: nullableInteger,
    targetDistanceMeters: nullableString,
    note: nullableString,
  },
} as const;

const sessionItemResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "sourceTemplateItemId", "origin", "status", "sortOrder", "exerciseName", "performedExerciseName", "target", "actualNote", "sets"],
  properties: {
    id: { type: "string", format: "uuid" },
    sourceTemplateItemId: { anyOf: [{ type: "null" }, { type: "string", format: "uuid" }] },
    origin: { type: "string", enum: ["planned", "extra"] },
    status: { type: "string", enum: ["pending", "completed", "skipped"] },
    sortOrder: { type: "integer" },
    exerciseName: { type: "string" },
    performedExerciseName: nullableString,
    target: targetResponseSchema,
    actualNote: nullableString,
    sets: { type: "array", items: setResponseSchema },
  },
} as const;

const expenditureActivityResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["code", "label", "description", "met", "intensity"],
  properties: {
    code: { type: "string", enum: ["barbell_bench_25rm", "barbell_bench_12rm", "dumbbell_squat_25rm", "dumbbell_squat_12rm", "combined_upper_25rm", "combined_upper_12rm"] },
    label: { type: "string" },
    description: { type: "string" },
    met: { type: "number" },
    intensity: { type: "string", enum: ["moderate", "vigorous"] },
  },
} as const;

const expenditureAssessmentResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "inputSnapshot", "activityLabel", "activityDescription", "met", "grossEnergyKcal", "netEnergyKcal", "methodVersion", "evidenceIds", "formula", "messages", "limitations", "assessedAt"],
  properties: {
    status: { type: "string", enum: ["estimated", "unavailable"] },
    inputSnapshot: {
      type: "object",
      additionalProperties: false,
      required: ["sessionId", "sessionRevision", "localDate", "activityCode", "durationMinutes", "profileRevision", "weightMeasurement"],
      properties: {
        sessionId: { type: "string", format: "uuid" },
        sessionRevision: { type: "integer" },
        localDate: { type: "string", format: "date" },
        activityCode: { anyOf: [{ type: "null" }, { type: "string", enum: ["barbell_bench_25rm", "barbell_bench_12rm", "dumbbell_squat_25rm", "dumbbell_squat_12rm", "combined_upper_25rm", "combined_upper_12rm"] }] },
        durationMinutes: nullableInteger,
        profileRevision: { type: "integer" },
        weightMeasurement: {
          anyOf: [
            { type: "null" },
            {
              type: "object",
              additionalProperties: false,
              required: ["id", "revision", "localDate", "weightKg"],
              properties: {
                id: { type: "string", format: "uuid" },
                revision: { type: "integer" },
                localDate: { type: "string", format: "date" },
                weightKg: { type: "number" },
              },
            },
          ],
        },
      },
    },
    activityLabel: nullableString,
    activityDescription: nullableString,
    met: { anyOf: [{ type: "null" }, { type: "number" }] },
    grossEnergyKcal: { anyOf: [{ type: "null" }, { type: "number" }] },
    netEnergyKcal: { anyOf: [{ type: "null" }, { type: "number" }] },
    methodVersion: { type: "string", const: "training-expenditure-e003-v1" },
    evidenceIds: { type: "array", items: { type: "string" } },
    formula: { type: "string" },
    messages: { type: "array", items: { type: "string" } },
    limitations: { type: "array", items: { type: "string" } },
    assessedAt: { type: "string", format: "date-time" },
  },
} as const;

const nullableExpenditureAssessmentResponseSchema = {
  anyOf: [{ type: "null" }, expenditureAssessmentResponseSchema],
} as const;

const sessionResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "sourceScheduleId", "sourceScheduleTitle", "sourceTemplateId", "sourceTemplateName", "sourceProgramId", "sourceProgramName", "sourceProgramUnitId", "sourceWeekNumber", "sourceTrainingDayName", "status", "revision", "timeZone", "localDate", "startedAt", "endedAt", "note", "expenditureAssessment", "createdAt", "updatedAt", "items"],
  properties: {
    id: { type: "string", format: "uuid" },
    sourceScheduleId: { anyOf: [{ type: "null" }, { type: "string", format: "uuid" }] },
    sourceScheduleTitle: nullableString,
    sourceTemplateId: { anyOf: [{ type: "null" }, { type: "string", format: "uuid" }] },
    sourceTemplateName: nullableString,
    sourceProgramId: { anyOf: [{ type: "null" }, { type: "string", format: "uuid" }] },
    sourceProgramName: nullableString,
    sourceProgramUnitId: { anyOf: [{ type: "null" }, { type: "string", format: "uuid" }] },
    sourceWeekNumber: nullableInteger,
    sourceTrainingDayName: nullableString,
    status: { type: "string", enum: ["in_progress", "completed", "abandoned"] },
    revision: { type: "integer" },
    timeZone: { type: "string" },
    localDate: { type: "string", format: "date" },
    startedAt: { type: "string", format: "date-time" },
    endedAt: { anyOf: [{ type: "null" }, { type: "string", format: "date-time" }] },
    note: nullableString,
    expenditureAssessment: nullableExpenditureAssessmentResponseSchema,
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
    items: { type: "array", items: sessionItemResponseSchema },
  },
} as const;

const sessionItemRevisionResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "sessionId", "sessionItemId", "sessionRevision", "status", "performedExerciseName", "actualNote", "sets", "createdAt"],
  properties: {
    id: { type: "string", format: "uuid" },
    sessionId: { type: "string", format: "uuid" },
    sessionItemId: { type: "string", format: "uuid" },
    sessionRevision: { type: "integer" },
    status: { type: "string", enum: ["pending", "completed", "skipped"] },
    performedExerciseName: nullableString,
    actualNote: nullableString,
    sets: { type: "array", items: setResponseSchema },
    createdAt: { type: "string", format: "date-time" },
  },
} as const;

const sessionRevisionResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "sessionId", "sessionRevision", "localDate", "timeZone", "note", "expenditureAssessment", "createdAt"],
  properties: {
    id: { type: "string", format: "uuid" },
    sessionId: { type: "string", format: "uuid" },
    sessionRevision: { type: "integer" },
    localDate: { type: "string", format: "date" },
    timeZone: { type: "string" },
    note: nullableString,
    expenditureAssessment: nullableExpenditureAssessmentResponseSchema,
    createdAt: { type: "string", format: "date-time" },
  },
} as const;

const exerciseGuidanceResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "exerciseName", "aliases", "overview", "steps", "commonMistakes", "alternatives", "videoUrl", "sourceName", "sourceUrl", "license", "version", "reviewStatus", "limitations"],
  properties: {
    id: { type: "string" },
    exerciseName: { type: "string" },
    aliases: { type: "array", items: { type: "string" } },
    overview: { type: "string" },
    steps: { type: "array", items: { type: "string" } },
    commonMistakes: { type: "array", items: { type: "string" } },
    alternatives: { type: "array", items: { type: "string" } },
    videoUrl: nullableString,
    sourceName: { type: "string" },
    sourceUrl: nullableString,
    license: { type: "string" },
    version: { type: "string" },
    reviewStatus: { type: "string", enum: ["draft", "reviewed"] },
    limitations: { type: "string" },
  },
} as const;

const scheduleBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["localDate", "timeZone", "title", "note", "sourceTemplateId", "sourceProgramId", "sourceProgramUnitId"],
  properties: {
    localDate: { type: "string", format: "date" },
    timeZone: { type: "string", minLength: 1, maxLength: 100 },
    title: { type: "string", maxLength: 80 },
    note: nullableString,
    sourceTemplateId: { anyOf: [{ type: "null" }, { type: "string", format: "uuid" }] },
    sourceProgramId: { anyOf: [{ type: "null" }, { type: "string", format: "uuid" }] },
    sourceProgramUnitId: { anyOf: [{ type: "null" }, { type: "string", format: "uuid" }] },
  },
} as const;

const scheduleResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "localDate", "timeZone", "title", "note", "sourceTemplateId", "sourceTemplateName", "sourceProgramId", "sourceProgramName", "sourceProgramUnitId", "sourceWeekNumber", "sourceTrainingDayName", "status", "revision", "cancelledAt", "startedSessionId", "createdAt", "updatedAt"],
  properties: {
    id: { type: "string", format: "uuid" },
    localDate: { type: "string", format: "date" },
    timeZone: { type: "string" },
    title: { type: "string" },
    note: nullableString,
    sourceTemplateId: { anyOf: [{ type: "null" }, { type: "string", format: "uuid" }] },
    sourceTemplateName: nullableString,
    sourceProgramId: { anyOf: [{ type: "null" }, { type: "string", format: "uuid" }] },
    sourceProgramName: nullableString,
    sourceProgramUnitId: { anyOf: [{ type: "null" }, { type: "string", format: "uuid" }] },
    sourceWeekNumber: nullableInteger,
    sourceTrainingDayName: nullableString,
    status: { type: "string", enum: ["scheduled", "cancelled", "started"] },
    revision: { type: "integer" },
    cancelledAt: { anyOf: [{ type: "null" }, { type: "string", format: "date-time" }] },
    startedSessionId: { anyOf: [{ type: "null" }, { type: "string", format: "uuid" }] },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
} as const;

const programBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "note", "weekCount"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 80 },
    note: nullableString,
    weekCount: { type: "integer", minimum: 1, maximum: 52 },
  },
} as const;

const programUnitResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "weekNumber", "sortOrder", "name", "note", "sourceTemplateId", "sourceTemplateName", "sourceTemplateRevision", "importedAt", "started", "createdAt", "updatedAt", "items"],
  properties: {
    id: { type: "string", format: "uuid" },
    weekNumber: { type: "integer" },
    sortOrder: { type: "integer" },
    name: { type: "string" },
    note: nullableString,
    sourceTemplateId: { anyOf: [{ type: "null" }, { type: "string", format: "uuid" }] },
    sourceTemplateName: nullableString,
    sourceTemplateRevision: nullableInteger,
    importedAt: { anyOf: [{ type: "null" }, { type: "string", format: "date-time" }] },
    started: { type: "boolean" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
    items: { type: "array", items: templateItemResponseSchema },
  },
} as const;

const programResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "name", "note", "weekCount", "revision", "archivedAt", "createdAt", "updatedAt", "units"],
  properties: {
    id: { type: "string", format: "uuid" },
    name: { type: "string" },
    note: nullableString,
    weekCount: { type: "integer" },
    revision: { type: "integer" },
    archivedAt: { anyOf: [{ type: "null" }, { type: "string", format: "date-time" }] },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
    units: { type: "array", items: programUnitResponseSchema },
  },
} as const;

function publicTemplate(template: Awaited<ReturnType<TrainingService["createTemplate"]>>) {
  const { userId: _userId, ...result } = template;
  return result;
}

function publicSession(session: Awaited<ReturnType<TrainingService["getSession"]>>) {
  const { userId: _userId, ...result } = session;
  return result;
}

function publicProgram(program: Awaited<ReturnType<TrainingService["getProgram"]>>) {
  const { userId: _userId, ...result } = program;
  return result;
}

function publicSchedule(schedule: Awaited<ReturnType<TrainingService["createSchedule"]>>) {
  const { userId: _userId, ...result } = schedule;
  return result;
}

export async function registerTrainingRoutes(app: FastifyInstance, options: TrainingRouteOptions): Promise<void> {
  const { identityService, trainingService } = options;

  async function userId(request: FastifyRequest): Promise<string> {
    return (await identityService.authenticate(request.cookies[sessionCookieName])).id;
  }

  app.get<{ Querystring: { exerciseName: string } }>("/api/v1/training/guidance", {
    schema: {
      querystring: { type: "object", additionalProperties: false, required: ["exerciseName"], properties: { exerciseName: { type: "string", minLength: 1, maxLength: 100 } } },
      response: { 200: { anyOf: [{ type: "null" }, exerciseGuidanceResponseSchema] } },
    },
    handler: async (request) => {
      await userId(request);
      return trainingService.getExerciseGuidance(request.query.exerciseName);
    },
  });

  app.get("/api/v1/training/expenditure-catalog", {
    schema: { response: { 200: { type: "array", items: expenditureActivityResponseSchema } } },
    handler: async (request) => {
      await userId(request);
      return trainingService.listExpenditureActivities();
    },
  });

  app.get<{ Querystring: { includeArchived?: string } }>("/api/v1/training/templates", {
    schema: {
      querystring: {
        type: "object",
        additionalProperties: false,
        properties: { includeArchived: { type: "string", enum: ["true", "false"] } },
      },
      response: { 200: { type: "array", items: templateResponseSchema } },
    },
    handler: async (request) =>
      (await trainingService.listTemplates(await userId(request), request.query.includeArchived === "true")).map(publicTemplate),
  });

  app.post<{ Body: TemplateBody }>("/api/v1/training/templates", {
    schema: { body: templateBodySchema, response: { 201: templateResponseSchema } },
    handler: async (request, reply) =>
      reply.status(201).send(publicTemplate(await trainingService.createTemplate(await userId(request), request.body))),
  });

  app.put<{ Params: { templateId: string }; Body: TemplateUpdateBody }>("/api/v1/training/templates/:templateId", {
    schema: {
      params: { type: "object", additionalProperties: false, required: ["templateId"], properties: { templateId: { type: "string", format: "uuid" } } },
      body: { ...templateBodySchema, required: ["revision", ...templateBodySchema.required], properties: { revision: { type: "integer", minimum: 1 }, ...templateBodySchema.properties } },
      response: { 200: templateResponseSchema },
    },
    handler: async (request) => publicTemplate(await trainingService.updateTemplate(await userId(request), request.params.templateId, request.body.revision, request.body)),
  });

  app.post<{ Params: { templateId: string }; Body: RevisionBody }>("/api/v1/training/templates/:templateId/archive", {
    schema: {
      params: { type: "object", additionalProperties: false, required: ["templateId"], properties: { templateId: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["revision"], properties: { revision: { type: "integer", minimum: 1 } } },
      response: { 200: templateResponseSchema },
    },
    handler: async (request) => publicTemplate(await trainingService.archiveTemplate(await userId(request), request.params.templateId, request.body.revision)),
  });

  app.get<{ Querystring: { includeArchived?: string } }>("/api/v1/training/programs", {
    schema: {
      querystring: {
        type: "object",
        additionalProperties: false,
        properties: { includeArchived: { type: "string", enum: ["true", "false"] } },
      },
      response: { 200: { type: "array", items: programResponseSchema } },
    },
    handler: async (request) =>
      (await trainingService.listPrograms(await userId(request), request.query.includeArchived === "true")).map(publicProgram),
  });

  app.post<{ Body: ProgramBody }>("/api/v1/training/programs", {
    schema: { body: programBodySchema, response: { 201: programResponseSchema } },
    handler: async (request, reply) =>
      reply.status(201).send(publicProgram(await trainingService.createProgram(await userId(request), request.body))),
  });

  app.put<{ Params: { programId: string }; Body: ProgramUpdateBody }>("/api/v1/training/programs/:programId", {
    schema: {
      params: { type: "object", additionalProperties: false, required: ["programId"], properties: { programId: { type: "string", format: "uuid" } } },
      body: { ...programBodySchema, required: ["revision", ...programBodySchema.required], properties: { revision: { type: "integer", minimum: 1 }, ...programBodySchema.properties } },
      response: { 200: programResponseSchema },
    },
    handler: async (request) => publicProgram(await trainingService.updateProgram(await userId(request), request.params.programId, request.body.revision, request.body)),
  });

  app.post<{ Params: { programId: string }; Body: RevisionBody }>("/api/v1/training/programs/:programId/archive", {
    schema: {
      params: { type: "object", additionalProperties: false, required: ["programId"], properties: { programId: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["revision"], properties: { revision: { type: "integer", minimum: 1 } } },
      response: { 200: programResponseSchema },
    },
    handler: async (request) => publicProgram(await trainingService.archiveProgram(await userId(request), request.params.programId, request.body.revision)),
  });

  app.post<{ Params: { programId: string }; Body: ProgramUnitCreateBody }>("/api/v1/training/programs/:programId/units", {
    schema: {
      params: { type: "object", additionalProperties: false, required: ["programId"], properties: { programId: { type: "string", format: "uuid" } } },
      body: {
        type: "object",
        additionalProperties: false,
        required: ["revision", "weekNumber", "name", "note", "sourceTemplateId", "items"],
        properties: {
          revision: { type: "integer", minimum: 1 },
          weekNumber: { type: "integer", minimum: 1, maximum: 52 },
          name: { type: "string", maxLength: 80 },
          note: nullableString,
          sourceTemplateId: { anyOf: [{ type: "null" }, { type: "string", format: "uuid" }] },
          items: { type: "array", maxItems: 50, items: targetInputSchema },
        },
      },
      response: { 201: programResponseSchema },
    },
    handler: async (request, reply) => reply.status(201).send(publicProgram(await trainingService.addProgramUnit(await userId(request), request.params.programId, request.body.revision, request.body, request.body.sourceTemplateId))),
  });

  app.put<{ Params: { programId: string; unitId: string }; Body: ProgramUnitUpdateBody }>("/api/v1/training/programs/:programId/units/:unitId", {
    schema: {
      params: { type: "object", additionalProperties: false, required: ["programId", "unitId"], properties: { programId: { type: "string", format: "uuid" }, unitId: { type: "string", format: "uuid" } } },
      body: {
        type: "object",
        additionalProperties: false,
        required: ["revision", "weekNumber", "name", "note", "items"],
        properties: {
          revision: { type: "integer", minimum: 1 },
          weekNumber: { type: "integer", minimum: 1, maximum: 52 },
          name: { type: "string", minLength: 1, maxLength: 80 },
          note: nullableString,
          items: { type: "array", minItems: 1, maxItems: 50, items: targetInputSchema },
        },
      },
      response: { 200: programResponseSchema },
    },
    handler: async (request) => publicProgram(await trainingService.updateProgramUnit(await userId(request), request.params.programId, request.params.unitId, request.body.revision, request.body)),
  });

  app.post<{ Params: { programId: string; unitId: string }; Body: RevisionBody }>("/api/v1/training/programs/:programId/units/:unitId/reimport", {
    schema: {
      params: { type: "object", additionalProperties: false, required: ["programId", "unitId"], properties: { programId: { type: "string", format: "uuid" }, unitId: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["revision"], properties: { revision: { type: "integer", minimum: 1 } } },
      response: { 200: programResponseSchema },
    },
    handler: async (request) => publicProgram(await trainingService.reimportProgramUnit(await userId(request), request.params.programId, request.params.unitId, request.body.revision)),
  });

  app.post<{ Params: { programId: string; unitId: string }; Body: StartProgramUnitBody }>("/api/v1/training/programs/:programId/units/:unitId/start", {
    schema: {
      params: { type: "object", additionalProperties: false, required: ["programId", "unitId"], properties: { programId: { type: "string", format: "uuid" }, unitId: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["timeZone"], properties: { timeZone: { type: "string", minLength: 1, maxLength: 100 } } },
      response: { 201: sessionResponseSchema },
    },
    handler: async (request, reply) => reply.status(201).send(publicSession(await trainingService.startProgramSession(await userId(request), request.params.programId, request.params.unitId, request.body.timeZone))),
  });

  app.get<{ Querystring: { dateFrom?: string; dateTo?: string } }>("/api/v1/training/schedules", {
    schema: {
      querystring: {
        type: "object",
        additionalProperties: false,
        properties: {
          dateFrom: { type: "string", format: "date" },
          dateTo: { type: "string", format: "date" },
        },
      },
      response: { 200: { type: "array", items: scheduleResponseSchema } },
    },
    handler: async (request) =>
      (await trainingService.listSchedules(await userId(request), request.query.dateFrom, request.query.dateTo)).map(publicSchedule),
  });

  app.post<{ Body: ScheduleBody }>("/api/v1/training/schedules", {
    schema: { body: scheduleBodySchema, response: { 201: scheduleResponseSchema } },
    handler: async (request, reply) =>
      reply.status(201).send(publicSchedule(await trainingService.createSchedule(await userId(request), request.body))),
  });

  app.put<{ Params: { scheduleId: string }; Body: ScheduleUpdateBody }>("/api/v1/training/schedules/:scheduleId", {
    schema: {
      params: { type: "object", additionalProperties: false, required: ["scheduleId"], properties: { scheduleId: { type: "string", format: "uuid" } } },
      body: { ...scheduleBodySchema, required: ["revision", ...scheduleBodySchema.required], properties: { revision: { type: "integer", minimum: 1 }, ...scheduleBodySchema.properties } },
      response: { 200: scheduleResponseSchema },
    },
    handler: async (request) =>
      publicSchedule(await trainingService.updateSchedule(await userId(request), request.params.scheduleId, request.body.revision, request.body)),
  });

  app.post<{ Params: { scheduleId: string }; Body: RevisionBody }>("/api/v1/training/schedules/:scheduleId/cancel", {
    schema: {
      params: { type: "object", additionalProperties: false, required: ["scheduleId"], properties: { scheduleId: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["revision"], properties: { revision: { type: "integer", minimum: 1 } } },
      response: { 200: scheduleResponseSchema },
    },
    handler: async (request) =>
      publicSchedule(await trainingService.cancelSchedule(await userId(request), request.params.scheduleId, request.body.revision)),
  });

  app.post<{ Params: { scheduleId: string } }>("/api/v1/training/schedules/:scheduleId/start", {
    schema: {
      params: { type: "object", additionalProperties: false, required: ["scheduleId"], properties: { scheduleId: { type: "string", format: "uuid" } } },
      response: { 201: sessionResponseSchema },
    },
    handler: async (request, reply) =>
      reply.status(201).send(publicSession(await trainingService.startScheduledSession(await userId(request), request.params.scheduleId))),
  });

  app.get<{ Querystring: { status?: TrainingSessionStatus; dateFrom?: string; dateTo?: string } }>("/api/v1/training/sessions", {
    schema: {
      querystring: { type: "object", additionalProperties: false, properties: { status: { type: "string", enum: ["in_progress", "completed", "abandoned"] }, dateFrom: { type: "string", format: "date" }, dateTo: { type: "string", format: "date" } } },
      response: { 200: { type: "array", items: sessionResponseSchema } },
    },
    handler: async (request) => (await trainingService.listSessions(await userId(request), request.query)).map(publicSession),
  });

  app.post<{ Body: StartSessionBody }>("/api/v1/training/sessions", {
    schema: {
      body: { type: "object", additionalProperties: false, required: ["templateId", "timeZone"], properties: { templateId: { anyOf: [{ type: "null" }, { type: "string", format: "uuid" }] }, timeZone: { type: "string", minLength: 1, maxLength: 100 } } },
      response: { 201: sessionResponseSchema },
    },
    handler: async (request, reply) => reply.status(201).send(publicSession(await trainingService.startSession(await userId(request), request.body.templateId, request.body.timeZone))),
  });

  app.get<{ Params: { sessionId: string } }>("/api/v1/training/sessions/:sessionId", {
    schema: {
      params: { type: "object", additionalProperties: false, required: ["sessionId"], properties: { sessionId: { type: "string", format: "uuid" } } },
      response: { 200: sessionResponseSchema },
    },
    handler: async (request) => publicSession(await trainingService.getSession(await userId(request), request.params.sessionId)),
  });

  app.get<{ Params: { sessionId: string } }>("/api/v1/training/sessions/:sessionId/item-revisions", {
    schema: {
      params: { type: "object", additionalProperties: false, required: ["sessionId"], properties: { sessionId: { type: "string", format: "uuid" } } },
      response: { 200: { type: "array", items: sessionItemRevisionResponseSchema } },
    },
    handler: async (request) => (await trainingService.listSessionItemRevisions(await userId(request), request.params.sessionId)).map((revision) => ({
      ...revision,
      createdAt: revision.createdAt.toISOString(),
    })),
  });

  app.get<{ Params: { sessionId: string } }>("/api/v1/training/sessions/:sessionId/revisions", {
    schema: {
      params: { type: "object", additionalProperties: false, required: ["sessionId"], properties: { sessionId: { type: "string", format: "uuid" } } },
      response: { 200: { type: "array", items: sessionRevisionResponseSchema } },
    },
    handler: async (request) => (await trainingService.listSessionRevisions(await userId(request), request.params.sessionId)).map((revision) => ({
      ...revision,
      createdAt: revision.createdAt.toISOString(),
    })),
  });

  app.put<{ Params: { sessionId: string }; Body: { revision: number; localDate: string; note: string | null } }>("/api/v1/training/sessions/:sessionId", {
    schema: {
      params: { type: "object", additionalProperties: false, required: ["sessionId"], properties: { sessionId: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["revision", "localDate", "note"], properties: { revision: { type: "integer", minimum: 1 }, localDate: { type: "string", format: "date" }, note: nullableString } },
      response: { 200: sessionResponseSchema },
    },
    handler: async (request) => publicSession(await trainingService.updateSessionMetadata(await userId(request), request.params.sessionId, request.body.revision, request.body)),
  });

  app.put<{ Params: { sessionId: string }; Body: ExpenditureBody }>("/api/v1/training/sessions/:sessionId/expenditure", {
    schema: {
      params: { type: "object", additionalProperties: false, required: ["sessionId"], properties: { sessionId: { type: "string", format: "uuid" } } },
      body: {
        type: "object",
        additionalProperties: false,
        required: ["revision", "activityCode", "durationMinutes"],
        properties: {
          revision: { type: "integer", minimum: 1 },
          activityCode: { anyOf: [{ type: "null" }, { type: "string", enum: ["barbell_bench_25rm", "barbell_bench_12rm", "dumbbell_squat_25rm", "dumbbell_squat_12rm", "combined_upper_25rm", "combined_upper_12rm"] }] },
          durationMinutes: nullableInteger,
        },
      },
      response: { 200: sessionResponseSchema },
    },
    handler: async (request) => publicSession(await trainingService.assessSessionExpenditure(await userId(request), request.params.sessionId, request.body.revision, request.body)),
  });

  app.put<{ Params: { sessionId: string; itemId: string }; Body: SessionItemBody }>("/api/v1/training/sessions/:sessionId/items/:itemId", {
    schema: {
      params: { type: "object", additionalProperties: false, required: ["sessionId", "itemId"], properties: { sessionId: { type: "string", format: "uuid" }, itemId: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["revision", "status", "performedExerciseName", "actualNote", "sets"], properties: { revision: { type: "integer", minimum: 1 }, status: { type: "string", enum: ["pending", "completed", "skipped"] }, performedExerciseName: nullableString, actualNote: nullableString, sets: { type: "array", maxItems: 100, items: setInputSchema } } },
      response: { 200: sessionResponseSchema },
    },
    handler: async (request) => publicSession(await trainingService.updateSessionItem(await userId(request), request.params.sessionId, request.params.itemId, request.body.revision, request.body)),
  });

  app.post<{ Params: { sessionId: string }; Body: ExtraItemBody }>("/api/v1/training/sessions/:sessionId/items", {
    schema: {
      params: { type: "object", additionalProperties: false, required: ["sessionId"], properties: { sessionId: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["revision", "exerciseName", "actualNote", "sets"], properties: { revision: { type: "integer", minimum: 1 }, exerciseName: { type: "string", minLength: 1, maxLength: 100 }, actualNote: nullableString, sets: { type: "array", maxItems: 100, items: setInputSchema } } },
      response: { 201: sessionResponseSchema },
    },
    handler: async (request, reply) => reply.status(201).send(publicSession(await trainingService.addExtraSessionItem(await userId(request), request.params.sessionId, request.body.revision, request.body))),
  });

  app.post<{ Params: { sessionId: string }; Body: FinishSessionBody }>("/api/v1/training/sessions/:sessionId/finish", {
    schema: {
      params: { type: "object", additionalProperties: false, required: ["sessionId"], properties: { sessionId: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["revision", "status"], properties: { revision: { type: "integer", minimum: 1 }, status: { type: "string", enum: ["completed", "abandoned"] } } },
      response: { 200: sessionResponseSchema },
    },
    handler: async (request) => publicSession(await trainingService.finishSession(await userId(request), request.params.sessionId, request.body.revision, request.body.status)),
  });
}
