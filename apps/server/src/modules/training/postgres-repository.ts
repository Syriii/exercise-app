import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";

import type { Database } from "../../db/database.js";
import {
  trainingSessionItems,
  trainingSessionItemRevisions,
  trainingSessions,
  trainingSessionRevisions,
  trainingSessionSets,
  trainingProgramUnitItems,
  trainingProgramUnits,
  trainingPrograms,
  trainingSchedules,
  trainingTemplateItems,
  trainingTemplates,
} from "../../db/schema/index.js";
import type { TrainingRepository } from "./repository.js";
import type {
  ExtraTrainingItemInput,
  TrainingProgram,
  TrainingProgramInput,
  TrainingProgramUnit,
  TrainingProgramUnitInput,
  TrainingExpenditureAssessment,
  TrainingSchedule,
  TrainingScheduleInput,
  TrainingSession,
  TrainingSessionItem,
  TrainingSessionItemRevision,
  TrainingSessionMetadataUpdate,
  TrainingSessionRevision,
  TrainingSessionItemUpdate,
  TrainingSessionStatus,
  TrainingTemplate,
  TrainingTemplateInput,
} from "./types.js";

type TemplateRow = typeof trainingTemplates.$inferSelect;
type TemplateItemRow = typeof trainingTemplateItems.$inferSelect;
type ProgramRow = typeof trainingPrograms.$inferSelect;
type ProgramUnitRow = typeof trainingProgramUnits.$inferSelect;
type ProgramUnitItemRow = typeof trainingProgramUnitItems.$inferSelect;
type ScheduleRow = typeof trainingSchedules.$inferSelect;
type SessionRow = typeof trainingSessions.$inferSelect;
type SessionRevisionRow = typeof trainingSessionRevisions.$inferSelect;
type SessionItemRow = typeof trainingSessionItems.$inferSelect;
type SessionItemRevisionRow = typeof trainingSessionItemRevisions.$inferSelect;
type SessionSetRow = typeof trainingSessionSets.$inferSelect;

function toTemplate(row: TemplateRow, items: readonly TemplateItemRow[]): TrainingTemplate {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    note: row.note,
    revision: row.revision,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    items: items.map((item) => ({
      id: item.id,
      sortOrder: item.sortOrder,
      exerciseName: item.exerciseName,
      targetSets: item.targetSets,
      targetRepsMin: item.targetRepsMin,
      targetRepsMax: item.targetRepsMax,
      targetWeightKg: item.targetWeightKg,
      targetDurationSeconds: item.targetDurationSeconds,
      targetDistanceMeters: item.targetDistanceMeters,
      note: item.note,
    })),
  };
}

function toSessionItem(row: SessionItemRow, sets: readonly SessionSetRow[]): TrainingSessionItem {
  return {
    id: row.id,
    sourceTemplateItemId: row.sourceTemplateItemId,
    origin: row.origin,
    status: row.status,
    sortOrder: row.sortOrder,
    exerciseName: row.exerciseName,
    performedExerciseName: row.performedExerciseName,
    target: {
      targetSets: row.targetSets,
      targetRepsMin: row.targetRepsMin,
      targetRepsMax: row.targetRepsMax,
      targetWeightKg: row.targetWeightKg,
      targetDurationSeconds: row.targetDurationSeconds,
      targetDistanceMeters: row.targetDistanceMeters,
      note: row.targetNote,
    },
    actualNote: row.actualNote,
    sets: sets.map((set) => ({
      id: set.id,
      sequence: set.sequence,
      reps: set.reps,
      weightKg: set.weightKg,
      durationSeconds: set.durationSeconds,
      distanceMeters: set.distanceMeters,
      note: set.note,
    })),
  };
}

function toSessionItemRevision(row: SessionItemRevisionRow): TrainingSessionItemRevision {
  return {
    id: row.id,
    sessionId: row.sessionId,
    sessionItemId: row.sessionItemId,
    sessionRevision: row.sessionRevision,
    status: row.status,
    performedExerciseName: row.performedExerciseName,
    actualNote: row.actualNote,
    sets: row.setsSnapshot,
    createdAt: row.createdAt,
  };
}

function toSessionRevision(row: SessionRevisionRow): TrainingSessionRevision {
  return {
    id: row.id,
    sessionId: row.sessionId,
    sessionRevision: row.sessionRevision,
    localDate: row.localDate,
    timeZone: row.timeZone,
    note: row.note,
    expenditureAssessment: row.expenditureAssessment as TrainingExpenditureAssessment | null,
    createdAt: row.createdAt,
  };
}

function toSession(
  row: SessionRow,
  items: readonly SessionItemRow[],
  sets: readonly SessionSetRow[],
): TrainingSession {
  return {
    id: row.id,
    userId: row.userId,
    sourceScheduleId: row.sourceScheduleId,
    sourceScheduleTitle: row.sourceScheduleTitle,
    sourceTemplateId: row.sourceTemplateId,
    sourceTemplateName: row.sourceTemplateName,
    sourceProgramId: row.sourceProgramId,
    sourceProgramName: row.sourceProgramName,
    sourceProgramUnitId: row.sourceProgramUnitId,
    sourceWeekNumber: row.sourceWeekNumber,
    sourceTrainingDayName: row.sourceTrainingDayName,
    status: row.status,
    revision: row.revision,
    timeZone: row.timeZone,
    localDate: row.localDate,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    note: row.note,
    expenditureAssessment: row.expenditureAssessment as TrainingExpenditureAssessment | null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    items: items.map((item) =>
      toSessionItem(
        item,
        sets.filter((set) => set.sessionItemId === item.id),
      ),
    ),
  };
}

function toProgramUnit(
  row: ProgramUnitRow,
  items: readonly ProgramUnitItemRow[],
  started: boolean,
): TrainingProgramUnit {
  return {
    id: row.id,
    weekNumber: row.weekNumber,
    sortOrder: row.sortOrder,
    name: row.name,
    note: row.note,
    sourceTemplateId: row.sourceTemplateId,
    sourceTemplateName: row.sourceTemplateName,
    sourceTemplateRevision: row.sourceTemplateRevision,
    importedAt: row.importedAt,
    started,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    items: items.map((item) => ({
      id: item.id,
      sortOrder: item.sortOrder,
      exerciseName: item.exerciseName,
      targetSets: item.targetSets,
      targetRepsMin: item.targetRepsMin,
      targetRepsMax: item.targetRepsMax,
      targetWeightKg: item.targetWeightKg,
      targetDurationSeconds: item.targetDurationSeconds,
      targetDistanceMeters: item.targetDistanceMeters,
      note: item.note,
    })),
  };
}

function toProgram(
  row: ProgramRow,
  units: readonly TrainingProgramUnit[],
): TrainingProgram {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    note: row.note,
    weekCount: row.weekCount,
    revision: row.revision,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    units,
  };
}

function toSchedule(row: ScheduleRow, startedSessionId: string | null): TrainingSchedule {
  return {
    id: row.id,
    userId: row.userId,
    localDate: row.localDate,
    timeZone: row.timeZone,
    title: row.title,
    note: row.note,
    sourceTemplateId: row.sourceTemplateId,
    sourceTemplateName: row.sourceTemplateName,
    sourceProgramId: row.sourceProgramId,
    sourceProgramName: row.sourceProgramName,
    sourceProgramUnitId: row.sourceProgramUnitId,
    sourceWeekNumber: row.sourceWeekNumber,
    sourceTrainingDayName: row.sourceTrainingDayName,
    status: startedSessionId !== null ? "started" : row.cancelledAt === null ? "scheduled" : "cancelled",
    revision: row.revision,
    cancelledAt: row.cancelledAt,
    startedSessionId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function programUnitItemValues(unitId: string, input: TrainingProgramUnitInput) {
  return input.items.map((item, sortOrder) => ({
    unitId,
    sortOrder,
    exerciseName: item.exerciseName,
    targetSets: item.targetSets,
    targetRepsMin: item.targetRepsMin,
    targetRepsMax: item.targetRepsMax,
    targetWeightKg: item.targetWeightKg,
    targetDurationSeconds: item.targetDurationSeconds,
    targetDistanceMeters: item.targetDistanceMeters,
    note: item.note,
  }));
}

export class PostgresTrainingRepository implements TrainingRepository {
  readonly #database: Database;

  public constructor(database: Database) {
    this.#database = database;
  }

  public async listTemplates(userId: string, includeArchived: boolean): Promise<readonly TrainingTemplate[]> {
    const conditions = includeArchived
      ? eq(trainingTemplates.userId, userId)
      : and(eq(trainingTemplates.userId, userId), isNull(trainingTemplates.archivedAt));
    const rows = await this.#database
      .select()
      .from(trainingTemplates)
      .where(conditions)
      .orderBy(desc(trainingTemplates.updatedAt));
    return this.#withTemplateItems(rows);
  }

  public async findTemplate(userId: string, templateId: string): Promise<TrainingTemplate | null> {
    const [row] = await this.#database
      .select()
      .from(trainingTemplates)
      .where(and(eq(trainingTemplates.id, templateId), eq(trainingTemplates.userId, userId)))
      .limit(1);
    if (row === undefined) return null;
    return (await this.#withTemplateItems([row]))[0] ?? null;
  }

  public async createTemplate(userId: string, input: TrainingTemplateInput): Promise<TrainingTemplate> {
    const templateId = await this.#database.transaction(async (transaction) => {
      const [template] = await transaction
        .insert(trainingTemplates)
        .values({ userId, name: input.name, note: input.note })
        .returning({ id: trainingTemplates.id });
      if (template === undefined) throw new Error("training template insert returned no row");
      await transaction.insert(trainingTemplateItems).values(
        input.items.map((item, sortOrder) => ({ templateId: template.id, sortOrder, ...item })),
      );
      return template.id;
    });
    const template = await this.findTemplate(userId, templateId);
    if (template === null) throw new Error("created training template not found");
    return template;
  }

  public async createTemplateFromSuggestion(userId: string, suggestionId: string, input: TrainingTemplateInput): Promise<TrainingTemplate> {
    const templateId = await this.#database.transaction(async (transaction) => {
      const [template] = await transaction
        .insert(trainingTemplates)
        .values({ userId, name: input.name, note: input.note, sourceSuggestionId: suggestionId })
        .onConflictDoNothing({ target: trainingTemplates.sourceSuggestionId })
        .returning({ id: trainingTemplates.id });
      if (template === undefined) return null;
      await transaction.insert(trainingTemplateItems).values(
        input.items.map((item, sortOrder) => ({ templateId: template.id, sortOrder, ...item })),
      );
      return template.id;
    });
    if (templateId !== null) {
      const template = await this.findTemplate(userId, templateId);
      if (template === null) throw new Error("created training template not found");
      return template;
    }
    const [existing] = await this.#database
      .select({ id: trainingTemplates.id })
      .from(trainingTemplates)
      .where(and(eq(trainingTemplates.userId, userId), eq(trainingTemplates.sourceSuggestionId, suggestionId)))
      .limit(1);
    if (existing === undefined) throw new Error("suggestion template conflict without existing template");
    const template = await this.findTemplate(userId, existing.id);
    if (template === null) throw new Error("existing suggestion template not found");
    return template;
  }

  public async updateTemplate(
    userId: string,
    templateId: string,
    expectedRevision: number,
    input: TrainingTemplateInput,
  ): Promise<TrainingTemplate | "revision_conflict" | null> {
    const result = await this.#database.transaction(async (transaction) => {
      const [existing] = await transaction
        .select({ revision: trainingTemplates.revision })
        .from(trainingTemplates)
        .where(and(eq(trainingTemplates.id, templateId), eq(trainingTemplates.userId, userId)))
        .for("update")
        .limit(1);
      if (existing === undefined) return null;
      if (existing.revision !== expectedRevision) return "revision_conflict" as const;
      await transaction
        .update(trainingTemplates)
        .set({
          name: input.name,
          note: input.note,
          revision: sql`${trainingTemplates.revision} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(trainingTemplates.id, templateId));
      await transaction.delete(trainingTemplateItems).where(eq(trainingTemplateItems.templateId, templateId));
      await transaction.insert(trainingTemplateItems).values(
        input.items.map((item, sortOrder) => ({ templateId, sortOrder, ...item })),
      );
      return "updated" as const;
    });
    if (result === null || result === "revision_conflict") return result;
    return this.findTemplate(userId, templateId);
  }

  public async setTemplateArchived(
    userId: string,
    templateId: string,
    expectedRevision: number,
    archivedAt: Date | null,
  ): Promise<TrainingTemplate | "revision_conflict" | null> {
    const [updated] = await this.#database
      .update(trainingTemplates)
      .set({ archivedAt, revision: sql`${trainingTemplates.revision} + 1`, updatedAt: new Date() })
      .where(
        and(
          eq(trainingTemplates.id, templateId),
          eq(trainingTemplates.userId, userId),
          eq(trainingTemplates.revision, expectedRevision),
        ),
      )
      .returning({ id: trainingTemplates.id });
    if (updated !== undefined) return this.findTemplate(userId, templateId);
    const existing = await this.findTemplate(userId, templateId);
    return existing === null ? null : "revision_conflict";
  }

  public async listPrograms(userId: string, includeArchived: boolean): Promise<readonly TrainingProgram[]> {
    const conditions = includeArchived
      ? eq(trainingPrograms.userId, userId)
      : and(eq(trainingPrograms.userId, userId), isNull(trainingPrograms.archivedAt));
    const rows = await this.#database
      .select()
      .from(trainingPrograms)
      .where(conditions)
      .orderBy(desc(trainingPrograms.updatedAt));
    return this.#withProgramUnits(rows);
  }

  public async findProgram(userId: string, programId: string): Promise<TrainingProgram | null> {
    const [row] = await this.#database
      .select()
      .from(trainingPrograms)
      .where(and(eq(trainingPrograms.id, programId), eq(trainingPrograms.userId, userId)))
      .limit(1);
    if (row === undefined) return null;
    return (await this.#withProgramUnits([row]))[0] ?? null;
  }

  public async createProgram(userId: string, input: TrainingProgramInput): Promise<TrainingProgram> {
    const [created] = await this.#database
      .insert(trainingPrograms)
      .values({ userId, ...input })
      .returning({ id: trainingPrograms.id });
    if (created === undefined) throw new Error("training program insert returned no row");
    const program = await this.findProgram(userId, created.id);
    if (program === null) throw new Error("created training program not found");
    return program;
  }

  public async updateProgram(
    userId: string,
    programId: string,
    expectedRevision: number,
    input: TrainingProgramInput,
  ): Promise<TrainingProgram | "revision_conflict" | null> {
    const [updated] = await this.#database
      .update(trainingPrograms)
      .set({ ...input, revision: sql`${trainingPrograms.revision} + 1`, updatedAt: new Date() })
      .where(
        and(
          eq(trainingPrograms.id, programId),
          eq(trainingPrograms.userId, userId),
          eq(trainingPrograms.revision, expectedRevision),
        ),
      )
      .returning({ id: trainingPrograms.id });
    if (updated !== undefined) return this.findProgram(userId, programId);
    const existing = await this.findProgram(userId, programId);
    return existing === null ? null : "revision_conflict";
  }

  public async setProgramArchived(
    userId: string,
    programId: string,
    expectedRevision: number,
    archivedAt: Date | null,
  ): Promise<TrainingProgram | "revision_conflict" | null> {
    const [updated] = await this.#database
      .update(trainingPrograms)
      .set({ archivedAt, revision: sql`${trainingPrograms.revision} + 1`, updatedAt: new Date() })
      .where(
        and(
          eq(trainingPrograms.id, programId),
          eq(trainingPrograms.userId, userId),
          eq(trainingPrograms.revision, expectedRevision),
        ),
      )
      .returning({ id: trainingPrograms.id });
    if (updated !== undefined) return this.findProgram(userId, programId);
    const existing = await this.findProgram(userId, programId);
    return existing === null ? null : "revision_conflict";
  }

  public async addProgramUnit(
    userId: string,
    programId: string,
    expectedRevision: number,
    input: TrainingProgramUnitInput & {
      readonly sourceTemplateId: string | null;
      readonly sourceTemplateName: string | null;
      readonly sourceTemplateRevision: number | null;
      readonly importedAt: Date | null;
    },
  ): Promise<TrainingProgram | "revision_conflict" | null> {
    const result = await this.#database.transaction(async (transaction) => {
      const [program] = await transaction
        .select({ revision: trainingPrograms.revision })
        .from(trainingPrograms)
        .where(and(eq(trainingPrograms.id, programId), eq(trainingPrograms.userId, userId)))
        .for("update")
        .limit(1);
      if (program === undefined) return null;
      if (program.revision !== expectedRevision) return "revision_conflict" as const;
      const [{ nextOrder } = { nextOrder: 0 }] = await transaction
        .select({ nextOrder: sql<number>`coalesce(max(${trainingProgramUnits.sortOrder}), -1) + 1` })
        .from(trainingProgramUnits)
        .where(
          and(
            eq(trainingProgramUnits.programId, programId),
            eq(trainingProgramUnits.weekNumber, input.weekNumber),
          ),
        );
      const [unit] = await transaction
        .insert(trainingProgramUnits)
        .values({
          programId,
          sourceTemplateId: input.sourceTemplateId,
          sourceTemplateName: input.sourceTemplateName,
          sourceTemplateRevision: input.sourceTemplateRevision,
          importedAt: input.importedAt,
          weekNumber: input.weekNumber,
          sortOrder: Number(nextOrder),
          name: input.name,
          note: input.note,
        })
        .returning({ id: trainingProgramUnits.id });
      if (unit === undefined) throw new Error("training program unit insert returned no row");
      await transaction.insert(trainingProgramUnitItems).values(programUnitItemValues(unit.id, input));
      await transaction
        .update(trainingPrograms)
        .set({ revision: sql`${trainingPrograms.revision} + 1`, updatedAt: new Date() })
        .where(eq(trainingPrograms.id, programId));
      return "updated" as const;
    });
    if (result === null || result === "revision_conflict") return result;
    return this.findProgram(userId, programId);
  }

  public async updateProgramUnit(
    userId: string,
    programId: string,
    unitId: string,
    expectedRevision: number,
    input: TrainingProgramUnitInput,
  ): Promise<TrainingProgram | "revision_conflict" | "unit_started" | null> {
    const result = await this.#database.transaction(async (transaction) => {
      const [program] = await transaction
        .select({ revision: trainingPrograms.revision })
        .from(trainingPrograms)
        .where(and(eq(trainingPrograms.id, programId), eq(trainingPrograms.userId, userId)))
        .for("update")
        .limit(1);
      if (program === undefined) return null;
      if (program.revision !== expectedRevision) return "revision_conflict" as const;
      const [unit] = await transaction
        .select({ weekNumber: trainingProgramUnits.weekNumber, sortOrder: trainingProgramUnits.sortOrder })
        .from(trainingProgramUnits)
        .where(and(eq(trainingProgramUnits.id, unitId), eq(trainingProgramUnits.programId, programId)))
        .limit(1);
      if (unit === undefined) return null;
      const [started] = await transaction
        .select({ id: trainingSessions.id })
        .from(trainingSessions)
        .where(eq(trainingSessions.sourceProgramUnitId, unitId))
        .limit(1);
      if (started !== undefined) return "unit_started" as const;
      let sortOrder = unit.sortOrder;
      if (unit.weekNumber !== input.weekNumber) {
        const [{ nextOrder } = { nextOrder: 0 }] = await transaction
          .select({ nextOrder: sql<number>`coalesce(max(${trainingProgramUnits.sortOrder}), -1) + 1` })
          .from(trainingProgramUnits)
          .where(
            and(
              eq(trainingProgramUnits.programId, programId),
              eq(trainingProgramUnits.weekNumber, input.weekNumber),
            ),
          );
        sortOrder = Number(nextOrder);
      }
      await transaction
        .update(trainingProgramUnits)
        .set({
          weekNumber: input.weekNumber,
          sortOrder,
          name: input.name,
          note: input.note,
          updatedAt: new Date(),
        })
        .where(eq(trainingProgramUnits.id, unitId));
      await transaction.delete(trainingProgramUnitItems).where(eq(trainingProgramUnitItems.unitId, unitId));
      await transaction.insert(trainingProgramUnitItems).values(programUnitItemValues(unitId, input));
      await transaction
        .update(trainingPrograms)
        .set({ revision: sql`${trainingPrograms.revision} + 1`, updatedAt: new Date() })
        .where(eq(trainingPrograms.id, programId));
      return "updated" as const;
    });
    if (result === null || result === "revision_conflict" || result === "unit_started") return result;
    return this.findProgram(userId, programId);
  }

  public async reimportProgramUnit(
    userId: string,
    programId: string,
    unitId: string,
    expectedRevision: number,
    template: TrainingTemplate,
    importedAt: Date,
  ): Promise<TrainingProgram | "revision_conflict" | "unit_started" | null> {
    const result = await this.#database.transaction(async (transaction) => {
      const [program] = await transaction
        .select({ revision: trainingPrograms.revision })
        .from(trainingPrograms)
        .where(and(eq(trainingPrograms.id, programId), eq(trainingPrograms.userId, userId)))
        .for("update")
        .limit(1);
      if (program === undefined) return null;
      if (program.revision !== expectedRevision) return "revision_conflict" as const;
      const [unit] = await transaction
        .select({ id: trainingProgramUnits.id })
        .from(trainingProgramUnits)
        .where(and(eq(trainingProgramUnits.id, unitId), eq(trainingProgramUnits.programId, programId)))
        .limit(1);
      if (unit === undefined) return null;
      const [started] = await transaction
        .select({ id: trainingSessions.id })
        .from(trainingSessions)
        .where(eq(trainingSessions.sourceProgramUnitId, unitId))
        .limit(1);
      if (started !== undefined) return "unit_started" as const;
      await transaction
        .update(trainingProgramUnits)
        .set({
          sourceTemplateId: template.id,
          sourceTemplateName: template.name,
          sourceTemplateRevision: template.revision,
          importedAt,
          name: template.name,
          note: template.note,
          updatedAt: new Date(),
        })
        .where(eq(trainingProgramUnits.id, unitId));
      await transaction.delete(trainingProgramUnitItems).where(eq(trainingProgramUnitItems.unitId, unitId));
      await transaction.insert(trainingProgramUnitItems).values(
        programUnitItemValues(unitId, {
          weekNumber: 1,
          name: template.name,
          note: template.note,
          items: template.items,
        }),
      );
      await transaction
        .update(trainingPrograms)
        .set({ revision: sql`${trainingPrograms.revision} + 1`, updatedAt: new Date() })
        .where(eq(trainingPrograms.id, programId));
      return "updated" as const;
    });
    if (result === null || result === "revision_conflict" || result === "unit_started") return result;
    return this.findProgram(userId, programId);
  }

  public async listSchedules(
    userId: string,
    dateFrom?: string,
    dateTo?: string,
  ): Promise<readonly TrainingSchedule[]> {
    const conditions = [eq(trainingSchedules.userId, userId)];
    if (dateFrom !== undefined) conditions.push(gte(trainingSchedules.localDate, dateFrom));
    if (dateTo !== undefined) conditions.push(lte(trainingSchedules.localDate, dateTo));
    const rows = await this.#database
      .select()
      .from(trainingSchedules)
      .where(and(...conditions))
      .orderBy(asc(trainingSchedules.localDate), asc(trainingSchedules.createdAt));
    return this.#withScheduleStatus(rows);
  }

  public async findSchedule(userId: string, scheduleId: string): Promise<TrainingSchedule | null> {
    const [row] = await this.#database
      .select()
      .from(trainingSchedules)
      .where(and(eq(trainingSchedules.id, scheduleId), eq(trainingSchedules.userId, userId)))
      .limit(1);
    if (row === undefined) return null;
    return (await this.#withScheduleStatus([row]))[0] ?? null;
  }

  public async createSchedule(
    userId: string,
    input: TrainingScheduleInput & {
      readonly sourceTemplateName: string | null;
      readonly sourceProgramName: string | null;
      readonly sourceWeekNumber: number | null;
      readonly sourceTrainingDayName: string | null;
    },
  ): Promise<TrainingSchedule> {
    const [created] = await this.#database
      .insert(trainingSchedules)
      .values({ userId, ...input })
      .returning({ id: trainingSchedules.id });
    if (created === undefined) throw new Error("training schedule insert returned no row");
    const result = await this.findSchedule(userId, created.id);
    if (result === null) throw new Error("created training schedule not found");
    return result;
  }

  public async updateSchedule(
    userId: string,
    scheduleId: string,
    expectedRevision: number,
    input: TrainingScheduleInput & {
      readonly sourceTemplateName: string | null;
      readonly sourceProgramName: string | null;
      readonly sourceWeekNumber: number | null;
      readonly sourceTrainingDayName: string | null;
    },
  ): Promise<TrainingSchedule | "revision_conflict" | "schedule_unavailable" | null> {
    const result = await this.#database.transaction(async (transaction) => {
      const [existing] = await transaction
        .select({ revision: trainingSchedules.revision, cancelledAt: trainingSchedules.cancelledAt })
        .from(trainingSchedules)
        .where(and(eq(trainingSchedules.id, scheduleId), eq(trainingSchedules.userId, userId)))
        .for("update")
        .limit(1);
      if (existing === undefined) return null;
      if (existing.revision !== expectedRevision) return "revision_conflict" as const;
      const [started] = await transaction
        .select({ id: trainingSessions.id })
        .from(trainingSessions)
        .where(eq(trainingSessions.sourceScheduleId, scheduleId))
        .limit(1);
      if (existing.cancelledAt !== null || started !== undefined) return "schedule_unavailable" as const;
      await transaction
        .update(trainingSchedules)
        .set({ ...input, revision: sql`${trainingSchedules.revision} + 1`, updatedAt: new Date() })
        .where(eq(trainingSchedules.id, scheduleId));
      return "updated" as const;
    });
    if (result === null || result === "revision_conflict" || result === "schedule_unavailable") return result;
    return this.findSchedule(userId, scheduleId);
  }

  public async cancelSchedule(
    userId: string,
    scheduleId: string,
    expectedRevision: number,
    cancelledAt: Date,
  ): Promise<TrainingSchedule | "revision_conflict" | "schedule_unavailable" | null> {
    const result = await this.#database.transaction(async (transaction) => {
      const [existing] = await transaction
        .select({ revision: trainingSchedules.revision, cancelledAt: trainingSchedules.cancelledAt })
        .from(trainingSchedules)
        .where(and(eq(trainingSchedules.id, scheduleId), eq(trainingSchedules.userId, userId)))
        .for("update")
        .limit(1);
      if (existing === undefined) return null;
      if (existing.revision !== expectedRevision) return "revision_conflict" as const;
      const [started] = await transaction
        .select({ id: trainingSessions.id })
        .from(trainingSessions)
        .where(eq(trainingSessions.sourceScheduleId, scheduleId))
        .limit(1);
      if (existing.cancelledAt !== null || started !== undefined) return "schedule_unavailable" as const;
      await transaction
        .update(trainingSchedules)
        .set({ cancelledAt, revision: sql`${trainingSchedules.revision} + 1`, updatedAt: new Date() })
        .where(eq(trainingSchedules.id, scheduleId));
      return "updated" as const;
    });
    if (result === null || result === "revision_conflict" || result === "schedule_unavailable") return result;
    return this.findSchedule(userId, scheduleId);
  }

  public async listSessions(
    userId: string,
    filter?: { readonly status?: TrainingSessionStatus; readonly dateFrom?: string; readonly dateTo?: string },
  ): Promise<readonly TrainingSession[]> {
    const conditions = [eq(trainingSessions.userId, userId)];
    if (filter?.status !== undefined) conditions.push(eq(trainingSessions.status, filter.status));
    if (filter?.dateFrom !== undefined) conditions.push(gte(trainingSessions.localDate, filter.dateFrom));
    if (filter?.dateTo !== undefined) conditions.push(lte(trainingSessions.localDate, filter.dateTo));
    const rows = await this.#database
      .select()
      .from(trainingSessions)
      .where(and(...conditions))
      .orderBy(desc(trainingSessions.startedAt));
    return this.#withSessionItems(rows);
  }

  public async findSession(userId: string, sessionId: string): Promise<TrainingSession | null> {
    const [row] = await this.#database
      .select()
      .from(trainingSessions)
      .where(and(eq(trainingSessions.id, sessionId), eq(trainingSessions.userId, userId)))
      .limit(1);
    if (row === undefined) return null;
    return (await this.#withSessionItems([row]))[0] ?? null;
  }

  public async listSessionItemRevisions(
    userId: string,
    sessionId: string,
  ): Promise<readonly TrainingSessionItemRevision[]> {
    const [session] = await this.#database
      .select({ id: trainingSessions.id })
      .from(trainingSessions)
      .where(and(eq(trainingSessions.id, sessionId), eq(trainingSessions.userId, userId)))
      .limit(1);
    if (session === undefined) return [];
    const rows = await this.#database
      .select()
      .from(trainingSessionItemRevisions)
      .where(eq(trainingSessionItemRevisions.sessionId, sessionId))
      .orderBy(desc(trainingSessionItemRevisions.createdAt));
    return rows.map(toSessionItemRevision);
  }

  public async listSessionRevisions(
    userId: string,
    sessionId: string,
  ): Promise<readonly TrainingSessionRevision[]> {
    const [session] = await this.#database
      .select({ id: trainingSessions.id })
      .from(trainingSessions)
      .where(and(eq(trainingSessions.id, sessionId), eq(trainingSessions.userId, userId)))
      .limit(1);
    if (session === undefined) return [];
    const rows = await this.#database
      .select()
      .from(trainingSessionRevisions)
      .where(eq(trainingSessionRevisions.sessionId, sessionId))
      .orderBy(desc(trainingSessionRevisions.createdAt));
    return rows.map(toSessionRevision);
  }

  public async updateSessionMetadata(
    userId: string,
    sessionId: string,
    expectedRevision: number,
    input: TrainingSessionMetadataUpdate,
  ): Promise<TrainingSession | "revision_conflict" | null> {
    const result = await this.#database.transaction(async (transaction) => {
      const [session] = await transaction
        .select()
        .from(trainingSessions)
        .where(and(eq(trainingSessions.id, sessionId), eq(trainingSessions.userId, userId)))
        .for("update")
        .limit(1);
      if (session === undefined) return null;
      if (session.revision !== expectedRevision) return "revision_conflict" as const;
      await transaction.insert(trainingSessionRevisions).values({
        sessionId,
        sessionRevision: session.revision,
        localDate: session.localDate,
        timeZone: session.timeZone,
        note: session.note,
        expenditureAssessment: session.expenditureAssessment,
      });
      await transaction
        .update(trainingSessions)
        .set({ ...input, revision: sql`${trainingSessions.revision} + 1`, updatedAt: new Date() })
        .where(eq(trainingSessions.id, sessionId));
      return "updated" as const;
    });
    if (result === null || result === "revision_conflict") return result;
    return this.findSession(userId, sessionId);
  }

  public async updateSessionExpenditure(
    userId: string,
    sessionId: string,
    expectedRevision: number,
    assessment: TrainingExpenditureAssessment,
  ): Promise<TrainingSession | "revision_conflict" | null> {
    const result = await this.#database.transaction(async (transaction) => {
      const [session] = await transaction
        .select()
        .from(trainingSessions)
        .where(and(eq(trainingSessions.id, sessionId), eq(trainingSessions.userId, userId)))
        .for("update")
        .limit(1);
      if (session === undefined) return null;
      if (session.revision !== expectedRevision) return "revision_conflict" as const;
      await transaction.insert(trainingSessionRevisions).values({
        sessionId,
        sessionRevision: session.revision,
        localDate: session.localDate,
        timeZone: session.timeZone,
        note: session.note,
        expenditureAssessment: session.expenditureAssessment,
      });
      await transaction
        .update(trainingSessions)
        .set({ expenditureAssessment: assessment as unknown as Record<string, unknown>, revision: sql`${trainingSessions.revision} + 1`, updatedAt: new Date() })
        .where(eq(trainingSessions.id, sessionId));
      return "updated" as const;
    });
    if (result === null || result === "revision_conflict") return result;
    return this.findSession(userId, sessionId);
  }

  public async startSession(input: {
    readonly userId: string;
    readonly template: TrainingTemplate | null;
    readonly program: TrainingProgram | null;
    readonly programUnit: TrainingProgramUnit | null;
    readonly schedule: TrainingSchedule | null;
    readonly timeZone: string;
    readonly localDate: string;
    readonly startedAt: Date;
  }): Promise<TrainingSession | "schedule_unavailable"> {
    const sessionId = await this.#database.transaction(async (transaction) => {
      if (input.schedule !== null) {
        const [schedule] = await transaction
          .select({ cancelledAt: trainingSchedules.cancelledAt })
          .from(trainingSchedules)
          .where(and(eq(trainingSchedules.id, input.schedule.id), eq(trainingSchedules.userId, input.userId)))
          .for("update")
          .limit(1);
        if (schedule === undefined || schedule.cancelledAt !== null) return "schedule_unavailable" as const;
        const [started] = await transaction
          .select({ id: trainingSessions.id })
          .from(trainingSessions)
          .where(eq(trainingSessions.sourceScheduleId, input.schedule.id))
          .limit(1);
        if (started !== undefined) return "schedule_unavailable" as const;
      }
      const [session] = await transaction
        .insert(trainingSessions)
        .values({
          userId: input.userId,
          sourceScheduleId: input.schedule?.id ?? null,
          sourceScheduleTitle: input.schedule?.title ?? null,
          sourceTemplateId: input.template?.id ?? null,
          sourceTemplateName: input.template?.name ?? null,
          sourceProgramId: input.program?.id ?? null,
          sourceProgramName: input.program?.name ?? null,
          sourceProgramUnitId: input.programUnit?.id ?? null,
          sourceWeekNumber: input.programUnit?.weekNumber ?? null,
          sourceTrainingDayName: input.programUnit?.name ?? null,
          timeZone: input.timeZone,
          localDate: input.localDate,
          startedAt: input.startedAt,
        })
        .returning({ id: trainingSessions.id });
      if (session === undefined) throw new Error("training session insert returned no row");
      const sourceItems = input.programUnit?.items ?? input.template?.items ?? [];
      if (sourceItems.length > 0) {
        await transaction.insert(trainingSessionItems).values(
          sourceItems.map((item) => ({
            sessionId: session.id,
            sourceTemplateItemId: input.programUnit === null ? item.id : null,
            origin: "planned" as const,
            sortOrder: item.sortOrder,
            exerciseName: item.exerciseName,
            targetSets: item.targetSets,
            targetRepsMin: item.targetRepsMin,
            targetRepsMax: item.targetRepsMax,
            targetWeightKg: item.targetWeightKg,
            targetDurationSeconds: item.targetDurationSeconds,
            targetDistanceMeters: item.targetDistanceMeters,
            targetNote: item.note,
          })),
        );
      }
      return session.id;
    });
    if (sessionId === "schedule_unavailable") return sessionId;
    const session = await this.findSession(input.userId, sessionId);
    if (session === null) throw new Error("created training session not found");
    return session;
  }

  public async updateSessionItem(
    userId: string,
    sessionId: string,
    itemId: string,
    expectedRevision: number,
    input: TrainingSessionItemUpdate,
  ): Promise<TrainingSession | "revision_conflict" | null> {
    const result = await this.#database.transaction(async (transaction) => {
      const [session] = await transaction
        .select({ revision: trainingSessions.revision })
        .from(trainingSessions)
        .where(and(eq(trainingSessions.id, sessionId), eq(trainingSessions.userId, userId)))
        .for("update")
        .limit(1);
      if (session === undefined) return null;
      if (session.revision !== expectedRevision) return "revision_conflict" as const;
      const [item] = await transaction
        .select()
        .from(trainingSessionItems)
        .where(and(eq(trainingSessionItems.id, itemId), eq(trainingSessionItems.sessionId, sessionId)))
        .limit(1);
      if (item === undefined) return null;
      const previousSets = await transaction
        .select()
        .from(trainingSessionSets)
        .where(eq(trainingSessionSets.sessionItemId, itemId))
        .orderBy(asc(trainingSessionSets.sequence));
      await transaction.insert(trainingSessionItemRevisions).values({
        sessionId,
        sessionItemId: itemId,
        sessionRevision: session.revision,
        status: item.status,
        performedExerciseName: item.performedExerciseName,
        actualNote: item.actualNote,
        setsSnapshot: previousSets.map((set) => ({
          id: set.id,
          sequence: set.sequence,
          reps: set.reps,
          weightKg: set.weightKg,
          durationSeconds: set.durationSeconds,
          distanceMeters: set.distanceMeters,
          note: set.note,
        })),
      });
      await transaction
        .update(trainingSessionItems)
        .set({
          status: input.status,
          performedExerciseName: input.performedExerciseName,
          actualNote: input.actualNote,
          updatedAt: new Date(),
        })
        .where(eq(trainingSessionItems.id, itemId));
      await transaction.delete(trainingSessionSets).where(eq(trainingSessionSets.sessionItemId, itemId));
      if (input.sets.length > 0) {
        await transaction.insert(trainingSessionSets).values(
          input.sets.map((set, index) => ({ sessionItemId: itemId, sequence: index + 1, ...set })),
        );
      }
      await transaction
        .update(trainingSessions)
        .set({ revision: sql`${trainingSessions.revision} + 1`, updatedAt: new Date() })
        .where(eq(trainingSessions.id, sessionId));
      return "updated" as const;
    });
    if (result === null || result === "revision_conflict") return result;
    return this.findSession(userId, sessionId);
  }

  public async addExtraSessionItem(
    userId: string,
    sessionId: string,
    expectedRevision: number,
    input: ExtraTrainingItemInput,
  ): Promise<TrainingSession | "revision_conflict" | null> {
    const result = await this.#database.transaction(async (transaction) => {
      const [session] = await transaction
        .select({ revision: trainingSessions.revision })
        .from(trainingSessions)
        .where(and(eq(trainingSessions.id, sessionId), eq(trainingSessions.userId, userId)))
        .for("update")
        .limit(1);
      if (session === undefined) return null;
      if (session.revision !== expectedRevision) return "revision_conflict" as const;
      const [{ nextOrder } = { nextOrder: 0 }] = await transaction
        .select({ nextOrder: sql<number>`coalesce(max(${trainingSessionItems.sortOrder}), -1) + 1` })
        .from(trainingSessionItems)
        .where(eq(trainingSessionItems.sessionId, sessionId));
      const [item] = await transaction
        .insert(trainingSessionItems)
        .values({
          sessionId,
          origin: "extra",
          status: "completed",
          sortOrder: Number(nextOrder),
          exerciseName: input.exerciseName,
          performedExerciseName: input.exerciseName,
          actualNote: input.actualNote,
        })
        .returning({ id: trainingSessionItems.id });
      if (item === undefined) throw new Error("extra training item insert returned no row");
      if (input.sets.length > 0) {
        await transaction.insert(trainingSessionSets).values(
          input.sets.map((set, index) => ({ sessionItemId: item.id, sequence: index + 1, ...set })),
        );
      }
      await transaction
        .update(trainingSessions)
        .set({ revision: sql`${trainingSessions.revision} + 1`, updatedAt: new Date() })
        .where(eq(trainingSessions.id, sessionId));
      return "updated" as const;
    });
    if (result === null || result === "revision_conflict") return result;
    return this.findSession(userId, sessionId);
  }

  public async finishSession(
    userId: string,
    sessionId: string,
    expectedRevision: number,
    status: "completed" | "abandoned",
    endedAt: Date,
  ): Promise<TrainingSession | "revision_conflict" | null> {
    const [updated] = await this.#database
      .update(trainingSessions)
      .set({
        status,
        endedAt,
        revision: sql`${trainingSessions.revision} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(trainingSessions.id, sessionId),
          eq(trainingSessions.userId, userId),
          eq(trainingSessions.status, "in_progress"),
          eq(trainingSessions.revision, expectedRevision),
        ),
      )
      .returning({ id: trainingSessions.id });
    if (updated !== undefined) return this.findSession(userId, sessionId);
    const existing = await this.findSession(userId, sessionId);
    return existing === null ? null : "revision_conflict";
  }

  async #withTemplateItems(rows: readonly TemplateRow[]): Promise<readonly TrainingTemplate[]> {
    if (rows.length === 0) return [];
    const items = await this.#database
      .select()
      .from(trainingTemplateItems)
      .where(inArray(trainingTemplateItems.templateId, rows.map((row) => row.id)))
      .orderBy(asc(trainingTemplateItems.sortOrder));
    return rows.map((row) => toTemplate(row, items.filter((item) => item.templateId === row.id)));
  }

  async #withScheduleStatus(rows: readonly ScheduleRow[]): Promise<readonly TrainingSchedule[]> {
    if (rows.length === 0) return [];
    const startedSessions = await this.#database
      .select({ id: trainingSessions.id, sourceScheduleId: trainingSessions.sourceScheduleId })
      .from(trainingSessions)
      .where(inArray(trainingSessions.sourceScheduleId, rows.map((row) => row.id)));
    return rows.map((row) =>
      toSchedule(
        row,
        startedSessions.find((session) => session.sourceScheduleId === row.id)?.id ?? null,
      ),
    );
  }

  async #withProgramUnits(rows: readonly ProgramRow[]): Promise<readonly TrainingProgram[]> {
    if (rows.length === 0) return [];
    const units = await this.#database
      .select()
      .from(trainingProgramUnits)
      .where(inArray(trainingProgramUnits.programId, rows.map((row) => row.id)))
      .orderBy(asc(trainingProgramUnits.weekNumber), asc(trainingProgramUnits.sortOrder));
    const items = units.length === 0
      ? []
      : await this.#database
          .select()
          .from(trainingProgramUnitItems)
          .where(inArray(trainingProgramUnitItems.unitId, units.map((unit) => unit.id)))
          .orderBy(asc(trainingProgramUnitItems.sortOrder));
    const startedRows = units.length === 0
      ? []
      : await this.#database
          .select({ unitId: trainingSessions.sourceProgramUnitId })
          .from(trainingSessions)
          .where(inArray(trainingSessions.sourceProgramUnitId, units.map((unit) => unit.id)));
    const startedIds = new Set(
      startedRows.flatMap((row) => (row.unitId === null ? [] : [row.unitId])),
    );
    return rows.map((row) =>
      toProgram(
        row,
        units
          .filter((unit) => unit.programId === row.id)
          .map((unit) =>
            toProgramUnit(
              unit,
              items.filter((item) => item.unitId === unit.id),
              startedIds.has(unit.id),
            ),
          ),
      ),
    );
  }

  async #withSessionItems(rows: readonly SessionRow[]): Promise<readonly TrainingSession[]> {
    if (rows.length === 0) return [];
    const items = await this.#database
      .select()
      .from(trainingSessionItems)
      .where(inArray(trainingSessionItems.sessionId, rows.map((row) => row.id)))
      .orderBy(asc(trainingSessionItems.sortOrder));
    const sets = items.length === 0
      ? []
      : await this.#database
          .select()
          .from(trainingSessionSets)
          .where(inArray(trainingSessionSets.sessionItemId, items.map((item) => item.id)))
          .orderBy(asc(trainingSessionSets.sequence));
    return rows.map((row) =>
      toSession(
        row,
        items.filter((item) => item.sessionId === row.id),
        sets,
      ),
    );
  }
}
