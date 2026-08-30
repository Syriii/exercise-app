export type TrainingSessionStatus = "in_progress" | "completed" | "abandoned";
export type TrainingSessionItemOrigin = "planned" | "extra";
export type TrainingSessionItemStatus = "pending" | "completed" | "skipped";
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
  readonly mediaAttribution: string | null;
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
  readonly mediaAttribution: string | null;
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
  readonly userId: string;
  readonly name: string;
  readonly note: string | null;
  readonly revision: number;
  readonly archivedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
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
  readonly importedAt: Date | null;
  readonly started: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly items: readonly TrainingTemplateItem[];
}

export interface TrainingProgram {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly note: string | null;
  readonly weekCount: number;
  readonly revision: number;
  readonly archivedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly units: readonly TrainingProgramUnit[];
}

export interface TrainingSchedule {
  readonly id: string;
  readonly userId: string;
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
  readonly cancelledAt: Date | null;
  readonly startedSessionId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
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
  readonly origin: TrainingSessionItemOrigin;
  readonly status: TrainingSessionItemStatus;
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
  readonly status: TrainingSessionItemStatus;
  readonly performedExerciseName: string | null;
  readonly actualNote: string | null;
  readonly sets: readonly TrainingSet[];
  readonly createdAt: Date;
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
    readonly weightMeasurement: {
      readonly id: string;
      readonly revision: number;
      readonly localDate: string;
      readonly weightKg: number;
    } | null;
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
  readonly createdAt: Date;
}

export interface TrainingSession {
  readonly id: string;
  readonly userId: string;
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
  readonly startedAt: Date;
  readonly endedAt: Date | null;
  readonly note: string | null;
  readonly expenditureAssessment: TrainingExpenditureAssessment | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
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

export interface TrainingSessionItemUpdate {
  readonly status: TrainingSessionItemStatus;
  readonly performedExerciseName: string | null;
  readonly actualNote: string | null;
  readonly sets: readonly TrainingSetInput[];
}

export interface TrainingSessionMetadataUpdate {
  readonly localDate: string;
  readonly note: string | null;
}

export interface TrainingExpenditureAssessmentInput {
  readonly activityCode: TrainingExpenditureActivityCode | null;
  readonly durationMinutes: number | null;
}

export interface ExtraTrainingItemInput {
  readonly exerciseName: string;
  readonly actualNote: string | null;
  readonly sets: readonly TrainingSetInput[];
}
