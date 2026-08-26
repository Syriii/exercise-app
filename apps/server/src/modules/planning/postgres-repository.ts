import { and, desc, eq, lte, sql } from "drizzle-orm";

import type { Database } from "../../db/database.js";
import {
  bodyMeasurementRevisions,
  bodyMeasurements,
  dailyPlanningReferences,
  goalStrategies,
  personalProfiles,
} from "../../db/schema/index.js";
import type { PlanningRepository } from "./repository.js";
import type {
  BodyMeasurement,
  DailyPlanningReference,
  GoalStrategy,
  MeasurementRevision,
  PersonalProfile,
  PlanningInputSnapshot,
  DailyPlanningResult,
} from "./types.js";

function numberValue(value: string | null): number | null {
  return value === null ? null : Number(value);
}

function profileFromRow(row: typeof personalProfiles.$inferSelect): PersonalProfile {
  return {
    birthDate: row.birthDate,
    sexCategory: row.sexCategory,
    heightCm: numberValue(row.heightCm),
    pregnantOrBreastfeeding: row.pregnantOrBreastfeeding,
    medicalNutritionCondition: row.medicalNutritionCondition,
    specialBodyComposition: row.specialBodyComposition,
    palCategory: row.palCategory,
    revision: row.revision,
    updatedAt: row.updatedAt,
  };
}

function strategyFromRow(row: typeof goalStrategies.$inferSelect): GoalStrategy {
  return {
    weightStrategy: row.weightStrategy,
    macroPreference: row.macroPreference,
    regularExercise: row.regularExercise,
    trainingIntent: row.trainingIntent,
    targetWeightKg: numberValue(row.targetWeightKg),
    targetDate: row.targetDate,
    revision: row.revision,
    updatedAt: row.updatedAt,
  };
}

function measurementFromRow(row: typeof bodyMeasurements.$inferSelect): BodyMeasurement {
  return {
    id: row.id,
    measuredAt: row.measuredAt,
    localDate: row.localDate,
    timeZone: row.timeZone,
    weightKg: Number(row.weightKg),
    waistCm: numberValue(row.waistCm),
    note: row.note,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PostgresPlanningRepository implements PlanningRepository {
  public constructor(private readonly database: Database) {}

  public async getProfile(userId: string): Promise<PersonalProfile | null> {
    const [row] = await this.database.select().from(personalProfiles).where(eq(personalProfiles.userId, userId)).limit(1);
    return row === undefined ? null : profileFromRow(row);
  }

  public async saveProfile(userId: string, expectedRevision: number, input: Omit<PersonalProfile, "revision" | "updatedAt">): Promise<PersonalProfile | "revision_conflict"> {
    const result = await this.database.transaction(async (transaction) => {
      const [existing] = await transaction.select().from(personalProfiles).where(eq(personalProfiles.userId, userId)).for("update").limit(1);
      if (existing === undefined) {
        if (expectedRevision !== 0) return "revision_conflict" as const;
        await transaction.insert(personalProfiles).values({ userId, ...input, heightCm: input.heightCm?.toString() ?? null });
        return "saved" as const;
      }
      if (existing.revision !== expectedRevision) return "revision_conflict" as const;
      await transaction.update(personalProfiles).set({ ...input, heightCm: input.heightCm?.toString() ?? null, revision: sql`${personalProfiles.revision} + 1`, updatedAt: new Date() }).where(and(eq(personalProfiles.userId, userId), eq(personalProfiles.revision, expectedRevision)));
      return "saved" as const;
    });
    if (result === "revision_conflict") return result;
    const saved = await this.getProfile(userId);
    if (saved === null) throw new Error("saved profile not found");
    return saved;
  }

  public async getStrategy(userId: string): Promise<GoalStrategy | null> {
    const [row] = await this.database.select().from(goalStrategies).where(eq(goalStrategies.userId, userId)).limit(1);
    return row === undefined ? null : strategyFromRow(row);
  }

  public async saveStrategy(userId: string, expectedRevision: number, input: Omit<GoalStrategy, "revision" | "updatedAt">): Promise<GoalStrategy | "revision_conflict"> {
    const values = { ...input, targetWeightKg: input.targetWeightKg?.toString() ?? null };
    const result = await this.database.transaction(async (transaction) => {
      const [existing] = await transaction.select().from(goalStrategies).where(eq(goalStrategies.userId, userId)).for("update").limit(1);
      if (existing === undefined) {
        if (expectedRevision !== 0) return "revision_conflict" as const;
        await transaction.insert(goalStrategies).values({ userId, ...values });
        return "saved" as const;
      }
      if (existing.revision !== expectedRevision) return "revision_conflict" as const;
      await transaction.update(goalStrategies).set({ ...values, revision: sql`${goalStrategies.revision} + 1`, updatedAt: new Date() }).where(and(eq(goalStrategies.userId, userId), eq(goalStrategies.revision, expectedRevision)));
      return "saved" as const;
    });
    if (result === "revision_conflict") return result;
    const saved = await this.getStrategy(userId);
    if (saved === null) throw new Error("saved strategy not found");
    return saved;
  }

  public async listMeasurements(userId: string): Promise<readonly BodyMeasurement[]> {
    return (await this.database.select().from(bodyMeasurements).where(eq(bodyMeasurements.userId, userId)).orderBy(desc(bodyMeasurements.measuredAt))).map(measurementFromRow);
  }

  public async getLatestMeasurement(userId: string, localDate: string): Promise<BodyMeasurement | null> {
    const [row] = await this.database.select().from(bodyMeasurements).where(and(eq(bodyMeasurements.userId, userId), lte(bodyMeasurements.localDate, localDate))).orderBy(desc(bodyMeasurements.measuredAt)).limit(1);
    return row === undefined ? null : measurementFromRow(row);
  }

  public async createMeasurement(userId: string, input: Omit<BodyMeasurement, "id" | "revision" | "createdAt" | "updatedAt">): Promise<BodyMeasurement> {
    const [row] = await this.database.insert(bodyMeasurements).values({ userId, ...input, weightKg: input.weightKg.toString(), waistCm: input.waistCm?.toString() ?? null }).returning();
    if (row === undefined) throw new Error("created measurement not returned");
    return measurementFromRow(row);
  }

  public async updateMeasurement(userId: string, measurementId: string, expectedRevision: number, input: Omit<BodyMeasurement, "id" | "revision" | "createdAt" | "updatedAt">): Promise<BodyMeasurement | "not_found" | "revision_conflict"> {
    return this.database.transaction(async (transaction) => {
      const [existing] = await transaction.select().from(bodyMeasurements).where(and(eq(bodyMeasurements.id, measurementId), eq(bodyMeasurements.userId, userId))).for("update").limit(1);
      if (existing === undefined) return "not_found" as const;
      if (existing.revision !== expectedRevision) return "revision_conflict" as const;
      await transaction.insert(bodyMeasurementRevisions).values({
        measurementId,
        measurementRevision: existing.revision,
        measuredAt: existing.measuredAt,
        localDate: existing.localDate,
        timeZone: existing.timeZone,
        weightKg: existing.weightKg,
        waistCm: existing.waistCm,
        note: existing.note,
      });
      const [saved] = await transaction.update(bodyMeasurements).set({
        ...input,
        weightKg: input.weightKg.toString(),
        waistCm: input.waistCm?.toString() ?? null,
        revision: sql`${bodyMeasurements.revision} + 1`,
        updatedAt: new Date(),
      }).where(and(eq(bodyMeasurements.id, measurementId), eq(bodyMeasurements.userId, userId), eq(bodyMeasurements.revision, expectedRevision))).returning();
      if (saved === undefined) return "revision_conflict" as const;
      return measurementFromRow(saved);
    });
  }

  public async listMeasurementRevisions(userId: string, measurementId: string): Promise<readonly MeasurementRevision[] | "not_found"> {
    const [owned] = await this.database.select({ id: bodyMeasurements.id }).from(bodyMeasurements).where(and(eq(bodyMeasurements.id, measurementId), eq(bodyMeasurements.userId, userId))).limit(1);
    if (owned === undefined) return "not_found";
    return (await this.database.select().from(bodyMeasurementRevisions).where(eq(bodyMeasurementRevisions.measurementId, measurementId)).orderBy(desc(bodyMeasurementRevisions.createdAt))).map((row) => ({
      id: row.id,
      measurementId: row.measurementId,
      measurementRevision: row.measurementRevision,
      measuredAt: row.measuredAt,
      localDate: row.localDate,
      timeZone: row.timeZone,
      weightKg: Number(row.weightKg),
      waistCm: numberValue(row.waistCm),
      note: row.note,
      createdAt: row.createdAt,
    }));
  }

  public async getLatestReference(userId: string, localDate: string): Promise<DailyPlanningReference | null> {
    const [row] = await this.database.select().from(dailyPlanningReferences).where(and(eq(dailyPlanningReferences.userId, userId), eq(dailyPlanningReferences.localDate, localDate))).orderBy(desc(dailyPlanningReferences.revision)).limit(1);
    if (row === undefined) return null;
    return {
      id: row.id,
      revision: row.revision,
      methodVersion: row.methodVersion,
      evidenceIds: row.evidenceIds,
      inputSnapshot: row.inputSnapshot as unknown as PlanningInputSnapshot,
      result: row.result as unknown as DailyPlanningResult,
      createdAt: row.createdAt,
    };
  }

  public async createReference(userId: string, methodVersion: string, evidenceIds: readonly string[], inputSnapshot: PlanningInputSnapshot, result: DailyPlanningResult): Promise<DailyPlanningReference> {
    const row = await this.database.transaction(async (transaction) => {
      await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${`daily-planning:${userId}:${result.localDate}`}))`);
      const [latest] = await transaction.select({ revision: dailyPlanningReferences.revision }).from(dailyPlanningReferences).where(and(eq(dailyPlanningReferences.userId, userId), eq(dailyPlanningReferences.localDate, result.localDate))).orderBy(desc(dailyPlanningReferences.revision)).limit(1);
      const [saved] = await transaction.insert(dailyPlanningReferences).values({
        userId,
        localDate: result.localDate,
        revision: (latest?.revision ?? 0) + 1,
        methodVersion,
        evidenceIds: [...evidenceIds],
        inputSnapshot: inputSnapshot as unknown as Record<string, unknown>,
        result: result as unknown as Record<string, unknown>,
      }).returning();
      if (saved === undefined) throw new Error("created daily planning reference not returned");
      return saved;
    });
    return {
      id: row.id,
      revision: row.revision,
      methodVersion: row.methodVersion,
      evidenceIds: row.evidenceIds,
      inputSnapshot: row.inputSnapshot as unknown as PlanningInputSnapshot,
      result: row.result as unknown as DailyPlanningResult,
      createdAt: row.createdAt,
    };
  }
}
