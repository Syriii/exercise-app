import type { FastifyInstance, FastifyRequest } from "fastify";

import { sessionCookieName } from "../identity/routes.js";
import type { IdentityService } from "../identity/service.js";
import type { ReminderService } from "./service.js";

const settingsResponse = {
  type: "object",
  additionalProperties: false,
  required: ["enabled", "localTime", "timeZone", "revision", "updatedAt"],
  properties: {
    enabled: { type: "boolean" },
    localTime: { type: "string" },
    timeZone: { type: "string" },
    revision: { type: "integer" },
    updatedAt: { anyOf: [{ type: "null" }, { type: "string", format: "date-time" }] },
  },
} as const;

const dayStateResponse = {
  type: "object",
  additionalProperties: false,
  required: ["localDate", "status", "snoozedUntil"],
  properties: {
    localDate: { type: "string", format: "date" },
    status: { type: "string", enum: ["snoozed", "dismissed"] },
    snoozedUntil: { anyOf: [{ type: "null" }, { type: "string", format: "date-time" }] },
  },
} as const;

export async function registerReminderRoutes(app: FastifyInstance, options: {
  readonly identityService: IdentityService;
  readonly reminderService: ReminderService;
}): Promise<void> {
  async function userId(request: FastifyRequest): Promise<string> {
    return (await options.identityService.authenticate(request.cookies[sessionCookieName])).id;
  }

  app.get<{ Querystring: { timeZone: string } }>("/api/v1/reminders/training/settings", {
    schema: {
      querystring: { type: "object", additionalProperties: false, required: ["timeZone"], properties: { timeZone: { type: "string", minLength: 1, maxLength: 100 } } },
      response: { 200: settingsResponse },
    },
    handler: async (request) => {
      const settings = await options.reminderService.getTrainingSettings(await userId(request), request.query.timeZone);
      return { ...settings, updatedAt: settings.updatedAt?.toISOString() ?? null };
    },
  });

  app.put<{ Body: { revision: number; enabled: boolean; localTime: string; timeZone: string } }>("/api/v1/reminders/training/settings", {
    schema: {
      body: { type: "object", additionalProperties: false, required: ["revision", "enabled", "localTime", "timeZone"], properties: { revision: { type: "integer", minimum: 0 }, enabled: { type: "boolean" }, localTime: { type: "string", pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$" }, timeZone: { type: "string", minLength: 1, maxLength: 100 } } },
      response: { 200: settingsResponse },
    },
    handler: async (request) => {
      const { revision, ...input } = request.body;
      const settings = await options.reminderService.updateTrainingSettings(await userId(request), revision, input);
      return { ...settings, updatedAt: settings.updatedAt?.toISOString() ?? null };
    },
  });

  app.get<{ Querystring: { localDate: string; timeZone: string } }>("/api/v1/reminders/training/status", {
    schema: {
      querystring: { type: "object", additionalProperties: false, required: ["localDate", "timeZone"], properties: { localDate: { type: "string", format: "date" }, timeZone: { type: "string", minLength: 1, maxLength: 100 } } },
      response: { 200: { type: "object", additionalProperties: false, required: ["state", "scheduleCount", "nextAt"], properties: { state: { type: "string", enum: ["disabled", "none_scheduled", "not_due", "due", "snoozed", "dismissed"] }, scheduleCount: { type: "integer" }, nextAt: { anyOf: [{ type: "null" }, { type: "string", format: "date-time" }] } } } },
    },
    handler: async (request) => {
      const status = await options.reminderService.getTrainingStatus(await userId(request), request.query.localDate, request.query.timeZone);
      return { ...status, nextAt: status.nextAt?.toISOString() ?? null };
    },
  });

  app.post<{ Body: { localDate: string; minutes: number } }>("/api/v1/reminders/training/snooze", {
    schema: {
      body: { type: "object", additionalProperties: false, required: ["localDate", "minutes"], properties: { localDate: { type: "string", format: "date" }, minutes: { type: "integer", minimum: 15, maximum: 1440 } } },
      response: { 200: dayStateResponse },
    },
    handler: async (request) => {
      const state = await options.reminderService.snoozeTraining(await userId(request), request.body.localDate, request.body.minutes);
      return { ...state, snoozedUntil: state.snoozedUntil?.toISOString() ?? null };
    },
  });

  app.post<{ Body: { localDate: string } }>("/api/v1/reminders/training/dismiss", {
    schema: {
      body: { type: "object", additionalProperties: false, required: ["localDate"], properties: { localDate: { type: "string", format: "date" } } },
      response: { 200: dayStateResponse },
    },
    handler: async (request) => {
      const state = await options.reminderService.dismissTraining(await userId(request), request.body.localDate);
      return { ...state, snoozedUntil: null };
    },
  });

  for (const kind of ["nutrition", "measurement"] as const) {
    app.get<{ Querystring: { timeZone: string } }>(`/api/v1/reminders/${kind}/settings`, {
      schema: {
        querystring: { type: "object", additionalProperties: false, required: ["timeZone"], properties: { timeZone: { type: "string", minLength: 1, maxLength: 100 } } },
        response: { 200: kind === "nutrition" ? settingsResponse : measurementSettingsResponse },
      },
      handler: async (request) => {
        const id = await userId(request);
        const settings = kind === "nutrition" ? await options.reminderService.getNutritionSettings(id, request.query.timeZone) : await options.reminderService.getMeasurementSettings(id, request.query.timeZone);
        return { ...settings, updatedAt: settings.updatedAt?.toISOString() ?? null };
      },
    });
  }

  app.put<{ Body: { revision: number; enabled: boolean; localTime: string; timeZone: string } }>("/api/v1/reminders/nutrition/settings", {
    schema: { body: settingsBody, response: { 200: settingsResponse } },
    handler: async (request) => { const { revision, ...input } = request.body; const settings = await options.reminderService.updateNutritionSettings(await userId(request), revision, input); return { ...settings, updatedAt: settings.updatedAt?.toISOString() ?? null }; },
  });

  app.put<{ Body: { revision: number; enabled: boolean; intervalDays: number; localTime: string; timeZone: string } }>("/api/v1/reminders/measurement/settings", {
    schema: { body: { ...settingsBody, required: [...settingsBody.required, "intervalDays"], properties: { ...settingsBody.properties, intervalDays: { type: "integer", minimum: 1, maximum: 365 } } }, response: { 200: measurementSettingsResponse } },
    handler: async (request) => { const { revision, ...input } = request.body; const settings = await options.reminderService.updateMeasurementSettings(await userId(request), revision, input); return { ...settings, updatedAt: settings.updatedAt?.toISOString() ?? null }; },
  });

  app.get<{ Querystring: { localDate: string; timeZone: string } }>("/api/v1/reminders/nutrition/status", {
    schema: { querystring: statusQuery, response: { 200: { type: "object", additionalProperties: false, required: ["state", "reason", "mealCount", "nextAt"], properties: { state: { type: "string", enum: ["disabled", "not_due", "due", "snoozed", "dismissed"] }, reason: { anyOf: [{ type: "null" }, { type: "string", enum: ["no_meals", "incomplete", "remaining", "over_target"] }] }, mealCount: { type: "integer" }, nextAt: nullableDateTime } } } },
    handler: async (request) => { const status = await options.reminderService.getNutritionStatus(await userId(request), request.query.localDate, request.query.timeZone); return { ...status, nextAt: status.nextAt?.toISOString() ?? null }; },
  });

  app.get<{ Querystring: { localDate: string; timeZone: string } }>("/api/v1/reminders/measurement/status", {
    schema: { querystring: statusQuery, response: { 200: { type: "object", additionalProperties: false, required: ["state", "latestMeasurementDate", "nextDueDate", "nextAt"], properties: { state: { type: "string", enum: ["disabled", "not_due", "due", "snoozed", "dismissed"] }, latestMeasurementDate: { anyOf: [{ type: "null" }, { type: "string", format: "date" }] }, nextDueDate: { anyOf: [{ type: "null" }, { type: "string", format: "date" }] }, nextAt: nullableDateTime } } } },
    handler: async (request) => { const status = await options.reminderService.getMeasurementStatus(await userId(request), request.query.localDate, request.query.timeZone); return { ...status, nextAt: status.nextAt?.toISOString() ?? null }; },
  });

  for (const kind of ["nutrition", "measurement"] as const) {
    app.post<{ Body: { localDate: string; minutes: number } }>(`/api/v1/reminders/${kind}/snooze`, {
      schema: { body: snoozeBody, response: { 200: dayStateResponse } },
      handler: async (request) => { const id = await userId(request); const state = kind === "nutrition" ? await options.reminderService.snoozeNutrition(id, request.body.localDate, request.body.minutes) : await options.reminderService.snoozeMeasurement(id, request.body.localDate, request.body.minutes); return { ...state, snoozedUntil: state.snoozedUntil?.toISOString() ?? null }; },
    });
    app.post<{ Body: { localDate: string } }>(`/api/v1/reminders/${kind}/dismiss`, {
      schema: { body: dismissBody, response: { 200: dayStateResponse } },
      handler: async (request) => { const id = await userId(request); const state = kind === "nutrition" ? await options.reminderService.dismissNutrition(id, request.body.localDate) : await options.reminderService.dismissMeasurement(id, request.body.localDate); return { ...state, snoozedUntil: null }; },
    });
  }
}

const nullableDateTime = { anyOf: [{ type: "null" }, { type: "string", format: "date-time" }] } as const;
const settingsBody = { type: "object", additionalProperties: false, required: ["revision", "enabled", "localTime", "timeZone"], properties: { revision: { type: "integer", minimum: 0 }, enabled: { type: "boolean" }, localTime: { type: "string", pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$" }, timeZone: { type: "string", minLength: 1, maxLength: 100 } } } as const;
const measurementSettingsResponse = { type: "object", additionalProperties: false, required: [...settingsResponse.required, "intervalDays"], properties: { ...settingsResponse.properties, intervalDays: { type: "integer" } } } as const;
const statusQuery = { type: "object", additionalProperties: false, required: ["localDate", "timeZone"], properties: { localDate: { type: "string", format: "date" }, timeZone: { type: "string", minLength: 1, maxLength: 100 } } } as const;
const snoozeBody = { type: "object", additionalProperties: false, required: ["localDate", "minutes"], properties: { localDate: { type: "string", format: "date" }, minutes: { type: "integer", minimum: 15, maximum: 1440 } } } as const;
const dismissBody = { type: "object", additionalProperties: false, required: ["localDate"], properties: { localDate: { type: "string", format: "date" } } } as const;
