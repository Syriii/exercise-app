import { calculateDailyReference, planningEvidenceIds, planningMethodVersion } from "./calculator.js";
import { PlanningError } from "./errors.js";
import type { PlanningRepository } from "./repository.js";
import type {
  BodyMeasurement,
  GoalStrategy,
  MacroPreference,
  PalCategory,
  PersonalProfile,
  PlanningInputSnapshot,
  PlanningSexCategory,
  WeightStrategy,
} from "./types.js";

export const emptyProfile: PersonalProfile = {
  birthDate: null,
  sexCategory: null,
  heightCm: null,
  pregnantOrBreastfeeding: false,
  medicalNutritionCondition: false,
  specialBodyComposition: false,
  palCategory: null,
  revision: 0,
  updatedAt: null,
};

export const defaultStrategy: GoalStrategy = {
  weightStrategy: "maintain",
  macroPreference: "balanced",
  regularExercise: false,
  trainingIntent: null,
  targetWeightKg: null,
  targetDate: null,
  revision: 0,
  updatedAt: null,
};

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function cleanText(value: string | null, maximum: number): string | null {
  if (value === null) return null;
  const normalized = value.trim();
  if (normalized.length === 0) return null;
  if (normalized.length > maximum) throw new PlanningError("invalid_planning_input", `文字不能超过 ${maximum} 个字符`, 400);
  return normalized;
}

function assertNumber(value: number | null, name: string, minimum: number, maximum: number): void {
  if (value === null) return;
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new PlanningError("invalid_planning_input", `${name}应在 ${minimum}–${maximum} 之间`, 400);
  }
}

export class PlanningService {
  public constructor(private readonly repository: PlanningRepository) {}

  public async getProfile(userId: string): Promise<PersonalProfile> {
    return (await this.repository.getProfile(userId)) ?? emptyProfile;
  }

  public async updateProfile(userId: string, expectedRevision: number, input: {
    readonly birthDate: string | null;
    readonly sexCategory: PlanningSexCategory | null;
    readonly heightCm: number | null;
    readonly pregnantOrBreastfeeding: boolean;
    readonly medicalNutritionCondition: boolean;
    readonly specialBodyComposition: boolean;
    readonly palCategory: PalCategory | null;
  }): Promise<PersonalProfile> {
    if (input.birthDate !== null && !validDate(input.birthDate)) throw new PlanningError("invalid_planning_input", "出生日期格式不正确", 400);
    if (input.birthDate !== null && input.birthDate > new Date().toISOString().slice(0, 10)) throw new PlanningError("invalid_planning_input", "出生日期不能晚于今天", 400);
    assertNumber(input.heightCm, "身高", 80, 250);
    const saved = await this.repository.saveProfile(userId, expectedRevision, input);
    if (saved === "revision_conflict") throw new PlanningError("planning_revision_conflict", "资料已经在其他页面更新，请刷新后重试", 409);
    return saved;
  }

  public async getStrategy(userId: string): Promise<GoalStrategy> {
    return (await this.repository.getStrategy(userId)) ?? defaultStrategy;
  }

  public async updateStrategy(userId: string, expectedRevision: number, input: {
    readonly weightStrategy: WeightStrategy;
    readonly macroPreference: MacroPreference;
    readonly regularExercise: boolean;
    readonly trainingIntent: string | null;
    readonly targetWeightKg: number | null;
    readonly targetDate: string | null;
  }): Promise<GoalStrategy> {
    assertNumber(input.targetWeightKg, "目标体重", 20, 400);
    if (input.targetDate !== null && !validDate(input.targetDate)) throw new PlanningError("invalid_planning_input", "目标日期格式不正确", 400);
    if (input.macroPreference === "lower_fat" && input.weightStrategy !== "lose") {
      throw new PlanningError("invalid_planning_input", "较低脂肪分配只用于适用的减脂策略", 400);
    }
    const saved = await this.repository.saveStrategy(userId, expectedRevision, {
      ...input,
      trainingIntent: cleanText(input.trainingIntent, 500),
    });
    if (saved === "revision_conflict") throw new PlanningError("planning_revision_conflict", "策略已经在其他页面更新，请刷新后重试", 409);
    return saved;
  }

  public async listMeasurements(userId: string): Promise<readonly BodyMeasurement[]> {
    return this.repository.listMeasurements(userId);
  }

  public async getLatestMeasurement(userId: string, localDate: string): Promise<BodyMeasurement | null> {
    if (!validDate(localDate)) throw new PlanningError("invalid_planning_input", "日期格式不正确", 400);
    return this.repository.getLatestMeasurement(userId, localDate);
  }

  public async createMeasurement(userId: string, input: {
    readonly measuredAt: string;
    readonly localDate: string;
    readonly timeZone: string;
    readonly weightKg: number;
    readonly waistCm: number | null;
    readonly note: string | null;
  }): Promise<BodyMeasurement> {
    return this.repository.createMeasurement(userId, this.measurementInput(input));
  }

  public async updateMeasurement(userId: string, measurementId: string, expectedRevision: number, input: {
    readonly measuredAt: string;
    readonly localDate: string;
    readonly timeZone: string;
    readonly weightKg: number;
    readonly waistCm: number | null;
    readonly note: string | null;
  }): Promise<BodyMeasurement> {
    const saved = await this.repository.updateMeasurement(userId, measurementId, expectedRevision, this.measurementInput(input));
    if (saved === "not_found") throw new PlanningError("measurement_not_found", "找不到这条身体测量", 404);
    if (saved === "revision_conflict") throw new PlanningError("planning_revision_conflict", "测量记录已经更新，请刷新后重试", 409);
    return saved;
  }

  public async listMeasurementRevisions(userId: string, measurementId: string) {
    const values = await this.repository.listMeasurementRevisions(userId, measurementId);
    if (values === "not_found") throw new PlanningError("measurement_not_found", "找不到这条身体测量", 404);
    return values;
  }

  public async getDailyReference(userId: string, localDate: string, timeZone: string) {
    if (!validDate(localDate)) throw new PlanningError("invalid_planning_input", "日期格式不正确", 400);
    if (!validTimeZone(timeZone)) throw new PlanningError("invalid_planning_input", "时区无效", 400);
    const profile = await this.getProfile(userId);
    const strategy = await this.getStrategy(userId);
    const measurement = await this.repository.getLatestMeasurement(userId, localDate);
    const normalizedSnapshot: PlanningInputSnapshot = {
      localDate,
      timeZone,
      profile: {
        birthDate: profile.birthDate,
        sexCategory: profile.sexCategory,
        heightCm: profile.heightCm,
        pregnantOrBreastfeeding: profile.pregnantOrBreastfeeding,
        medicalNutritionCondition: profile.medicalNutritionCondition,
        specialBodyComposition: profile.specialBodyComposition,
        palCategory: profile.palCategory,
        revision: profile.revision,
      },
      measurement: measurement === null ? null : {
        id: measurement.id,
        measuredAt: measurement.measuredAt.toISOString(),
        localDate: measurement.localDate,
        weightKg: measurement.weightKg,
        waistCm: measurement.waistCm,
        revision: measurement.revision,
      },
      strategy: {
        weightStrategy: strategy.weightStrategy,
        macroPreference: strategy.macroPreference,
        regularExercise: strategy.regularExercise,
        trainingIntent: strategy.trainingIntent,
        targetWeightKg: strategy.targetWeightKg,
        targetDate: strategy.targetDate,
        revision: strategy.revision,
      },
    };
    const latest = await this.repository.getLatestReference(userId, localDate);
    if (latest !== null && latest.methodVersion === planningMethodVersion && JSON.stringify(latest.inputSnapshot) === JSON.stringify(normalizedSnapshot)) return latest;
    const result = calculateDailyReference({ localDate, profile, strategy, measurement });
    return this.repository.createReference(userId, planningMethodVersion, planningEvidenceIds, normalizedSnapshot, result);
  }

  private measurementInput(input: { readonly measuredAt: string; readonly localDate: string; readonly timeZone: string; readonly weightKg: number; readonly waistCm: number | null; readonly note: string | null }) {
    const measuredAt = new Date(input.measuredAt);
    if (Number.isNaN(measuredAt.getTime())) throw new PlanningError("invalid_planning_input", "测量时间格式不正确", 400);
    if (!validDate(input.localDate)) throw new PlanningError("invalid_planning_input", "测量日期格式不正确", 400);
    if (!validTimeZone(input.timeZone)) throw new PlanningError("invalid_planning_input", "测量时区无效", 400);
    assertNumber(input.weightKg, "体重", 20, 400);
    assertNumber(input.waistCm, "腰围", 30, 300);
    return { measuredAt, localDate: input.localDate, timeZone: input.timeZone, weightKg: input.weightKg, waistCm: input.waistCm, note: cleanText(input.note, 500) };
  }
}
