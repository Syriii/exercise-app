import type {
  BodyMeasurement,
  DailyPlanningReference,
  GoalStrategy,
  MeasurementRevision,
  PersonalProfile,
  PlanningInputSnapshot,
  DailyPlanningResult,
} from "./types.js";

export interface PlanningRepository {
  getProfile(userId: string): Promise<PersonalProfile | null>;
  saveProfile(
    userId: string,
    expectedRevision: number,
    input: Omit<PersonalProfile, "revision" | "updatedAt">,
  ): Promise<PersonalProfile | "revision_conflict">;
  getStrategy(userId: string): Promise<GoalStrategy | null>;
  saveStrategy(
    userId: string,
    expectedRevision: number,
    input: Omit<GoalStrategy, "revision" | "updatedAt">,
  ): Promise<GoalStrategy | "revision_conflict">;
  listMeasurements(userId: string): Promise<readonly BodyMeasurement[]>;
  getLatestMeasurement(userId: string, localDate: string): Promise<BodyMeasurement | null>;
  createMeasurement(
    userId: string,
    input: Omit<BodyMeasurement, "id" | "revision" | "createdAt" | "updatedAt">,
  ): Promise<BodyMeasurement>;
  updateMeasurement(
    userId: string,
    measurementId: string,
    expectedRevision: number,
    input: Omit<BodyMeasurement, "id" | "revision" | "createdAt" | "updatedAt">,
  ): Promise<BodyMeasurement | "not_found" | "revision_conflict">;
  listMeasurementRevisions(userId: string, measurementId: string): Promise<readonly MeasurementRevision[] | "not_found">;
  getLatestReference(userId: string, localDate: string): Promise<DailyPlanningReference | null>;
  createReference(
    userId: string,
    methodVersion: string,
    evidenceIds: readonly string[],
    inputSnapshot: PlanningInputSnapshot,
    result: DailyPlanningResult,
  ): Promise<DailyPlanningReference>;
}
