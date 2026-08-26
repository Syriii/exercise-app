import type { MeasurementReminderSettings, NutritionReminderSettings, TrainingReminderDayState, TrainingReminderSettings } from "./types.js";

export interface ReminderRepository {
  getTrainingSettings(userId: string): Promise<TrainingReminderSettings | null>;
  saveTrainingSettings(
    userId: string,
    expectedRevision: number,
    input: Omit<TrainingReminderSettings, "revision" | "updatedAt">,
  ): Promise<TrainingReminderSettings | "revision_conflict">;
  getTrainingDayState(userId: string, localDate: string): Promise<TrainingReminderDayState | null>;
  saveTrainingDayState(userId: string, state: TrainingReminderDayState): Promise<TrainingReminderDayState>;
  getNutritionSettings(userId: string): Promise<NutritionReminderSettings | null>;
  saveNutritionSettings(userId: string, expectedRevision: number, input: Omit<NutritionReminderSettings, "revision" | "updatedAt">): Promise<NutritionReminderSettings | "revision_conflict">;
  getNutritionDayState(userId: string, localDate: string): Promise<TrainingReminderDayState | null>;
  saveNutritionDayState(userId: string, state: TrainingReminderDayState): Promise<TrainingReminderDayState>;
  getMeasurementSettings(userId: string): Promise<MeasurementReminderSettings | null>;
  saveMeasurementSettings(userId: string, expectedRevision: number, input: Omit<MeasurementReminderSettings, "revision" | "updatedAt">): Promise<MeasurementReminderSettings | "revision_conflict">;
  getMeasurementDayState(userId: string, localDate: string): Promise<TrainingReminderDayState | null>;
  saveMeasurementDayState(userId: string, state: TrainingReminderDayState): Promise<TrainingReminderDayState>;
}
