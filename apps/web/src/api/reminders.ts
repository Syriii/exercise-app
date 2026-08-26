import { apiRequest } from "./client";

export interface TrainingReminderSettings {
  readonly enabled: boolean;
  readonly localTime: string;
  readonly timeZone: string;
  readonly revision: number;
  readonly updatedAt: string | null;
}

export interface TrainingReminderStatus {
  readonly state: "disabled" | "none_scheduled" | "not_due" | "due" | "snoozed" | "dismissed";
  readonly scheduleCount: number;
  readonly nextAt: string | null;
}
export interface NutritionReminderStatus { readonly state: "disabled" | "not_due" | "due" | "snoozed" | "dismissed"; readonly reason: "no_meals" | "incomplete" | "remaining" | "over_target" | null; readonly mealCount: number; readonly nextAt: string | null; }
export interface MeasurementReminderSettings extends TrainingReminderSettings { readonly intervalDays: number; }
export interface MeasurementReminderStatus { readonly state: "disabled" | "not_due" | "due" | "snoozed" | "dismissed"; readonly latestMeasurementDate: string | null; readonly nextDueDate: string | null; readonly nextAt: string | null; }

export const reminderApi = {
  getTrainingSettings: (timeZone: string) =>
    apiRequest<TrainingReminderSettings>(`/api/v1/reminders/training/settings?${new URLSearchParams({ timeZone }).toString()}`),
  updateTrainingSettings: (
    revision: number,
    input: Pick<TrainingReminderSettings, "enabled" | "localTime" | "timeZone">,
  ) => apiRequest<TrainingReminderSettings>("/api/v1/reminders/training/settings", {
    method: "PUT",
    body: JSON.stringify({ revision, ...input }),
  }),
  getTrainingStatus: (localDate: string, timeZone: string) =>
    apiRequest<TrainingReminderStatus>(`/api/v1/reminders/training/status?${new URLSearchParams({ localDate, timeZone }).toString()}`),
  snoozeTraining: (localDate: string, minutes = 60) =>
    apiRequest("/api/v1/reminders/training/snooze", {
      method: "POST",
      body: JSON.stringify({ localDate, minutes }),
    }),
  dismissTraining: (localDate: string) =>
    apiRequest("/api/v1/reminders/training/dismiss", {
      method: "POST",
      body: JSON.stringify({ localDate }),
    }),
  getNutritionSettings: (timeZone: string) => apiRequest<TrainingReminderSettings>(`/api/v1/reminders/nutrition/settings?${new URLSearchParams({ timeZone })}`),
  updateNutritionSettings: (revision: number, input: Pick<TrainingReminderSettings, "enabled" | "localTime" | "timeZone">) => apiRequest<TrainingReminderSettings>("/api/v1/reminders/nutrition/settings", { method: "PUT", body: JSON.stringify({ revision, ...input }) }),
  getNutritionStatus: (localDate: string, timeZone: string) => apiRequest<NutritionReminderStatus>(`/api/v1/reminders/nutrition/status?${new URLSearchParams({ localDate, timeZone })}`),
  snoozeNutrition: (localDate: string, minutes = 60) => apiRequest("/api/v1/reminders/nutrition/snooze", { method: "POST", body: JSON.stringify({ localDate, minutes }) }),
  dismissNutrition: (localDate: string) => apiRequest("/api/v1/reminders/nutrition/dismiss", { method: "POST", body: JSON.stringify({ localDate }) }),
  getMeasurementSettings: (timeZone: string) => apiRequest<MeasurementReminderSettings>(`/api/v1/reminders/measurement/settings?${new URLSearchParams({ timeZone })}`),
  updateMeasurementSettings: (revision: number, input: Pick<MeasurementReminderSettings, "enabled" | "intervalDays" | "localTime" | "timeZone">) => apiRequest<MeasurementReminderSettings>("/api/v1/reminders/measurement/settings", { method: "PUT", body: JSON.stringify({ revision, ...input }) }),
  getMeasurementStatus: (localDate: string, timeZone: string) => apiRequest<MeasurementReminderStatus>(`/api/v1/reminders/measurement/status?${new URLSearchParams({ localDate, timeZone })}`),
  snoozeMeasurement: (localDate: string, minutes = 1440) => apiRequest("/api/v1/reminders/measurement/snooze", { method: "POST", body: JSON.stringify({ localDate, minutes }) }),
  dismissMeasurement: (localDate: string) => apiRequest("/api/v1/reminders/measurement/dismiss", { method: "POST", body: JSON.stringify({ localDate }) }),
};
