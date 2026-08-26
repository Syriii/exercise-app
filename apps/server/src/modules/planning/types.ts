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
  readonly updatedAt: Date | null;
}

export interface BodyMeasurement {
  readonly id: string;
  readonly measuredAt: Date;
  readonly localDate: string;
  readonly timeZone: string;
  readonly weightKg: number;
  readonly waistCm: number | null;
  readonly note: string | null;
  readonly revision: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface GoalStrategy {
  readonly weightStrategy: WeightStrategy;
  readonly macroPreference: MacroPreference;
  readonly regularExercise: boolean;
  readonly trainingIntent: string | null;
  readonly targetWeightKg: number | null;
  readonly targetDate: string | null;
  readonly revision: number;
  readonly updatedAt: Date | null;
}

export type PlanningStatus =
  | "ready"
  | "needs_profile"
  | "needs_measurement"
  | "needs_pal"
  | "stopped"
  | "maintenance_only"
  | "constraint_conflict";

export interface PlanningInputSnapshot {
  readonly localDate: string;
  readonly timeZone: string;
  readonly profile: Omit<PersonalProfile, "updatedAt">;
  readonly measurement: {
    readonly id: string;
    readonly measuredAt: string;
    readonly localDate: string;
    readonly weightKg: number;
    readonly waistCm: number | null;
    readonly revision: number;
  } | null;
  readonly strategy: Omit<GoalStrategy, "updatedAt">;
}

export interface DailyPlanningResult {
  readonly status: PlanningStatus;
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
  readonly chineseDriCrossCheck: {
    readonly ageBand: "18-29" | "30-49" | "50-64";
    readonly energyMjPerDay: { readonly low: number; readonly medium: number; readonly high: number };
    readonly proteinRniGrams: number;
  } | null;
  readonly messages: readonly string[];
  readonly limitations: readonly string[];
}

export interface DailyPlanningReference {
  readonly id: string;
  readonly revision: number;
  readonly methodVersion: string;
  readonly evidenceIds: readonly string[];
  readonly inputSnapshot: PlanningInputSnapshot;
  readonly result: DailyPlanningResult;
  readonly createdAt: Date;
}

export interface MeasurementRevision {
  readonly id: string;
  readonly measurementId: string;
  readonly measurementRevision: number;
  readonly measuredAt: Date;
  readonly localDate: string;
  readonly timeZone: string;
  readonly weightKg: number;
  readonly waistCm: number | null;
  readonly note: string | null;
  readonly createdAt: Date;
}
