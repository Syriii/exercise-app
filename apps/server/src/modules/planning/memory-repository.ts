import { randomUUID } from "node:crypto";

import type { PlanningRepository } from "./repository.js";
import type {
  BodyMeasurement,
  DailyPlanningReference,
  GoalStrategy,
  MeasurementRevision,
  PersonalProfile,
  PlanningInputSnapshot,
  DailyPlanningResult,
} from "./types.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class MemoryPlanningRepository implements PlanningRepository {
  readonly #profiles = new Map<string, PersonalProfile>();
  readonly #strategies = new Map<string, GoalStrategy>();
  readonly #measurements = new Map<string, Array<BodyMeasurement>>();
  readonly #measurementRevisions = new Map<string, Array<MeasurementRevision>>();
  readonly #references = new Map<string, Array<DailyPlanningReference>>();

  public async getProfile(userId: string): Promise<PersonalProfile | null> {
    const value = this.#profiles.get(userId);
    return value === undefined ? null : clone(value);
  }

  public async saveProfile(userId: string, expectedRevision: number, input: Omit<PersonalProfile, "revision" | "updatedAt">): Promise<PersonalProfile | "revision_conflict"> {
    const existing = this.#profiles.get(userId);
    if ((existing?.revision ?? 0) !== expectedRevision) return "revision_conflict";
    const saved = { ...input, revision: expectedRevision + 1, updatedAt: new Date() };
    this.#profiles.set(userId, saved);
    return clone(saved);
  }

  public async getStrategy(userId: string): Promise<GoalStrategy | null> {
    const value = this.#strategies.get(userId);
    return value === undefined ? null : clone(value);
  }

  public async saveStrategy(userId: string, expectedRevision: number, input: Omit<GoalStrategy, "revision" | "updatedAt">): Promise<GoalStrategy | "revision_conflict"> {
    const existing = this.#strategies.get(userId);
    if ((existing?.revision ?? 0) !== expectedRevision) return "revision_conflict";
    const saved = { ...input, revision: expectedRevision + 1, updatedAt: new Date() };
    this.#strategies.set(userId, saved);
    return clone(saved);
  }

  public async listMeasurements(userId: string): Promise<readonly BodyMeasurement[]> {
    return clone([...(this.#measurements.get(userId) ?? [])].sort((a, b) => b.measuredAt.getTime() - a.measuredAt.getTime()));
  }

  public async getLatestMeasurement(userId: string, localDate: string): Promise<BodyMeasurement | null> {
    const values = (this.#measurements.get(userId) ?? [])
      .filter((value) => value.localDate <= localDate)
      .sort((a, b) => b.measuredAt.getTime() - a.measuredAt.getTime());
    return values[0] === undefined ? null : clone(values[0]);
  }

  public async createMeasurement(userId: string, input: Omit<BodyMeasurement, "id" | "revision" | "createdAt" | "updatedAt">): Promise<BodyMeasurement> {
    const now = new Date();
    const saved = { ...input, id: randomUUID(), revision: 1, createdAt: now, updatedAt: now };
    this.#measurements.set(userId, [...(this.#measurements.get(userId) ?? []), saved]);
    return clone(saved);
  }

  public async updateMeasurement(userId: string, measurementId: string, expectedRevision: number, input: Omit<BodyMeasurement, "id" | "revision" | "createdAt" | "updatedAt">): Promise<BodyMeasurement | "not_found" | "revision_conflict"> {
    const values = this.#measurements.get(userId) ?? [];
    const index = values.findIndex((value) => value.id === measurementId);
    if (index < 0) return "not_found";
    const existing = values[index]!;
    if (existing.revision !== expectedRevision) return "revision_conflict";
    const revisions = this.#measurementRevisions.get(measurementId) ?? [];
    revisions.push({
      id: randomUUID(),
      measurementId,
      measurementRevision: existing.revision,
      measuredAt: existing.measuredAt,
      localDate: existing.localDate,
      timeZone: existing.timeZone,
      weightKg: existing.weightKg,
      waistCm: existing.waistCm,
      note: existing.note,
      createdAt: new Date(),
    });
    this.#measurementRevisions.set(measurementId, revisions);
    const saved = { ...existing, ...input, revision: expectedRevision + 1, updatedAt: new Date() };
    values[index] = saved;
    return clone(saved);
  }

  public async listMeasurementRevisions(userId: string, measurementId: string): Promise<readonly MeasurementRevision[] | "not_found"> {
    if (!(this.#measurements.get(userId) ?? []).some((value) => value.id === measurementId)) return "not_found";
    return clone([...(this.#measurementRevisions.get(measurementId) ?? [])].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()));
  }

  public async getLatestReference(userId: string, localDate: string): Promise<DailyPlanningReference | null> {
    const values = this.#references.get(`${userId}:${localDate}`) ?? [];
    return values.length === 0 ? null : clone(values[values.length - 1]!);
  }

  public async createReference(userId: string, methodVersion: string, evidenceIds: readonly string[], inputSnapshot: PlanningInputSnapshot, result: DailyPlanningResult): Promise<DailyPlanningReference> {
    const key = `${userId}:${result.localDate}`;
    const values = this.#references.get(key) ?? [];
    const saved = { id: randomUUID(), revision: values.length + 1, methodVersion, evidenceIds: [...evidenceIds], inputSnapshot: clone(inputSnapshot), result: clone(result), createdAt: new Date() };
    values.push(saved);
    this.#references.set(key, values);
    return clone(saved);
  }
}
