import { apiRequest } from "./client";

export type PlanningSexCategory = "male" | "female";
export type PalCategory = "inactive" | "low_active" | "active" | "very_active";
export type WeightStrategy = "maintain" | "lose" | "gain";
export type MacroPreference = "balanced" | "high_protein" | "lower_fat";

export interface PersonalProfile {
  readonly birthDate: string | null;
  readonly sexCategory: PlanningSexCategory | null;
  readonly heightCm: number | null;
  readonly pregnantOrBreastfeeding: boolean;
  readonly medicalNutritionCondition: boolean;
  readonly specialBodyComposition: boolean;
  readonly palCategory: PalCategory | null;
  readonly revision: number;
  readonly updatedAt: string | null;
}

export interface GoalStrategy {
  readonly weightStrategy: WeightStrategy;
  readonly macroPreference: MacroPreference;
  readonly regularExercise: boolean;
  readonly trainingIntent: string | null;
  readonly targetWeightKg: number | null;
  readonly targetDate: string | null;
  readonly revision: number;
  readonly updatedAt: string | null;
}

export interface BodyMeasurement {
  readonly id: string;
  readonly measuredAt: string;
  readonly localDate: string;
  readonly timeZone: string;
  readonly weightKg: number;
  readonly waistCm: number | null;
  readonly note: string | null;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DailyPlanningReference {
  readonly id: string;
  readonly revision: number;
  readonly methodVersion: string;
  readonly evidenceIds: readonly string[];
  readonly result: {
    readonly status: "ready" | "needs_profile" | "needs_measurement" | "needs_pal" | "stopped" | "maintenance_only" | "constraint_conflict";
    readonly localDate: string;
    readonly ageYears: number | null;
    readonly bmi: number | null;
    readonly bmiCategory: "underweight" | "normal" | "overweight" | "obesity" | null;
    readonly measurementDate: string | null;
    readonly palCategory: PalCategory | null;
    readonly maintenanceKcal: number | null;
    readonly maintenanceRangeKcal: { readonly minimum: number; readonly maximum: number } | null;
    readonly targetEnergyKcal: number | null;
    readonly strategyAdjustmentKcal: number | null;
    readonly proteinGrams: number | null;
    readonly carbohydrateGrams: number | null;
    readonly fatGrams: number | null;
    readonly proteinBasis: "china_dri_rni" | "sports_g_per_kg" | "weight_loss_energy_share" | null;
    readonly messages: readonly string[];
    readonly limitations: readonly string[];
  };
  readonly createdAt: string;
}

export const planningApi = {
  getProfile: () => apiRequest<PersonalProfile>("/api/v1/planning/profile"),
  updateProfile: (revision: number, input: Omit<PersonalProfile, "revision" | "updatedAt">) =>
    apiRequest<PersonalProfile>("/api/v1/planning/profile", { method: "PUT", body: JSON.stringify({ revision, ...input }) }),
  getStrategy: () => apiRequest<GoalStrategy>("/api/v1/planning/strategy"),
  updateStrategy: (revision: number, input: Omit<GoalStrategy, "revision" | "updatedAt">) =>
    apiRequest<GoalStrategy>("/api/v1/planning/strategy", { method: "PUT", body: JSON.stringify({ revision, ...input }) }),
  listMeasurements: () => apiRequest<BodyMeasurement[]>("/api/v1/planning/measurements"),
  createMeasurement: (input: Pick<BodyMeasurement, "measuredAt" | "localDate" | "timeZone" | "weightKg" | "waistCm" | "note">) =>
    apiRequest<BodyMeasurement>("/api/v1/planning/measurements", { method: "POST", body: JSON.stringify(input) }),
  updateMeasurement: (measurementId: string, revision: number, input: Pick<BodyMeasurement, "measuredAt" | "localDate" | "timeZone" | "weightKg" | "waistCm" | "note">) =>
    apiRequest<BodyMeasurement>(`/api/v1/planning/measurements/${measurementId}`, { method: "PUT", body: JSON.stringify({ revision, ...input }) }),
  getDailyReference: (localDate: string, timeZone: string) =>
    apiRequest<DailyPlanningReference>(`/api/v1/planning/daily-reference?${new URLSearchParams({ localDate, timeZone }).toString()}`),
};
