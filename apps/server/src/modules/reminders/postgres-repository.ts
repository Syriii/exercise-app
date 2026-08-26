import { and, eq, sql } from "drizzle-orm";

import type { Database } from "../../db/database.js";
import { measurementReminderDayStates, measurementReminderRules, nutritionReminderDayStates, nutritionReminderRules, trainingReminderDayStates, trainingReminderRules } from "../../db/schema/index.js";
import type { ReminderRepository } from "./repository.js";
import type { MeasurementReminderSettings, NutritionReminderSettings, TrainingReminderDayState, TrainingReminderSettings } from "./types.js";

export class PostgresReminderRepository implements ReminderRepository {
  public constructor(private readonly database: Database) {}

  public async getTrainingSettings(userId: string): Promise<TrainingReminderSettings | null> {
    const [row] = await this.database.select().from(trainingReminderRules).where(eq(trainingReminderRules.userId, userId)).limit(1);
    if (row === undefined) return null;
    return { enabled: row.enabled, localTime: row.localTime, timeZone: row.timeZone, revision: row.revision, updatedAt: row.updatedAt };
  }

  public async saveTrainingSettings(
    userId: string,
    expectedRevision: number,
    input: Omit<TrainingReminderSettings, "revision" | "updatedAt">,
  ): Promise<TrainingReminderSettings | "revision_conflict"> {
    const result = await this.database.transaction(async (transaction) => {
      const [existing] = await transaction.select().from(trainingReminderRules).where(eq(trainingReminderRules.userId, userId)).for("update").limit(1);
      if (existing === undefined) {
        if (expectedRevision !== 0) return "revision_conflict" as const;
        await transaction.insert(trainingReminderRules).values({ userId, ...input });
        return "saved" as const;
      }
      if (existing.revision !== expectedRevision) return "revision_conflict" as const;
      await transaction.update(trainingReminderRules).set({ ...input, revision: sql`${trainingReminderRules.revision} + 1`, updatedAt: new Date() }).where(and(eq(trainingReminderRules.userId, userId), eq(trainingReminderRules.revision, expectedRevision)));
      return "saved" as const;
    });
    if (result === "revision_conflict") return result;
    const saved = await this.getTrainingSettings(userId);
    if (saved === null) throw new Error("saved training reminder settings not found");
    return saved;
  }

  public async getTrainingDayState(userId: string, localDate: string): Promise<TrainingReminderDayState | null> {
    const [row] = await this.database.select().from(trainingReminderDayStates).where(and(eq(trainingReminderDayStates.userId, userId), eq(trainingReminderDayStates.localDate, localDate))).limit(1);
    if (row === undefined) return null;
    return { localDate: row.localDate, status: row.status, snoozedUntil: row.snoozedUntil };
  }

  public async saveTrainingDayState(userId: string, state: TrainingReminderDayState): Promise<TrainingReminderDayState> {
    await this.database.insert(trainingReminderDayStates).values({ userId, ...state }).onConflictDoUpdate({
      target: [trainingReminderDayStates.userId, trainingReminderDayStates.localDate],
      set: { status: state.status, snoozedUntil: state.snoozedUntil, updatedAt: new Date() },
    });
    return state;
  }

  public async getNutritionSettings(userId: string): Promise<NutritionReminderSettings | null> {
    const [row] = await this.database.select().from(nutritionReminderRules).where(eq(nutritionReminderRules.userId, userId)).limit(1);
    return row === undefined ? null : { enabled: row.enabled, localTime: row.localTime, timeZone: row.timeZone, revision: row.revision, updatedAt: row.updatedAt };
  }

  public async saveNutritionSettings(userId: string, expectedRevision: number, input: Omit<NutritionReminderSettings, "revision" | "updatedAt">): Promise<NutritionReminderSettings | "revision_conflict"> {
    const result = await this.database.transaction(async (transaction) => {
      const [existing] = await transaction.select().from(nutritionReminderRules).where(eq(nutritionReminderRules.userId, userId)).for("update").limit(1);
      if (existing === undefined) { if (expectedRevision !== 0) return "revision_conflict" as const; await transaction.insert(nutritionReminderRules).values({ userId, ...input }); return "saved" as const; }
      if (existing.revision !== expectedRevision) return "revision_conflict" as const;
      await transaction.update(nutritionReminderRules).set({ ...input, revision: sql`${nutritionReminderRules.revision} + 1`, updatedAt: new Date() }).where(and(eq(nutritionReminderRules.userId, userId), eq(nutritionReminderRules.revision, expectedRevision))); return "saved" as const;
    });
    if (result === "revision_conflict") return result; const saved = await this.getNutritionSettings(userId); if (saved === null) throw new Error("saved nutrition reminder settings not found"); return saved;
  }

  public async getNutritionDayState(userId: string, localDate: string) { const [row] = await this.database.select().from(nutritionReminderDayStates).where(and(eq(nutritionReminderDayStates.userId, userId), eq(nutritionReminderDayStates.localDate, localDate))).limit(1); return row === undefined ? null : { localDate: row.localDate, status: row.status, snoozedUntil: row.snoozedUntil }; }
  public async saveNutritionDayState(userId: string, state: TrainingReminderDayState) { await this.database.insert(nutritionReminderDayStates).values({ userId, ...state }).onConflictDoUpdate({ target: [nutritionReminderDayStates.userId, nutritionReminderDayStates.localDate], set: { status: state.status, snoozedUntil: state.snoozedUntil, updatedAt: new Date() } }); return state; }

  public async getMeasurementSettings(userId: string): Promise<MeasurementReminderSettings | null> {
    const [row] = await this.database.select().from(measurementReminderRules).where(eq(measurementReminderRules.userId, userId)).limit(1);
    return row === undefined ? null : { enabled: row.enabled, intervalDays: row.intervalDays, localTime: row.localTime, timeZone: row.timeZone, revision: row.revision, updatedAt: row.updatedAt };
  }

  public async saveMeasurementSettings(userId: string, expectedRevision: number, input: Omit<MeasurementReminderSettings, "revision" | "updatedAt">): Promise<MeasurementReminderSettings | "revision_conflict"> {
    const result = await this.database.transaction(async (transaction) => {
      const [existing] = await transaction.select().from(measurementReminderRules).where(eq(measurementReminderRules.userId, userId)).for("update").limit(1);
      if (existing === undefined) { if (expectedRevision !== 0) return "revision_conflict" as const; await transaction.insert(measurementReminderRules).values({ userId, ...input }); return "saved" as const; }
      if (existing.revision !== expectedRevision) return "revision_conflict" as const;
      await transaction.update(measurementReminderRules).set({ ...input, revision: sql`${measurementReminderRules.revision} + 1`, updatedAt: new Date() }).where(and(eq(measurementReminderRules.userId, userId), eq(measurementReminderRules.revision, expectedRevision))); return "saved" as const;
    });
    if (result === "revision_conflict") return result; const saved = await this.getMeasurementSettings(userId); if (saved === null) throw new Error("saved measurement reminder settings not found"); return saved;
  }

  public async getMeasurementDayState(userId: string, localDate: string) { const [row] = await this.database.select().from(measurementReminderDayStates).where(and(eq(measurementReminderDayStates.userId, userId), eq(measurementReminderDayStates.localDate, localDate))).limit(1); return row === undefined ? null : { localDate: row.localDate, status: row.status, snoozedUntil: row.snoozedUntil }; }
  public async saveMeasurementDayState(userId: string, state: TrainingReminderDayState) { await this.database.insert(measurementReminderDayStates).values({ userId, ...state }).onConflictDoUpdate({ target: [measurementReminderDayStates.userId, measurementReminderDayStates.localDate], set: { status: state.status, snoozedUntil: state.snoozedUntil, updatedAt: new Date() } }); return state; }
}
