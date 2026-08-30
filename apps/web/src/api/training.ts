import { apiRequest } from "./client";

export type TrainingSessionStatus = "in_progress" | "completed" | "abandoned";
export type TrainingItemStatus = "pending" | "completed" | "skipped";
export type TrainingScheduleStatus = "scheduled" | "cancelled" | "started";

export interface ExerciseCatalogItem {
  readonly id: string;
  readonly name: string;
  readonly bodyPart: string;
  readonly bodyPartLabel: string;
  readonly equipment: string;
  readonly equipmentLabel: string;
  readonly target: string;
  readonly imageUrl: string | null;
  readonly animationUrl: string | null;
}

export interface ExerciseGuidance {
  readonly id: string;
  readonly exerciseName: string;
  readonly aliases: readonly string[];
  readonly overview: string;
  readonly steps: readonly string[];
  readonly commonMistakes: readonly string[];
  readonly alternatives: readonly string[];
  readonly videoUrl: string | null;
  readonly imageUrl: string | null;
  readonly animationUrl: string | null;
  readonly sourceName: string;
  readonly sourceUrl: string | null;
  readonly license: string;
  readonly version: string;
  readonly reviewStatus: "draft" | "reviewed";
  readonly limitations: string;
}

export interface TrainingTarget {
  readonly targetSets: number | null;
  readonly targetRepsMin: number | null;
  readonly targetRepsMax: number | null;
  readonly targetWeightKg: string | null;
  readonly targetDurationSeconds: number | null;
  readonly targetDistanceMeters: string | null;
  readonly note: string | null;
}

export interface TrainingTemplateItem extends TrainingTarget {
  readonly id: string;
  readonly sortOrder: number;
  readonly exerciseName: string;
}

export interface TrainingTemplate {
  readonly id: string;
  readonly name: string;
  readonly note: string | null;
  readonly revision: number;
  readonly archivedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly items: readonly TrainingTemplateItem[];
}

export interface TrainingProgramUnit {
  readonly id: string;
  readonly weekNumber: number;
  readonly sortOrder: number;
  readonly name: string;
  readonly note: string | null;
  readonly sourceTemplateId: string | null;
  readonly sourceTemplateName: string | null;
  readonly sourceTemplateRevision: number | null;
  readonly importedAt: string | null;
  readonly started: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly items: readonly TrainingTemplateItem[];
}

export interface TrainingProgram {
  readonly id: string;
  readonly name: string;
  readonly note: string | null;
  readonly weekCount: number;
  readonly revision: number;
  readonly archivedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly units: readonly TrainingProgramUnit[];
}

export interface TrainingSchedule {
  readonly id: string;
  readonly localDate: string;
  readonly timeZone: string;
  readonly title: string;
  readonly note: string | null;
  readonly sourceTemplateId: string | null;
  readonly sourceTemplateName: string | null;
  readonly sourceProgramId: string | null;
  readonly sourceProgramName: string | null;
  readonly sourceProgramUnitId: string | null;
  readonly sourceWeekNumber: number | null;
  readonly sourceTrainingDayName: string | null;
  readonly status: TrainingScheduleStatus;
  readonly revision: number;
  readonly cancelledAt: string | null;
  readonly startedSessionId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TrainingSet {
  readonly id: string;
  readonly sequence: number;
  readonly reps: number | null;
  readonly weightKg: string | null;
  readonly durationSeconds: number | null;
  readonly distanceMeters: string | null;
  readonly note: string | null;
}

export interface TrainingSessionItem {
  readonly id: string;
  readonly sourceTemplateItemId: string | null;
  readonly origin: "planned" | "extra";
  readonly status: TrainingItemStatus;
  readonly sortOrder: number;
  readonly exerciseName: string;
  readonly performedExerciseName: string | null;
  readonly target: TrainingTarget;
  readonly actualNote: string | null;
  readonly sets: readonly TrainingSet[];
}

export interface TrainingSessionItemRevision {
  readonly id: string;
  readonly sessionId: string;
  readonly sessionItemId: string;
  readonly sessionRevision: number;
  readonly status: TrainingItemStatus;
  readonly performedExerciseName: string | null;
  readonly actualNote: string | null;
  readonly sets: readonly TrainingSet[];
  readonly createdAt: string;
}

export type TrainingExpenditureActivityCode =
  | "barbell_bench_25rm"
  | "barbell_bench_12rm"
  | "dumbbell_squat_25rm"
  | "dumbbell_squat_12rm"
  | "combined_upper_25rm"
  | "combined_upper_12rm";

export interface TrainingExpenditureActivity {
  readonly code: TrainingExpenditureActivityCode;
  readonly label: string;
  readonly description: string;
  readonly met: number;
  readonly intensity: "moderate" | "vigorous";
}

export interface TrainingExpenditureAssessment {
  readonly status: "estimated" | "unavailable";
  readonly inputSnapshot: {
    readonly sessionId: string;
    readonly sessionRevision: number;
    readonly localDate: string;
    readonly activityCode: TrainingExpenditureActivityCode | null;
    readonly durationMinutes: number | null;
    readonly profileRevision: number;
    readonly weightMeasurement: { readonly id: string; readonly revision: number; readonly localDate: string; readonly weightKg: number } | null;
  };
  readonly activityLabel: string | null;
  readonly activityDescription: string | null;
  readonly met: number | null;
  readonly grossEnergyKcal: number | null;
  readonly netEnergyKcal: number | null;
  readonly methodVersion: "training-expenditure-e003-v1";
  readonly evidenceIds: readonly ["E-003"];
  readonly formula: string;
  readonly messages: readonly string[];
  readonly limitations: readonly string[];
  readonly assessedAt: string;
}

export interface TrainingSessionRevision {
  readonly id: string;
  readonly sessionId: string;
  readonly sessionRevision: number;
  readonly localDate: string;
  readonly timeZone: string;
  readonly note: string | null;
  readonly expenditureAssessment: TrainingExpenditureAssessment | null;
  readonly createdAt: string;
}

export interface TrainingSession {
  readonly id: string;
  readonly sourceScheduleId: string | null;
  readonly sourceScheduleTitle: string | null;
  readonly sourceTemplateId: string | null;
  readonly sourceTemplateName: string | null;
  readonly sourceProgramId: string | null;
  readonly sourceProgramName: string | null;
  readonly sourceProgramUnitId: string | null;
  readonly sourceWeekNumber: number | null;
  readonly sourceTrainingDayName: string | null;
  readonly status: TrainingSessionStatus;
  readonly revision: number;
  readonly timeZone: string;
  readonly localDate: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly note: string | null;
  readonly expenditureAssessment: TrainingExpenditureAssessment | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly items: readonly TrainingSessionItem[];
}

export interface TrainingTemplateItemInput extends TrainingTarget {
  readonly exerciseName: string;
}

export interface TrainingTemplateInput {
  readonly name: string;
  readonly note: string | null;
  readonly items: readonly TrainingTemplateItemInput[];
}

export interface TrainingProgramInput {
  readonly name: string;
  readonly note: string | null;
  readonly weekCount: number;
}

export interface TrainingProgramUnitInput {
  readonly weekNumber: number;
  readonly name: string;
  readonly note: string | null;
  readonly items: readonly TrainingTemplateItemInput[];
}

export interface TrainingScheduleInput {
  readonly localDate: string;
  readonly timeZone: string;
  readonly title: string;
  readonly note: string | null;
  readonly sourceTemplateId: string | null;
  readonly sourceProgramId: string | null;
  readonly sourceProgramUnitId: string | null;
}

export interface TrainingSetInput {
  readonly reps: number | null;
  readonly weightKg: string | null;
  readonly durationSeconds: number | null;
  readonly distanceMeters: string | null;
  readonly note: string | null;
}

export const trainingApi = {
  listExercises: (query: string, limit = 12) =>
    apiRequest<ExerciseCatalogItem[]>(`/api/v1/training/exercises?${new URLSearchParams({ q: query, limit: limit.toString() }).toString()}`),
  listExpenditureActivities: () =>
    apiRequest<TrainingExpenditureActivity[]>("/api/v1/training/expenditure-catalog"),
  getGuidance: (exerciseName: string) =>
    apiRequest<ExerciseGuidance | null>(`/api/v1/training/guidance?${new URLSearchParams({ exerciseName }).toString()}`),
  listTemplates: () => apiRequest<TrainingTemplate[]>("/api/v1/training/templates"),
  createTemplate: (input: TrainingTemplateInput) =>
    apiRequest<TrainingTemplate>("/api/v1/training/templates", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateTemplate: (templateId: string, revision: number, input: TrainingTemplateInput) =>
    apiRequest<TrainingTemplate>(`/api/v1/training/templates/${templateId}`, {
      method: "PUT",
      body: JSON.stringify({ revision, ...input }),
    }),
  archiveTemplate: (templateId: string, revision: number) =>
    apiRequest<TrainingTemplate>(`/api/v1/training/templates/${templateId}/archive`, {
      method: "POST",
      body: JSON.stringify({ revision }),
    }),
  listPrograms: () => apiRequest<TrainingProgram[]>("/api/v1/training/programs"),
  createProgram: (input: TrainingProgramInput) =>
    apiRequest<TrainingProgram>("/api/v1/training/programs", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateProgram: (programId: string, revision: number, input: TrainingProgramInput) =>
    apiRequest<TrainingProgram>(`/api/v1/training/programs/${programId}`, {
      method: "PUT",
      body: JSON.stringify({ revision, ...input }),
    }),
  archiveProgram: (programId: string, revision: number) =>
    apiRequest<TrainingProgram>(`/api/v1/training/programs/${programId}/archive`, {
      method: "POST",
      body: JSON.stringify({ revision }),
    }),
  addProgramUnit: (
    programId: string,
    revision: number,
    sourceTemplateId: string | null,
    input: TrainingProgramUnitInput,
  ) =>
    apiRequest<TrainingProgram>(`/api/v1/training/programs/${programId}/units`, {
      method: "POST",
      body: JSON.stringify({ revision, sourceTemplateId, ...input }),
    }),
  updateProgramUnit: (
    programId: string,
    unitId: string,
    revision: number,
    input: TrainingProgramUnitInput,
  ) =>
    apiRequest<TrainingProgram>(`/api/v1/training/programs/${programId}/units/${unitId}`, {
      method: "PUT",
      body: JSON.stringify({ revision, ...input }),
    }),
  reimportProgramUnit: (programId: string, unitId: string, revision: number) =>
    apiRequest<TrainingProgram>(
      `/api/v1/training/programs/${programId}/units/${unitId}/reimport`,
      { method: "POST", body: JSON.stringify({ revision }) },
    ),
  startProgramUnit: (programId: string, unitId: string, timeZone: string) =>
    apiRequest<TrainingSession>(`/api/v1/training/programs/${programId}/units/${unitId}/start`, {
      method: "POST",
      body: JSON.stringify({ timeZone }),
    }),
  listSchedules: (dateFrom?: string, dateTo?: string) => {
    const query = new URLSearchParams();
    if (dateFrom !== undefined) query.set("dateFrom", dateFrom);
    if (dateTo !== undefined) query.set("dateTo", dateTo);
    const suffix = query.size === 0 ? "" : `?${query.toString()}`;
    return apiRequest<TrainingSchedule[]>(`/api/v1/training/schedules${suffix}`);
  },
  createSchedule: (input: TrainingScheduleInput) =>
    apiRequest<TrainingSchedule>("/api/v1/training/schedules", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateSchedule: (scheduleId: string, revision: number, input: TrainingScheduleInput) =>
    apiRequest<TrainingSchedule>(`/api/v1/training/schedules/${scheduleId}`, {
      method: "PUT",
      body: JSON.stringify({ revision, ...input }),
    }),
  cancelSchedule: (scheduleId: string, revision: number) =>
    apiRequest<TrainingSchedule>(`/api/v1/training/schedules/${scheduleId}/cancel`, {
      method: "POST",
      body: JSON.stringify({ revision }),
    }),
  startScheduledSession: (scheduleId: string) =>
    apiRequest<TrainingSession>(`/api/v1/training/schedules/${scheduleId}/start`, {
      method: "POST",
    }),
  listActiveSessions: () =>
    apiRequest<TrainingSession[]>("/api/v1/training/sessions?status=in_progress"),
  listSessions: (dateFrom?: string, dateTo?: string) => {
    const query = new URLSearchParams();
    if (dateFrom !== undefined) query.set("dateFrom", dateFrom);
    if (dateTo !== undefined) query.set("dateTo", dateTo);
    const suffix = query.size === 0 ? "" : `?${query.toString()}`;
    return apiRequest<TrainingSession[]>(`/api/v1/training/sessions${suffix}`);
  },
  listItemRevisions: (sessionId: string) =>
    apiRequest<TrainingSessionItemRevision[]>(`/api/v1/training/sessions/${sessionId}/item-revisions`),
  listSessionRevisions: (sessionId: string) =>
    apiRequest<TrainingSessionRevision[]>(`/api/v1/training/sessions/${sessionId}/revisions`),
  updateSessionMetadata: (sessionId: string, revision: number, localDate: string, note: string | null) =>
    apiRequest<TrainingSession>(`/api/v1/training/sessions/${sessionId}`, {
      method: "PUT",
      body: JSON.stringify({ revision, localDate, note }),
    }),
  assessSessionExpenditure: (sessionId: string, revision: number, activityCode: TrainingExpenditureActivityCode | null, durationMinutes: number | null) =>
    apiRequest<TrainingSession>(`/api/v1/training/sessions/${sessionId}/expenditure`, {
      method: "PUT",
      body: JSON.stringify({ revision, activityCode, durationMinutes }),
    }),
  startSession: (templateId: string | null, timeZone: string) =>
    apiRequest<TrainingSession>("/api/v1/training/sessions", {
      method: "POST",
      body: JSON.stringify({ templateId, timeZone }),
    }),
  updateItem: (
    sessionId: string,
    itemId: string,
    revision: number,
    status: TrainingItemStatus,
    performedExerciseName: string | null,
    actualNote: string | null,
    sets: readonly TrainingSetInput[],
  ) =>
    apiRequest<TrainingSession>(`/api/v1/training/sessions/${sessionId}/items/${itemId}`, {
      method: "PUT",
      body: JSON.stringify({ revision, status, performedExerciseName, actualNote, sets }),
    }),
  addExtraItem: (
    sessionId: string,
    revision: number,
    exerciseName: string,
    actualNote: string | null,
    sets: readonly TrainingSetInput[],
  ) =>
    apiRequest<TrainingSession>(`/api/v1/training/sessions/${sessionId}/items`, {
      method: "POST",
      body: JSON.stringify({ revision, exerciseName, actualNote, sets }),
    }),
  finishSession: (
    sessionId: string,
    revision: number,
    status: "completed" | "abandoned",
  ) =>
    apiRequest<TrainingSession>(`/api/v1/training/sessions/${sessionId}/finish`, {
      method: "POST",
      body: JSON.stringify({ revision, status }),
    }),
};
