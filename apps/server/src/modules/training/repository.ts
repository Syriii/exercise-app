import type {
  ExtraTrainingItemInput,
  TrainingProgram,
  TrainingProgramInput,
  TrainingProgramUnit,
  TrainingProgramUnitInput,
  TrainingSchedule,
  TrainingScheduleInput,
  TrainingSession,
  TrainingExpenditureAssessment,
  TrainingSessionItemRevision,
  TrainingSessionMetadataUpdate,
  TrainingSessionRevision,
  TrainingSessionItemUpdate,
  TrainingSessionStatus,
  TrainingTemplate,
  TrainingTemplateInput,
} from "./types.js";

export interface TrainingRepository {
  listTemplates(userId: string, includeArchived: boolean): Promise<readonly TrainingTemplate[]>;
  findTemplate(userId: string, templateId: string): Promise<TrainingTemplate | null>;
  createTemplate(userId: string, input: TrainingTemplateInput): Promise<TrainingTemplate>;
  createTemplateFromSuggestion(userId: string, suggestionId: string, input: TrainingTemplateInput): Promise<TrainingTemplate>;
  updateTemplate(
    userId: string,
    templateId: string,
    expectedRevision: number,
    input: TrainingTemplateInput,
  ): Promise<TrainingTemplate | "revision_conflict" | null>;
  setTemplateArchived(
    userId: string,
    templateId: string,
    expectedRevision: number,
    archivedAt: Date | null,
  ): Promise<TrainingTemplate | "revision_conflict" | null>;
  listPrograms(userId: string, includeArchived: boolean): Promise<readonly TrainingProgram[]>;
  findProgram(userId: string, programId: string): Promise<TrainingProgram | null>;
  createProgram(userId: string, input: TrainingProgramInput): Promise<TrainingProgram>;
  updateProgram(
    userId: string,
    programId: string,
    expectedRevision: number,
    input: TrainingProgramInput,
  ): Promise<TrainingProgram | "revision_conflict" | null>;
  setProgramArchived(
    userId: string,
    programId: string,
    expectedRevision: number,
    archivedAt: Date | null,
  ): Promise<TrainingProgram | "revision_conflict" | null>;
  addProgramUnit(
    userId: string,
    programId: string,
    expectedRevision: number,
    input: TrainingProgramUnitInput & {
      readonly sourceTemplateId: string | null;
      readonly sourceTemplateName: string | null;
      readonly sourceTemplateRevision: number | null;
      readonly importedAt: Date | null;
    },
  ): Promise<TrainingProgram | "revision_conflict" | null>;
  updateProgramUnit(
    userId: string,
    programId: string,
    unitId: string,
    expectedRevision: number,
    input: TrainingProgramUnitInput,
  ): Promise<TrainingProgram | "revision_conflict" | "unit_started" | null>;
  reimportProgramUnit(
    userId: string,
    programId: string,
    unitId: string,
    expectedRevision: number,
    template: TrainingTemplate,
    importedAt: Date,
  ): Promise<TrainingProgram | "revision_conflict" | "unit_started" | null>;
  listSchedules(
    userId: string,
    dateFrom?: string,
    dateTo?: string,
  ): Promise<readonly TrainingSchedule[]>;
  findSchedule(userId: string, scheduleId: string): Promise<TrainingSchedule | null>;
  createSchedule(userId: string, input: TrainingScheduleInput & {
    readonly sourceTemplateName: string | null;
    readonly sourceProgramName: string | null;
    readonly sourceWeekNumber: number | null;
    readonly sourceTrainingDayName: string | null;
  }): Promise<TrainingSchedule>;
  updateSchedule(
    userId: string,
    scheduleId: string,
    expectedRevision: number,
    input: TrainingScheduleInput & {
      readonly sourceTemplateName: string | null;
      readonly sourceProgramName: string | null;
      readonly sourceWeekNumber: number | null;
      readonly sourceTrainingDayName: string | null;
    },
  ): Promise<TrainingSchedule | "revision_conflict" | "schedule_unavailable" | null>;
  cancelSchedule(
    userId: string,
    scheduleId: string,
    expectedRevision: number,
    cancelledAt: Date,
  ): Promise<TrainingSchedule | "revision_conflict" | "schedule_unavailable" | null>;
  listSessions(
    userId: string,
    filter?: { readonly status?: TrainingSessionStatus; readonly dateFrom?: string; readonly dateTo?: string },
  ): Promise<readonly TrainingSession[]>;
  findSession(userId: string, sessionId: string): Promise<TrainingSession | null>;
  listSessionItemRevisions(userId: string, sessionId: string): Promise<readonly TrainingSessionItemRevision[]>;
  listSessionRevisions(userId: string, sessionId: string): Promise<readonly TrainingSessionRevision[]>;
  updateSessionMetadata(
    userId: string,
    sessionId: string,
    expectedRevision: number,
    input: TrainingSessionMetadataUpdate,
  ): Promise<TrainingSession | "revision_conflict" | null>;
  updateSessionExpenditure(
    userId: string,
    sessionId: string,
    expectedRevision: number,
    assessment: TrainingExpenditureAssessment,
  ): Promise<TrainingSession | "revision_conflict" | null>;
  startSession(input: {
    readonly userId: string;
    readonly template: TrainingTemplate | null;
    readonly program: TrainingProgram | null;
    readonly programUnit: TrainingProgramUnit | null;
    readonly schedule: TrainingSchedule | null;
    readonly timeZone: string;
    readonly localDate: string;
    readonly startedAt: Date;
  }): Promise<TrainingSession | "schedule_unavailable">;
  updateSessionItem(
    userId: string,
    sessionId: string,
    itemId: string,
    expectedRevision: number,
    input: TrainingSessionItemUpdate,
  ): Promise<TrainingSession | "revision_conflict" | null>;
  addExtraSessionItem(
    userId: string,
    sessionId: string,
    expectedRevision: number,
    input: ExtraTrainingItemInput,
  ): Promise<TrainingSession | "revision_conflict" | null>;
  finishSession(
    userId: string,
    sessionId: string,
    expectedRevision: number,
    status: Exclude<TrainingSessionStatus, "in_progress">,
    endedAt: Date,
  ): Promise<TrainingSession | "revision_conflict" | null>;
}
