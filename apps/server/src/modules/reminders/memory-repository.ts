import type { ReminderRepository } from "./repository.js";
import type { MeasurementReminderSettings, NutritionReminderSettings, TrainingReminderDayState, TrainingReminderSettings } from "./types.js";

export class MemoryReminderRepository implements ReminderRepository {
  readonly #settings = new Map<string, TrainingReminderSettings>();
  readonly #states = new Map<string, TrainingReminderDayState>();
  readonly #nutritionSettings = new Map<string, NutritionReminderSettings>();
  readonly #nutritionStates = new Map<string, TrainingReminderDayState>();
  readonly #measurementSettings = new Map<string, MeasurementReminderSettings>();
  readonly #measurementStates = new Map<string, TrainingReminderDayState>();

  public async getTrainingSettings(userId: string): Promise<TrainingReminderSettings | null> {
    return this.#settings.get(userId) ?? null;
  }

  public async saveTrainingSettings(
    userId: string,
    expectedRevision: number,
    input: Omit<TrainingReminderSettings, "revision" | "updatedAt">,
  ): Promise<TrainingReminderSettings | "revision_conflict"> {
    const existing = this.#settings.get(userId);
    if ((existing?.revision ?? 0) !== expectedRevision) return "revision_conflict";
    const saved = { ...input, revision: expectedRevision + 1, updatedAt: new Date() };
    this.#settings.set(userId, saved);
    return saved;
  }

  public async getTrainingDayState(userId: string, localDate: string): Promise<TrainingReminderDayState | null> {
    return this.#states.get(`${userId}:${localDate}`) ?? null;
  }

  public async saveTrainingDayState(userId: string, state: TrainingReminderDayState): Promise<TrainingReminderDayState> {
    this.#states.set(`${userId}:${state.localDate}`, state);
    return state;
  }

  public async getNutritionSettings(userId: string) { return this.#nutritionSettings.get(userId) ?? null; }
  public async saveNutritionSettings(userId: string, expectedRevision: number, input: Omit<NutritionReminderSettings, "revision" | "updatedAt">) {
    const existing = this.#nutritionSettings.get(userId); if ((existing?.revision ?? 0) !== expectedRevision) return "revision_conflict" as const;
    const saved = { ...input, revision: expectedRevision + 1, updatedAt: new Date() }; this.#nutritionSettings.set(userId, saved); return saved;
  }
  public async getNutritionDayState(userId: string, localDate: string) { return this.#nutritionStates.get(`${userId}:${localDate}`) ?? null; }
  public async saveNutritionDayState(userId: string, state: TrainingReminderDayState) { this.#nutritionStates.set(`${userId}:${state.localDate}`, state); return state; }
  public async getMeasurementSettings(userId: string) { return this.#measurementSettings.get(userId) ?? null; }
  public async saveMeasurementSettings(userId: string, expectedRevision: number, input: Omit<MeasurementReminderSettings, "revision" | "updatedAt">) {
    const existing = this.#measurementSettings.get(userId); if ((existing?.revision ?? 0) !== expectedRevision) return "revision_conflict" as const;
    const saved = { ...input, revision: expectedRevision + 1, updatedAt: new Date() }; this.#measurementSettings.set(userId, saved); return saved;
  }
  public async getMeasurementDayState(userId: string, localDate: string) { return this.#measurementStates.get(`${userId}:${localDate}`) ?? null; }
  public async saveMeasurementDayState(userId: string, state: TrainingReminderDayState) { this.#measurementStates.set(`${userId}:${state.localDate}`, state); return state; }
}
