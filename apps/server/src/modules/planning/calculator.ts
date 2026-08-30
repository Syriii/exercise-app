import type {
  DailyPlanningResult,
  GoalStrategy,
  PalCategory,
  PersonalProfile,
  PlanningSexCategory,
} from "./types.js";

export const planningMethodVersion = "daily-reference-2026-08-26.1";
export const planningEvidenceIds = ["E-001", "E-002", "E-004", "E-006", "E-007", "E-010", "DERV-003", "DERV-005"] as const;

const EER_COEFFICIENTS: Record<PlanningSexCategory, Record<PalCategory, readonly [number, number, number, number]>> = {
  male: {
    inactive: [753.07, -10.83, 6.5, 14.1],
    low_active: [581.47, -10.83, 8.3, 14.94],
    active: [1004.82, -10.83, 6.52, 15.91],
    very_active: [-517.88, -10.83, 15.61, 19.11],
  },
  female: {
    inactive: [584.9, -7.01, 5.72, 11.71],
    low_active: [575.77, -7.01, 6.6, 12.14],
    active: [710.25, -7.01, 6.54, 12.34],
    very_active: [511.83, -7.01, 9.07, 12.56],
  },
};

const PAL_ORDER: readonly PalCategory[] = ["inactive", "low_active", "active", "very_active"];

const CHINA_DRI = {
  male: {
    "18-29": { energy: [9, 10.67, 12.55] as const, protein: 65 },
    "30-49": { energy: [8.58, 10.46, 12.34] as const, protein: 65 },
    "50-64": { energy: [8.16, 10.04, 11.72] as const, protein: 65 },
  },
  female: {
    "18-29": { energy: [7.11, 8.79, 10.25] as const, protein: 55 },
    "30-49": { energy: [7.11, 8.58, 10.04] as const, protein: 55 },
    "50-64": { energy: [6.69, 8.16, 9.62] as const, protein: 55 },
  },
} as const;

function roundEnergy(value: number): number {
  return Math.round(value);
}

function roundMacro(value: number): number {
  return Math.round(value);
}

function ageAtDate(birthDate: string, localDate: string): number {
  const birth = birthDate.split("-").map(Number);
  const current = localDate.split("-").map(Number);
  const [birthYear = 0, birthMonth = 0, birthDay = 0] = birth;
  const [year = 0, month = 0, day = 0] = current;
  return year - birthYear - (month < birthMonth || (month === birthMonth && day < birthDay) ? 1 : 0);
}

function ageBand(ageYears: number): "18-29" | "30-49" | "50-64" | null {
  if (ageYears >= 18 && ageYears <= 29) return "18-29";
  if (ageYears <= 49) return ageYears >= 30 ? "30-49" : null;
  if (ageYears <= 64) return "50-64";
  return null;
}

function eer(
  sexCategory: PlanningSexCategory,
  palCategory: PalCategory,
  ageYears: number,
  heightCm: number,
  weightKg: number,
): number {
  const [constant, ageCoefficient, heightCoefficient, weightCoefficient] = EER_COEFFICIENTS[sexCategory][palCategory];
  return constant + ageCoefficient * ageYears + heightCoefficient * heightCm + weightCoefficient * weightKg;
}

function bmiCategory(bmi: number): DailyPlanningResult["bmiCategory"] {
  if (bmi < 18.5) return "underweight";
  if (bmi < 24) return "normal";
  if (bmi < 28) return "overweight";
  return "obesity";
}

function baseResult(localDate: string): DailyPlanningResult {
  return {
    status: "needs_profile",
    localDate,
    ageYears: null,
    bmi: null,
    bmiCategory: null,
    measurementDate: null,
    palCategory: null,
    maintenanceKcal: null,
    maintenanceRangeKcal: null,
    targetEnergyKcal: null,
    strategyAdjustmentKcal: null,
    proteinGrams: null,
    carbohydrateGrams: null,
    fatGrams: null,
    proteinBasis: null,
    chineseDriCrossCheck: null,
    messages: [],
    limitations: [
      "这是群体方程形成的饮食规划参考，不是个人代谢测量。",
      "National Academies 方程来自美国和加拿大人群；中国 DRIs 分组值仅作交叉检查，不与方程平均。",
    ],
  };
}

export function calculateDailyReference(input: {
  readonly localDate: string;
  readonly profile: PersonalProfile;
  readonly strategy: GoalStrategy;
  readonly measurement: { readonly weightKg: number; readonly localDate: string } | null;
}): DailyPlanningResult {
  const result = baseResult(input.localDate);
  const profile = input.profile;
  const strategy = input.strategy;
  if (profile.birthDate === null || profile.sexCategory === null || profile.heightCm === null) {
    return { ...result, messages: ["请先补充出生日期、性别和身高。"] };
  }
  const ageYears = ageAtDate(profile.birthDate, input.localDate);
  const band = ageBand(ageYears);
  if (ageYears < 19 || ageYears > 64 || band === null) {
    return { ...result, status: "stopped", ageYears, messages: ["当前个体能量方程只覆盖 19–64 岁成人。"] };
  }
  if (profile.pregnantOrBreastfeeding || profile.medicalNutritionCondition) {
    return {
      ...result,
      status: "stopped",
      ageYears,
      messages: ["当前状态需要专门的营养评估，系统不自动生成个体营养数值。"],
    };
  }
  const dri = CHINA_DRI[profile.sexCategory][band];
  const crossCheck = {
    ageBand: band,
    energyMjPerDay: { low: dri.energy[0], medium: dri.energy[1], high: dri.energy[2] },
    proteinRniGrams: dri.protein,
  };
  if (input.measurement === null) {
    return {
      ...result,
      status: "needs_measurement",
      ageYears,
      chineseDriCrossCheck: crossCheck,
      messages: ["请先记录一次体重；没有体重时不生成个体数值。"],
    };
  }
  const bmiValue = input.measurement.weightKg / ((profile.heightCm / 100) ** 2);
  const roundedBmi = Math.round(bmiValue * 10) / 10;
  const category = bmiCategory(bmiValue);
  const common = {
    ageYears,
    bmi: roundedBmi,
    bmiCategory: category,
    measurementDate: input.measurement.localDate,
    palCategory: profile.palCategory,
    chineseDriCrossCheck: crossCheck,
  };
  if (profile.palCategory === null) {
    const values = PAL_ORDER.map((pal) => eer(profile.sexCategory!, pal, ageYears, profile.heightCm!, input.measurement!.weightKg));
    return {
      ...result,
      ...common,
      status: "needs_pal",
      maintenanceRangeKcal: { minimum: roundEnergy(Math.min(...values)), maximum: roundEnergy(Math.max(...values)) },
      messages: ["请根据平常工作、通勤和规律训练确认活动档位；单次训练或步数不能自动决定 PAL。"],
    };
  }
  const maintenanceRaw = eer(profile.sexCategory, profile.palCategory, ageYears, profile.heightCm, input.measurement.weightKg);
  const selectedIndex = PAL_ORDER.indexOf(profile.palCategory);
  const neighborValues = PAL_ORDER.filter((_, index) => Math.abs(index - selectedIndex) <= 1).map((pal) => eer(profile.sexCategory!, pal, ageYears, profile.heightCm!, input.measurement!.weightKg));
  const maintenanceKcal = roundEnergy(maintenanceRaw);
  const maintenanceRangeKcal = { minimum: roundEnergy(Math.min(...neighborValues)), maximum: roundEnergy(Math.max(...neighborValues)) };
  let status: DailyPlanningResult["status"] = "ready";
  let strategyAdjustmentKcal = 0;
  const messages: string[] = [];

  if (strategy.weightStrategy === "lose") {
    if (bmiValue < 24 || bmiValue >= 32.5) {
      return {
        ...result,
        ...common,
        status: "stopped",
        maintenanceKcal,
        maintenanceRangeKcal,
        strategyAdjustmentKcal: null,
        messages: ["国家卫健委的当前自动减脂路径适用于多数 BMI 24.0–32.5 的超重或轻度肥胖成人；当前输入需要另行评估。"],
      };
    }
    strategyAdjustmentKcal = -500;
    messages.push("减脂差额采用国家卫健委范围的保守端：每日减少 500 kcal。 ");
  } else if (strategy.weightStrategy === "gain") {
    status = "maintenance_only";
    messages.push("当前只显示维持参考；没有目标体重、期限和完整动态模型时，不生成固定增重盈余。 ");
    if (category === "underweight") {
      messages.push("BMI 低于 18.5 时应先完成适当健康评估，再制定个体增重目标。 ");
    }
  }

  const targetEnergyKcal = roundEnergy(maintenanceRaw + strategyAdjustmentKcal);
  let proteinGrams: number;
  let proteinBasis: DailyPlanningResult["proteinBasis"];
  if (strategy.weightStrategy === "lose") {
    const proteinShare = strategy.macroPreference === "balanced" ? 0.15 : 0.2;
    proteinGrams = roundMacro((targetEnergyKcal * proteinShare) / 4);
    proteinBasis = "weight_loss_energy_share";
  } else if (strategy.regularExercise && category !== "underweight" && category !== "obesity" && !profile.specialBodyComposition) {
    const gramsPerKg = strategy.macroPreference === "high_protein" ? 1.6 : 1.4;
    proteinGrams = roundMacro(input.measurement.weightKg * gramsPerKg);
    proteinBasis = "sports_g_per_kg";
  } else {
    proteinGrams = Math.max(dri.protein, roundMacro((targetEnergyKcal * 0.1) / 4));
    proteinBasis = "china_dri_rni";
    if (strategy.regularExercise && (category === "underweight" || category === "obesity" || profile.specialBodyComposition)) {
      messages.push("当前体重或体成分状态不自动套用健康运动成人的实际体重蛋白质公式，改用中国 DRIs 一般人群固定参考。 ");
    }
  }
  const fatShare = strategy.weightStrategy === "lose" && strategy.macroPreference === "lower_fat" ? 0.2 : 0.25;
  const fatGrams = roundMacro((targetEnergyKcal * fatShare) / 9);
  const carbohydrateGrams = roundMacro((targetEnergyKcal - proteinGrams * 4 - fatGrams * 9) / 4);
  const proteinShare = (proteinGrams * 4) / targetEnergyKcal;
  const actualFatShare = (fatGrams * 9) / targetEnergyKcal;
  const carbohydrateShare = (carbohydrateGrams * 4) / targetEnergyKcal;
  const ranges = strategy.weightStrategy === "lose"
    ? { protein: [0.15, 0.2], carbohydrate: [0.5, 0.6], fat: [0.2, 0.3] }
    : { protein: [0.1, 0.2], carbohydrate: [0.5, 0.65], fat: [0.2, 0.3] };
  const within = (value: number, range: number[]) => value >= range[0]! - 0.003 && value <= range[1]! + 0.003;
  if (!within(proteinShare, ranges.protein) || !within(carbohydrateShare, ranges.carbohydrate) || !within(actualFatShare, ranges.fat)) {
    status = "constraint_conflict";
    messages.push("当前蛋白质、脂肪和总能量无法同时落在适用供能范围内，请调整策略后重新计算。 ");
  }

  return {
    ...result,
    ...common,
    status,
    maintenanceKcal,
    maintenanceRangeKcal,
    targetEnergyKcal,
    strategyAdjustmentKcal,
    proteinGrams,
    carbohydrateGrams,
    fatGrams,
    proteinBasis,
    messages: messages.map((message) => message.trim()),
  };
}
