import { randomUUID } from "node:crypto";

import type { TrainingSuggestionRepository } from "./repository.js";
import type { TrainingSuggestion, TrainingSuggestionCandidate, TrainingSuggestionInputSnapshot } from "./types.js";

export class MemoryTrainingSuggestionRepository implements TrainingSuggestionRepository {
  public readonly values = new Map<string, TrainingSuggestion>();

  public async list(userId: string): Promise<readonly TrainingSuggestion[]> {
    return [...this.values.values()].filter((value) => value.userId === userId).sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  }

  public async find(userId: string, suggestionId: string): Promise<TrainingSuggestion | null> {
    const value = this.values.get(suggestionId);
    return value?.userId === userId ? value : null;
  }

  public async create(userId: string, input: { methodVersion: string; evidenceIds: readonly string[]; inputSnapshot: TrainingSuggestionInputSnapshot; candidate: TrainingSuggestionCandidate }): Promise<TrainingSuggestion> {
    const createdAt = new Date();
    const value: TrainingSuggestion = { id: randomUUID(), userId, status: "active", methodVersion: input.methodVersion, evidenceIds: input.evidenceIds, inputSnapshot: input.inputSnapshot, candidate: input.candidate, adoptedTemplateId: null, revision: 1, adoptedAt: null, dismissedAt: null, createdAt, updatedAt: createdAt };
    this.values.set(value.id, value);
    return value;
  }

  public async markAdopted(userId: string, suggestionId: string, expectedRevision: number, templateId: string, at: Date): Promise<TrainingSuggestion | "revision_conflict" | null> {
    const value = await this.find(userId, suggestionId);
    if (value === null) return null;
    if (value.revision !== expectedRevision || value.status !== "active") return "revision_conflict";
    const updated = { ...value, status: "adopted" as const, adoptedTemplateId: templateId, adoptedAt: at, revision: value.revision + 1, updatedAt: at };
    this.values.set(value.id, updated);
    return updated;
  }

  public async dismiss(userId: string, suggestionId: string, expectedRevision: number, at: Date): Promise<TrainingSuggestion | "revision_conflict" | null> {
    const value = await this.find(userId, suggestionId);
    if (value === null) return null;
    if (value.revision !== expectedRevision || value.status !== "active") return "revision_conflict";
    const updated = { ...value, status: "dismissed" as const, dismissedAt: at, revision: value.revision + 1, updatedAt: at };
    this.values.set(value.id, updated);
    return updated;
  }
}
