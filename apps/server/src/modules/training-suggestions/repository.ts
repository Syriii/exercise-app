import type { TrainingSuggestion, TrainingSuggestionCandidate, TrainingSuggestionInputSnapshot } from "./types.js";

export interface TrainingSuggestionRepository {
  list(userId: string): Promise<readonly TrainingSuggestion[]>;
  find(userId: string, suggestionId: string): Promise<TrainingSuggestion | null>;
  create(userId: string, input: {
    readonly methodVersion: string;
    readonly evidenceIds: readonly string[];
    readonly inputSnapshot: TrainingSuggestionInputSnapshot;
    readonly candidate: TrainingSuggestionCandidate;
  }): Promise<TrainingSuggestion>;
  markAdopted(userId: string, suggestionId: string, expectedRevision: number, templateId: string, at: Date): Promise<TrainingSuggestion | "revision_conflict" | null>;
  dismiss(userId: string, suggestionId: string, expectedRevision: number, at: Date): Promise<TrainingSuggestion | "revision_conflict" | null>;
}
