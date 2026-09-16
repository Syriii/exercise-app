import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import type { PlanningRepository } from "./repository.js";
import type {
  BodyMeasurement,
  DailyPlanningReference,
  GoalStrategy,
  MeasurementRevision,
  PersonalProfile,
  PlanningInputSnapshot,
  DailyPlanningResult,
  SetupProgress,
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
  readonly #setup = new Map<string, SetupProgress>();
  readonly #deleted = new Map<string, number>();

  public async getSetupProgress(userId: string): Promise<SetupProgress | null> { return clone(this.#setup.get(userId) ?? null); }
  public async saveSetupProgress(userId: string, progress: SetupProgress): Promise<SetupProgress> {
    const previous = this.#setup.get(userId);
    const merged = { profile: progress.profile || previous?.profile === true, measurement: progress.measurement || previous?.measurement === true, strategy: progress.strategy || previous?.strategy === true, completed: progress.completed || previous?.completed === true };
    merged.completed = merged.completed && merged.profile && merged.measurement && merged.strategy;
    this.#setup.set(userId, merged);
    if (!this.#profiles.has(userId)) this.#profiles.set(userId, { birthDate: null, sexCategory: null, heightCm: null, palCategory: null, pregnantOrBreastfeeding: false, medicalNutritionCondition: false, specialBodyComposition: false, revision: 1, updatedAt: new Date() });
    return clone(merged);
  }
  public async hasMeasurementHistory(userId: string): Promise<boolean> { return (this.#measurements.get(userId)?.length ?? 0) > 0; }
  public async deleteMeasurement(userId: string, measurementId: string, expectedRevision: number): Promise<"deleted" | "not_found" | "revision_conflict"> {
    const existing = this.#measurements.get(userId)?.find(value => value.id === measurementId);
    if (!existing) return "not_found";
    if (this.#deleted.has(measurementId)) return this.#deleted.get(measurementId) === expectedRevision + 1 ? "deleted" : "revision_conflict";
    if (existing.revision !== expectedRevision) return "revision_conflict";
    const saved = await this.updateMeasurement(userId, measurementId, expectedRevision, existing);
    if (typeof saved === "string") return saved;
    this.#deleted.set(measurementId, saved.revision);
    return "deleted";
  }

  public async getProfile(userId: string): Promise<PersonalProfile | null> {
    const value = this.#profiles.get(userId);
    return value === undefined ? null : clone(value);
  }

  public async saveProfile(userId: string, expectedRevision: number, input: Omit<PersonalProfile, "revision" | "updatedAt">): Promise<PersonalProfile | "revision_conflict"> {
    const existing = this.#profiles.get(userId);
    if (existing) { const { revision, updatedAt: _date, ...savedInput } = existing; if (revision === expectedRevision + 1 && isDeepStrictEqual(savedInput, input)) return clone(existing); }
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
    if (existing) { const { revision, updatedAt: _date, ...savedInput } = existing; if (revision === expectedRevision + 1 && isDeepStrictEqual(savedInput, input)) return clone(existing); }
    if ((existing?.revision ?? 0) !== expectedRevision) return "revision_conflict";
    const saved = { ...input, revision: expectedRevision + 1, updatedAt: new Date() };
    this.#strategies.set(userId, saved);
    return clone(saved);
  }

  public async listMeasurements(userId: string): Promise<readonly BodyMeasurement[]> {
    return clone([...(this.#measurements.get(userId) ?? [])].filter(value => !this.#deleted.has(value.id)).sort((a, b) => b.localDate.localeCompare(a.localDate) || b.measuredAt.getTime() - a.measuredAt.getTime() || b.id.localeCompare(a.id)));
  }

  public async getLatestMeasurement(userId: string, localDate: string): Promise<BodyMeasurement | null> {
    const values = (await this.listMeasurements(userId)).filter(value => value.localDate <= localDate);
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
    if (index < 0 && expectedRevision === 0) {
      if ([...this.#measurements.values()].some(rows => rows.some(row => row.id === measurementId))) return "not_found";
      const now = new Date();
      const created = { ...input, id: measurementId, revision: 1, createdAt: now, updatedAt: now };
      this.#measurements.set(userId, [...values, created]);
      return clone(created);
    }
    if (index < 0 || this.#deleted.has(measurementId)) return "not_found";
    const existing = values[index]!;
    const { id: _id, revision: _revision, createdAt: _created, updatedAt: _updated, ...savedInput } = existing;
    if (existing.revision === expectedRevision + 1 && isDeepStrictEqual(savedInput, input)) return clone(existing);
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
    const latest = values.at(-1);
    if (
      latest !== undefined &&
      latest.methodVersion === methodVersion &&
      isDeepStrictEqual(latest.evidenceIds, evidenceIds) &&
      isDeepStrictEqual(latest.inputSnapshot, inputSnapshot)
    ) {
      return clone(latest);
    }
    const saved = { id: randomUUID(), revision: values.length + 1, methodVersion, evidenceIds: [...evidenceIds], inputSnapshot: clone(inputSnapshot), result: clone(result), createdAt: new Date() };
    values.push(saved);
    this.#references.set(key, values);
    return clone(saved);
  }
}
