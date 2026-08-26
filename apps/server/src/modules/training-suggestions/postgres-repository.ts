import { and, desc, eq } from "drizzle-orm";

import type { Database } from "../../db/database.js";
import { trainingSuggestions } from "../../db/schema/index.js";
import type { TrainingSuggestionRepository } from "./repository.js";
import type { TrainingSuggestion, TrainingSuggestionCandidate, TrainingSuggestionInputSnapshot } from "./types.js";

type Row = typeof trainingSuggestions.$inferSelect;
function map(row: Row): TrainingSuggestion {
  return { ...row, inputSnapshot: row.inputSnapshot as unknown as TrainingSuggestionInputSnapshot, candidate: row.candidate as unknown as TrainingSuggestionCandidate };
}

export class PostgresTrainingSuggestionRepository implements TrainingSuggestionRepository {
  public constructor(private readonly database: Database) {}
  public async list(userId: string) { return (await this.database.select().from(trainingSuggestions).where(eq(trainingSuggestions.userId, userId)).orderBy(desc(trainingSuggestions.createdAt))).map(map); }
  public async find(userId: string, suggestionId: string) { const [row] = await this.database.select().from(trainingSuggestions).where(and(eq(trainingSuggestions.id, suggestionId), eq(trainingSuggestions.userId, userId))).limit(1); return row === undefined ? null : map(row); }
  public async create(userId: string, input: { methodVersion: string; evidenceIds: readonly string[]; inputSnapshot: TrainingSuggestionInputSnapshot; candidate: TrainingSuggestionCandidate }) { const [row] = await this.database.insert(trainingSuggestions).values({ userId, methodVersion: input.methodVersion, evidenceIds: input.evidenceIds, inputSnapshot: input.inputSnapshot as unknown as Record<string, unknown>, candidate: input.candidate as unknown as Record<string, unknown> }).returning(); if (row === undefined) throw new Error("training suggestion insert returned no row"); return map(row); }
  public async markAdopted(userId: string, suggestionId: string, expectedRevision: number, templateId: string, at: Date) { const [row] = await this.database.update(trainingSuggestions).set({ status: "adopted", adoptedTemplateId: templateId, adoptedAt: at, revision: expectedRevision + 1, updatedAt: at }).where(and(eq(trainingSuggestions.id, suggestionId), eq(trainingSuggestions.userId, userId), eq(trainingSuggestions.revision, expectedRevision), eq(trainingSuggestions.status, "active"))).returning(); if (row !== undefined) return map(row); return (await this.find(userId, suggestionId)) === null ? null : "revision_conflict" as const; }
  public async dismiss(userId: string, suggestionId: string, expectedRevision: number, at: Date) { const [row] = await this.database.update(trainingSuggestions).set({ status: "dismissed", dismissedAt: at, revision: expectedRevision + 1, updatedAt: at }).where(and(eq(trainingSuggestions.id, suggestionId), eq(trainingSuggestions.userId, userId), eq(trainingSuggestions.revision, expectedRevision), eq(trainingSuggestions.status, "active"))).returning(); if (row !== undefined) return map(row); return (await this.find(userId, suggestionId)) === null ? null : "revision_conflict" as const; }
}
