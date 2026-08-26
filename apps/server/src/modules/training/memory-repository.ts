import { randomUUID } from "node:crypto";

import type { TrainingRepository } from "./repository.js";
import type {
  ExtraTrainingItemInput,
  TrainingExpenditureAssessment,
  TrainingProgram,
  TrainingProgramInput,
  TrainingProgramUnit,
  TrainingProgramUnitInput,
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

function now(): Date {
  return new Date();
}

function templateItems(input: TrainingTemplateInput) {
  return input.items.map((item, sortOrder) => ({ id: randomUUID(), sortOrder, ...item }));
}

function unitItems(input: TrainingProgramUnitInput) {
  return input.items.map((item, sortOrder) => ({ id: randomUUID(), sortOrder, ...item }));
}

function sessionSets(input: TrainingSessionItemUpdate["sets"]) {
  return input.map((set, index) => ({ id: randomUUID(), sequence: index + 1, ...set }));
}

export class MemoryTrainingRepository implements TrainingRepository {
  public readonly templates = new Map<string, TrainingTemplate>();
  public readonly suggestionTemplates = new Map<string, string>();
  private readonly suggestionTemplateCreations = new Map<string, Promise<TrainingTemplate>>();
  public readonly programs = new Map<string, TrainingProgram>();
  public readonly schedules = new Map<string, TrainingSchedule>();
  public readonly sessions = new Map<string, TrainingSession>();
  public readonly itemRevisions: TrainingSessionItemRevision[] = [];
  public readonly sessionRevisions: TrainingSessionRevision[] = [];

  public async listTemplates(
    userId: string,
    includeArchived: boolean,
  ): Promise<readonly TrainingTemplate[]> {
    return [...this.templates.values()]
      .filter(
        (template) =>
          template.userId === userId && (includeArchived || template.archivedAt === null),
      )
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
  }

  public async findTemplate(userId: string, templateId: string): Promise<TrainingTemplate | null> {
    const template = this.templates.get(templateId);
    return template?.userId === userId ? template : null;
  }

  public async createTemplate(
    userId: string,
    input: TrainingTemplateInput,
  ): Promise<TrainingTemplate> {
    const createdAt = now();
    const template: TrainingTemplate = {
      id: randomUUID(),
      userId,
      name: input.name,
      note: input.note,
      revision: 1,
      archivedAt: null,
      createdAt,
      updatedAt: createdAt,
      items: templateItems(input),
    };
    this.templates.set(template.id, template);
    return template;
  }

  public async createTemplateFromSuggestion(
    userId: string,
    suggestionId: string,
    input: TrainingTemplateInput,
  ): Promise<TrainingTemplate> {
    const key = `${userId}:${suggestionId}`;
    const existingId = this.suggestionTemplates.get(key);
    if (existingId !== undefined) {
      const existing = await this.findTemplate(userId, existingId);
      if (existing !== null) return existing;
    }
    const inFlight = this.suggestionTemplateCreations.get(key);
    if (inFlight !== undefined) return inFlight;
    const creation = this.createTemplate(userId, input).then((created) => {
      this.suggestionTemplates.set(key, created.id);
      return created;
    });
    this.suggestionTemplateCreations.set(key, creation);
    try {
      return await creation;
    } finally {
      this.suggestionTemplateCreations.delete(key);
    }
  }

  public async updateTemplate(
    userId: string,
    templateId: string,
    expectedRevision: number,
    input: TrainingTemplateInput,
  ): Promise<TrainingTemplate | "revision_conflict" | null> {
    const existing = await this.findTemplate(userId, templateId);
    if (existing === null) return null;
    if (existing.revision !== expectedRevision) return "revision_conflict";
    const updated: TrainingTemplate = {
      ...existing,
      name: input.name,
      note: input.note,
      revision: existing.revision + 1,
      updatedAt: now(),
      items: templateItems(input),
    };
    this.templates.set(templateId, updated);
    return updated;
  }

  public async setTemplateArchived(
    userId: string,
    templateId: string,
    expectedRevision: number,
    archivedAt: Date | null,
  ): Promise<TrainingTemplate | "revision_conflict" | null> {
    const existing = await this.findTemplate(userId, templateId);
    if (existing === null) return null;
    if (existing.revision !== expectedRevision) return "revision_conflict";
    const updated = {
      ...existing,
      archivedAt,
      revision: existing.revision + 1,
      updatedAt: now(),
    };
    this.templates.set(templateId, updated);
    return updated;
  }

  public async listPrograms(
    userId: string,
    includeArchived: boolean,
  ): Promise<readonly TrainingProgram[]> {
    return [...this.programs.values()]
      .filter(
        (program) => program.userId === userId && (includeArchived || program.archivedAt === null),
      )
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
  }

  public async findProgram(userId: string, programId: string): Promise<TrainingProgram | null> {
    const program = this.programs.get(programId);
    return program?.userId === userId ? program : null;
  }

  public async createProgram(userId: string, input: TrainingProgramInput): Promise<TrainingProgram> {
    const createdAt = now();
    const program: TrainingProgram = {
      id: randomUUID(),
      userId,
      name: input.name,
      note: input.note,
      weekCount: input.weekCount,
      revision: 1,
      archivedAt: null,
      createdAt,
      updatedAt: createdAt,
      units: [],
    };
    this.programs.set(program.id, program);
    return program;
  }

  public async updateProgram(
    userId: string,
    programId: string,
    expectedRevision: number,
    input: TrainingProgramInput,
  ): Promise<TrainingProgram | "revision_conflict" | null> {
    const existing = await this.findProgram(userId, programId);
    if (existing === null) return null;
    if (existing.revision !== expectedRevision) return "revision_conflict";
    const updated: TrainingProgram = {
      ...existing,
      ...input,
      revision: existing.revision + 1,
      updatedAt: now(),
    };
    this.programs.set(programId, updated);
    return updated;
  }

  public async setProgramArchived(
    userId: string,
    programId: string,
    expectedRevision: number,
    archivedAt: Date | null,
  ): Promise<TrainingProgram | "revision_conflict" | null> {
    const existing = await this.findProgram(userId, programId);
    if (existing === null) return null;
    if (existing.revision !== expectedRevision) return "revision_conflict";
    const updated = {
      ...existing,
      archivedAt,
      revision: existing.revision + 1,
      updatedAt: now(),
    };
    this.programs.set(programId, updated);
    return updated;
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
    const existing = await this.findProgram(userId, programId);
    if (existing === null) return null;
    if (existing.revision !== expectedRevision) return "revision_conflict";
    const createdAt = now();
    const unit: TrainingProgramUnit = {
      id: randomUUID(),
      weekNumber: input.weekNumber,
      sortOrder: existing.units.filter((candidate) => candidate.weekNumber === input.weekNumber).length,
      name: input.name,
      note: input.note,
      sourceTemplateId: input.sourceTemplateId,
      sourceTemplateName: input.sourceTemplateName,
      sourceTemplateRevision: input.sourceTemplateRevision,
      importedAt: input.importedAt,
      started: false,
      createdAt,
      updatedAt: createdAt,
      items: unitItems(input),
    };
    const updated = {
      ...existing,
      revision: existing.revision + 1,
      updatedAt: now(),
      units: [...existing.units, unit].sort(
        (left, right) => left.weekNumber - right.weekNumber || left.sortOrder - right.sortOrder,
      ),
    };
    this.programs.set(programId, updated);
    return updated;
  }

  public async updateProgramUnit(
    userId: string,
    programId: string,
    unitId: string,
    expectedRevision: number,
    input: TrainingProgramUnitInput,
  ): Promise<TrainingProgram | "revision_conflict" | "unit_started" | null> {
    const existing = await this.findProgram(userId, programId);
    if (existing === null) return null;
    if (existing.revision !== expectedRevision) return "revision_conflict";
    const unit = existing.units.find((candidate) => candidate.id === unitId);
    if (unit === undefined) return null;
    if (unit.started) return "unit_started";
    const nextOrder = existing.units.filter(
      (candidate) => candidate.id !== unitId && candidate.weekNumber === input.weekNumber,
    ).length;
    const updatedUnit: TrainingProgramUnit = {
      ...unit,
      weekNumber: input.weekNumber,
      sortOrder: unit.weekNumber === input.weekNumber ? unit.sortOrder : nextOrder,
      name: input.name,
      note: input.note,
      updatedAt: now(),
      items: unitItems(input),
    };
    const updated = {
      ...existing,
      revision: existing.revision + 1,
      updatedAt: now(),
      units: existing.units.map((candidate) => (candidate.id === unitId ? updatedUnit : candidate)),
    };
    this.programs.set(programId, updated);
    return updated;
  }

  public async reimportProgramUnit(
    userId: string,
    programId: string,
    unitId: string,
    expectedRevision: number,
    template: TrainingTemplate,
    importedAt: Date,
  ): Promise<TrainingProgram | "revision_conflict" | "unit_started" | null> {
    const existing = await this.findProgram(userId, programId);
    if (existing === null) return null;
    if (existing.revision !== expectedRevision) return "revision_conflict";
    const unit = existing.units.find((candidate) => candidate.id === unitId);
    if (unit === undefined) return null;
    if (unit.started) return "unit_started";
    const updatedUnit: TrainingProgramUnit = {
      ...unit,
      name: template.name,
      note: template.note,
      sourceTemplateId: template.id,
      sourceTemplateName: template.name,
      sourceTemplateRevision: template.revision,
      importedAt,
      updatedAt: now(),
      items: template.items.map((item) => ({ ...item, id: randomUUID() })),
    };
    const updated = {
      ...existing,
      revision: existing.revision + 1,
      updatedAt: now(),
      units: existing.units.map((candidate) => (candidate.id === unitId ? updatedUnit : candidate)),
    };
    this.programs.set(programId, updated);
    return updated;
  }

  public async listSchedules(
    userId: string,
    dateFrom?: string,
    dateTo?: string,
  ): Promise<readonly TrainingSchedule[]> {
    return [...this.schedules.values()]
      .filter(
        (schedule) =>
          schedule.userId === userId &&
          (dateFrom === undefined || schedule.localDate >= dateFrom) &&
          (dateTo === undefined || schedule.localDate <= dateTo),
      )
      .sort((left, right) => left.localDate.localeCompare(right.localDate) || left.createdAt.getTime() - right.createdAt.getTime());
  }

  public async findSchedule(userId: string, scheduleId: string): Promise<TrainingSchedule | null> {
    const schedule = this.schedules.get(scheduleId);
    return schedule?.userId === userId ? schedule : null;
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
    const createdAt = now();
    const schedule: TrainingSchedule = {
      id: randomUUID(),
      userId,
      ...input,
      status: "scheduled",
      revision: 1,
      cancelledAt: null,
      startedSessionId: null,
      createdAt,
      updatedAt: createdAt,
    };
    this.schedules.set(schedule.id, schedule);
    return schedule;
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
    const existing = await this.findSchedule(userId, scheduleId);
    if (existing === null) return null;
    if (existing.revision !== expectedRevision) return "revision_conflict";
    if (existing.status !== "scheduled") return "schedule_unavailable";
    const updated: TrainingSchedule = {
      ...existing,
      ...input,
      revision: existing.revision + 1,
      updatedAt: now(),
    };
    this.schedules.set(scheduleId, updated);
    return updated;
  }

  public async cancelSchedule(
    userId: string,
    scheduleId: string,
    expectedRevision: number,
    cancelledAt: Date,
  ): Promise<TrainingSchedule | "revision_conflict" | "schedule_unavailable" | null> {
    const existing = await this.findSchedule(userId, scheduleId);
    if (existing === null) return null;
    if (existing.revision !== expectedRevision) return "revision_conflict";
    if (existing.status !== "scheduled") return "schedule_unavailable";
    const updated: TrainingSchedule = {
      ...existing,
      status: "cancelled",
      revision: existing.revision + 1,
      cancelledAt,
      updatedAt: now(),
    };
    this.schedules.set(scheduleId, updated);
    return updated;
  }

  public async listSessions(
    userId: string,
    filter?: { readonly status?: TrainingSessionStatus; readonly dateFrom?: string; readonly dateTo?: string },
  ): Promise<readonly TrainingSession[]> {
    return [...this.sessions.values()]
      .filter(
        (session) =>
          session.userId === userId &&
          (filter?.status === undefined || session.status === filter.status) &&
          (filter?.dateFrom === undefined || session.localDate >= filter.dateFrom) &&
          (filter?.dateTo === undefined || session.localDate <= filter.dateTo),
      )
      .sort((left, right) => right.startedAt.getTime() - left.startedAt.getTime());
  }

  public async findSession(userId: string, sessionId: string): Promise<TrainingSession | null> {
    const session = this.sessions.get(sessionId);
    return session?.userId === userId ? session : null;
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
    if (input.schedule !== null) {
      const current = await this.findSchedule(input.userId, input.schedule.id);
      if (current === null || current.status !== "scheduled") return "schedule_unavailable";
    }
    const createdAt = now();
    const sourceItems = input.programUnit?.items ?? input.template?.items ?? [];
    const items: TrainingSessionItem[] =
      sourceItems.map((item) => ({
        id: randomUUID(),
        sourceTemplateItemId: input.programUnit === null ? item.id : null,
        origin: "planned",
        status: "pending",
        sortOrder: item.sortOrder,
        exerciseName: item.exerciseName,
        performedExerciseName: null,
        target: {
          targetSets: item.targetSets,
          targetRepsMin: item.targetRepsMin,
          targetRepsMax: item.targetRepsMax,
          targetWeightKg: item.targetWeightKg,
          targetDurationSeconds: item.targetDurationSeconds,
          targetDistanceMeters: item.targetDistanceMeters,
          note: item.note,
        },
        actualNote: null,
        sets: [],
      }));
    const session: TrainingSession = {
      id: randomUUID(),
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
      status: "in_progress",
      revision: 1,
      timeZone: input.timeZone,
      localDate: input.localDate,
      startedAt: input.startedAt,
      endedAt: null,
      note: null,
      expenditureAssessment: null,
      createdAt,
      updatedAt: createdAt,
      items,
    };
    this.sessions.set(session.id, session);
    if (input.schedule !== null) {
      this.schedules.set(input.schedule.id, {
        ...input.schedule,
        status: "started",
        revision: input.schedule.revision + 1,
        startedSessionId: session.id,
        updatedAt: now(),
      });
    }
    if (input.program !== null && input.programUnit !== null) {
      this.programs.set(input.program.id, {
        ...input.program,
        units: input.program.units.map((unit) =>
          unit.id === input.programUnit?.id ? { ...unit, started: true } : unit,
        ),
      });
    }
    return session;
  }

  public async updateSessionItem(
    userId: string,
    sessionId: string,
    itemId: string,
    expectedRevision: number,
    input: TrainingSessionItemUpdate,
  ): Promise<TrainingSession | "revision_conflict" | null> {
    const session = await this.findSession(userId, sessionId);
    if (session === null) return null;
    if (session.revision !== expectedRevision) return "revision_conflict";
    const previousItem = session.items.find((item) => item.id === itemId);
    if (previousItem === undefined) return null;
    this.itemRevisions.push({
      id: randomUUID(),
      sessionId,
      sessionItemId: itemId,
      sessionRevision: session.revision,
      status: previousItem.status,
      performedExerciseName: previousItem.performedExerciseName,
      actualNote: previousItem.actualNote,
      sets: previousItem.sets.map((set) => ({ ...set })),
      createdAt: now(),
    });
    const updated: TrainingSession = {
      ...session,
      revision: session.revision + 1,
      updatedAt: now(),
      items: session.items.map((item) =>
        item.id === itemId
          ? {
              ...item,
              status: input.status,
              performedExerciseName: input.performedExerciseName,
              actualNote: input.actualNote,
              sets: sessionSets(input.sets),
            }
          : item,
      ),
    };
    this.sessions.set(sessionId, updated);
    return updated;
  }

  public async listSessionItemRevisions(
    userId: string,
    sessionId: string,
  ): Promise<readonly TrainingSessionItemRevision[]> {
    const session = await this.findSession(userId, sessionId);
    if (session === null) return [];
    return this.itemRevisions
      .filter((revision) => revision.sessionId === sessionId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  }

  public async listSessionRevisions(userId: string, sessionId: string): Promise<readonly TrainingSessionRevision[]> {
    const session = await this.findSession(userId, sessionId);
    if (session === null) return [];
    return this.sessionRevisions
      .filter((revision) => revision.sessionId === sessionId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  }

  public async updateSessionMetadata(
    userId: string,
    sessionId: string,
    expectedRevision: number,
    input: TrainingSessionMetadataUpdate,
  ): Promise<TrainingSession | "revision_conflict" | null> {
    const session = await this.findSession(userId, sessionId);
    if (session === null) return null;
    if (session.revision !== expectedRevision) return "revision_conflict";
    this.sessionRevisions.push({
      id: randomUUID(),
      sessionId,
      sessionRevision: session.revision,
      localDate: session.localDate,
      timeZone: session.timeZone,
      note: session.note,
      expenditureAssessment: session.expenditureAssessment,
      createdAt: now(),
    });
    const updated = { ...session, ...input, revision: session.revision + 1, updatedAt: now() };
    this.sessions.set(sessionId, updated);
    return updated;
  }

  public async updateSessionExpenditure(
    userId: string,
    sessionId: string,
    expectedRevision: number,
    assessment: TrainingExpenditureAssessment,
  ): Promise<TrainingSession | "revision_conflict" | null> {
    const session = await this.findSession(userId, sessionId);
    if (session === null) return null;
    if (session.revision !== expectedRevision) return "revision_conflict";
    this.sessionRevisions.push({
      id: randomUUID(),
      sessionId,
      sessionRevision: session.revision,
      localDate: session.localDate,
      timeZone: session.timeZone,
      note: session.note,
      expenditureAssessment: session.expenditureAssessment,
      createdAt: now(),
    });
    const updated = { ...session, expenditureAssessment: assessment, revision: session.revision + 1, updatedAt: now() };
    this.sessions.set(sessionId, updated);
    return updated;
  }

  public async addExtraSessionItem(
    userId: string,
    sessionId: string,
    expectedRevision: number,
    input: ExtraTrainingItemInput,
  ): Promise<TrainingSession | "revision_conflict" | null> {
    const session = await this.findSession(userId, sessionId);
    if (session === null) return null;
    if (session.revision !== expectedRevision) return "revision_conflict";
    const item: TrainingSessionItem = {
      id: randomUUID(),
      sourceTemplateItemId: null,
      origin: "extra",
      status: "completed",
      sortOrder: session.items.length,
      exerciseName: input.exerciseName,
      performedExerciseName: input.exerciseName,
      target: {
        targetSets: null,
        targetRepsMin: null,
        targetRepsMax: null,
        targetWeightKg: null,
        targetDurationSeconds: null,
        targetDistanceMeters: null,
        note: null,
      },
      actualNote: input.actualNote,
      sets: sessionSets(input.sets),
    };
    const updated = {
      ...session,
      revision: session.revision + 1,
      updatedAt: now(),
      items: [...session.items, item],
    };
    this.sessions.set(sessionId, updated);
    return updated;
  }

  public async finishSession(
    userId: string,
    sessionId: string,
    expectedRevision: number,
    status: "completed" | "abandoned",
    endedAt: Date,
  ): Promise<TrainingSession | "revision_conflict" | null> {
    const session = await this.findSession(userId, sessionId);
    if (session === null) return null;
    if (session.revision !== expectedRevision) return "revision_conflict";
    const updated = {
      ...session,
      status,
      revision: session.revision + 1,
      endedAt,
      updatedAt: now(),
    };
    this.sessions.set(sessionId, updated);
    return updated;
  }
}
