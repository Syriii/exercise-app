export interface TrainingReminderSettings {
  readonly enabled: boolean;
  readonly localTime: string;
  readonly timeZone: string;
  readonly revision: number;
  readonly updatedAt: Date | null;
}

export interface TrainingReminderDayState {
  readonly localDate: string;
  readonly status: "snoozed" | "dismissed";
  readonly snoozedUntil: Date | null;
}

export interface TrainingReminderStatus {
  readonly state: "disabled" | "none_scheduled" | "not_due" | "due" | "snoozed" | "dismissed";
  readonly scheduleCount: number;
  readonly nextAt: Date | null;
}

export interface NutritionReminderSettings extends TrainingReminderSettings {}

export interface MeasurementReminderSettings extends TrainingReminderSettings {
  readonly intervalDays: number;
}

export interface NutritionReminderStatus {
  readonly state: "disabled" | "not_due" | "due" | "snoozed" | "dismissed";
  readonly reason: "no_meals" | "incomplete" | "remaining" | "over_target" | null;
  readonly mealCount: number;
  readonly nextAt: Date | null;
}

export interface MeasurementReminderStatus {
  readonly state: "disabled" | "not_due" | "due" | "snoozed" | "dismissed";
  readonly latestMeasurementDate: string | null;
  readonly nextDueDate: string | null;
  readonly nextAt: Date | null;
}
