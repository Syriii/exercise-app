import { apiRequest } from "./client";
import type { TrainingTemplate, TrainingTemplateInput } from "./training";

export type TrainingSuggestionGoal = "general" | "strength" | "hypertrophy" | "power";
export type TrainingExperience = "beginner" | "intermediate" | "advanced";
export type TrainingEquipment = "minimal" | "dumbbells" | "full_gym";
export interface TrainingSuggestionPreferences { goal: TrainingSuggestionGoal; experience: TrainingExperience; equipment: TrainingEquipment; availableDaysPerWeek: number; sessionMinutes: number; hasInjuryOrMedicalLimitation: boolean; }
export interface TrainingSuggestion { id: string; status: "active" | "adopted" | "dismissed"; methodVersion: string; evidenceIds: string[]; inputSnapshot: { generatedOn: string; profileRevision: number; strategyRevision: number; latestMeasurement: { id: string; revision: number; localDate: string } | null; preferences: TrainingSuggestionPreferences }; candidate: { status: "ready" | "stopped"; title: string; weeklyResistanceDays: number | null; publicHealthBaseline: string[]; template: TrainingTemplateInput | null; messages: string[]; limitations: string[] }; adoptedTemplateId: string | null; revision: number; adoptedAt: string | null; dismissedAt: string | null; createdAt: string; updatedAt: string; stale: boolean; }

export const trainingSuggestionApi = {
  list: () => apiRequest<TrainingSuggestion[]>("/api/v1/training-suggestions"),
  generate: (input: TrainingSuggestionPreferences) => apiRequest<TrainingSuggestion>("/api/v1/training-suggestions", { method: "POST", body: JSON.stringify(input) }),
  adopt: (suggestionId: string, revision: number) => apiRequest<{ suggestion: TrainingSuggestion; template: TrainingTemplate }>(`/api/v1/training-suggestions/${suggestionId}/adopt`, { method: "POST", body: JSON.stringify({ revision }) }),
  dismiss: (suggestionId: string, revision: number) => apiRequest<TrainingSuggestion>(`/api/v1/training-suggestions/${suggestionId}/dismiss`, { method: "POST", body: JSON.stringify({ revision }) }),
};
