import type { TrainingTemplateInput } from "../training/types.js";

export type TrainingSuggestionGoal = "general" | "strength" | "hypertrophy" | "power";
export type TrainingExperience = "beginner" | "intermediate" | "advanced";
export type TrainingEquipment = "minimal" | "dumbbells" | "full_gym";
export type TrainingSuggestionStatus = "active" | "adopted" | "dismissed";

export interface TrainingSuggestionPreferences {
  readonly goal: TrainingSuggestionGoal;
  readonly experience: TrainingExperience;
  readonly equipment: TrainingEquipment;
  readonly availableDaysPerWeek: number;
  readonly sessionMinutes: number;
  readonly hasInjuryOrMedicalLimitation: boolean;
}

export interface TrainingSuggestionInputSnapshot {
  readonly generatedOn: string;
  readonly profileRevision: number;
  readonly strategyRevision: number;
  readonly latestMeasurement: { readonly id: string; readonly revision: number; readonly localDate: string } | null;
  readonly preferences: TrainingSuggestionPreferences;
}

export interface TrainingSuggestionCandidate {
  readonly status: "ready" | "stopped";
  readonly title: string;
  readonly weeklyResistanceDays: number | null;
  readonly publicHealthBaseline: readonly string[];
  readonly template: TrainingTemplateInput | null;
  readonly messages: readonly string[];
  readonly limitations: readonly string[];
}

export interface TrainingSuggestion {
  readonly id: string;
  readonly userId: string;
  readonly status: TrainingSuggestionStatus;
  readonly methodVersion: string;
  readonly evidenceIds: readonly string[];
  readonly inputSnapshot: TrainingSuggestionInputSnapshot;
  readonly candidate: TrainingSuggestionCandidate;
  readonly adoptedTemplateId: string | null;
  readonly revision: number;
  readonly adoptedAt: Date | null;
  readonly dismissedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface TrainingSuggestionView extends TrainingSuggestion {
  readonly stale: boolean;
}
