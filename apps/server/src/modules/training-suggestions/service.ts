import type { PlanningService } from "../planning/service.js";
import type { TrainingTemplateInput } from "../training/types.js";
import type { TrainingService } from "../training/service.js";
import { TrainingSuggestionError } from "./errors.js";
import type { TrainingSuggestionRepository } from "./repository.js";
import type {
  TrainingEquipment,
  TrainingSuggestion,
  TrainingSuggestionCandidate,
  TrainingSuggestionInputSnapshot,
  TrainingSuggestionPreferences,
  TrainingSuggestionView,
} from "./types.js";

export const trainingSuggestionMethodVersion = "training-suggestion-e013-e014-v1";
export const trainingSuggestionEvidenceIds = ["E-013", "E-014"] as const;

const movementOptions: Readonly<Record<TrainingEquipment, readonly string[]>> = {
  minimal: ["下肢推蹬（如徒手深蹲）", "水平推（如俯卧撑）", "髋主导（如臀桥）", "拉类动作（需合适且稳固的器械）", "单腿动作（如反向弓步）", "核心稳定（自行选择）"],
  dumbbells: ["高脚杯深蹲", "哑铃卧推", "单臂哑铃划船", "哑铃罗马尼亚硬拉", "哑铃肩推", "核心稳定（自行选择）"],
  full_gym: ["下肢推蹬（深蹲或腿举）", "水平推（卧推或器械推胸）", "水平拉（划船类）", "髋主导（罗马尼亚硬拉等）", "垂直推（肩推类）", "垂直拉（高位下拉或引体类）", "核心稳定（自行选择）"],
};

function ageOn(birthDate: string, date: string): number {
  const [birthYear, birthMonth, birthDay] = birthDate.split("-").map(Number) as [number, number, number];
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return year - birthYear - (month < birthMonth || (month === birthMonth && day < birthDay) ? 1 : 0);
}

function validatePreferences(value: TrainingSuggestionPreferences): void {
  if (!Number.isInteger(value.availableDaysPerWeek) || value.availableDaysPerWeek < 2 || value.availableDaysPerWeek > 6) {
    throw new TrainingSuggestionError("invalid_training_suggestion_input", "每周可训练天数需为 2–6 天", 400);
  }
  if (!Number.isInteger(value.sessionMinutes) || value.sessionMinutes < 20 || value.sessionMinutes > 120) {
    throw new TrainingSuggestionError("invalid_training_suggestion_input", "单次可用时间需为 20–120 分钟", 400);
  }
}

function targetFor(preferences: TrainingSuggestionPreferences) {
  if (preferences.goal === "strength") return { sets: 3, repsMin: null, repsMax: null, note: "力量目标可参考约 80% 1RM；没有可靠 1RM 时只记录可控相对负荷，不自动换算具体重量。" };
  if (preferences.goal === "power") return { sets: 3, repsMin: null, repsMax: null, note: "功率目标可参考约 30%–70% 1RM，并在技术稳定时强调向心阶段快速发力；不要求先测试最大重量。" };
  if (preferences.goal === "hypertrophy") return { sets: 3, repsMin: 8, repsMax: 12, note: "逐步让每个主要肌群接近每周约 10 组；先从可恢复的训练量开始，再按实际完成情况调整。" };
  return { sets: preferences.experience === "beginner" ? 2 : 3, repsMin: 8, repsMax: 12, note: "从能够稳定完成的相对负荷开始；不要求练到力竭。" };
}

function readyCandidate(preferences: TrainingSuggestionPreferences): TrainingSuggestionCandidate {
  const resistanceDays = Math.min(3, preferences.availableDaysPerWeek);
  const target = targetFor(preferences);
  const items: TrainingTemplateInput["items"] = movementOptions[preferences.equipment].map((exerciseName) => ({
    exerciseName,
    targetSets: target.sets,
    targetRepsMin: target.repsMin,
    targetRepsMax: target.repsMax,
    targetWeightKg: null,
    targetDurationSeconds: null,
    targetDistanceMeters: null,
    note: target.note,
  }));
  return {
    status: "ready",
    title: "全身训练草案",
    weeklyResistanceDays: resistanceDays,
    publicHealthBaseline: ["一般健康成人每周累计 150–300 分钟中等强度或 75–150 分钟高强度有氧活动。", "抗阻训练覆盖主要肌群，每周至少 2 天。"],
    template: { name: "全身训练草案", note: `每周可安排 ${resistanceDays} 次，每次约 ${preferences.sessionMinutes} 分钟。动作可以替换，重量按实际情况填写。`, items },
    messages: ["先看一遍动作和训练量，不合适就改。保存后才会成为你的方案。"],
    limitations: ["动作、器械和负荷要结合经验与现场条件调整。", "伤病康复、疾病管理、孕哺期和竞技专项需要个别评估。"],
  };
}

function stoppedCandidate(reason: string): TrainingSuggestionCandidate {
  return { status: "stopped", title: "这次不能自动生成", weeklyResistanceDays: null, publicHealthBaseline: [], template: null, messages: [reason, "你仍然可以自己建立方案并记录训练。"], limitations: ["当前自动建议只适用于 18–64 岁一般健康成人。"] };
}

export class TrainingSuggestionService {
  public constructor(private readonly options: { repository: TrainingSuggestionRepository; planningService: PlanningService; trainingService: TrainingService; now?: () => Date }) {}

  public async list(userId: string): Promise<readonly TrainingSuggestionView[]> {
    const [values, snapshot] = await Promise.all([this.options.repository.list(userId), this.currentSnapshot(userId, null)]);
    return values.map((value) => ({ ...value, stale: value.inputSnapshot.profileRevision !== snapshot.profileRevision || value.inputSnapshot.strategyRevision !== snapshot.strategyRevision || value.inputSnapshot.latestMeasurement?.id !== snapshot.latestMeasurement?.id || value.inputSnapshot.latestMeasurement?.revision !== snapshot.latestMeasurement?.revision }));
  }

  public async generate(userId: string, preferences: TrainingSuggestionPreferences): Promise<TrainingSuggestionView> {
    validatePreferences(preferences);
    const snapshot = await this.currentSnapshot(userId, preferences);
    const profile = await this.options.planningService.getProfile(userId);
    const today = snapshot.generatedOn;
    let candidate: TrainingSuggestionCandidate;
    if (profile.birthDate === null) candidate = stoppedCandidate("个人档案缺少出生日期，无法确认官方建议的适用年龄。");
    else if (ageOn(profile.birthDate, today) < 18 || ageOn(profile.birthDate, today) >= 65) candidate = stoppedCandidate("当前年龄超出这套健康成人自动建议的适用范围。");
    else if (profile.pregnantOrBreastfeeding || profile.medicalNutritionCondition || preferences.hasInjuryOrMedicalLimitation) candidate = stoppedCandidate("当前资料提示需要个别评估，系统不会套用一般健康成人参数。");
    else candidate = readyCandidate(preferences);
    const saved = await this.options.repository.create(userId, { methodVersion: trainingSuggestionMethodVersion, evidenceIds: trainingSuggestionEvidenceIds, inputSnapshot: snapshot, candidate });
    return { ...saved, stale: false };
  }

  public async adopt(userId: string, suggestionId: string, expectedRevision: number) {
    const suggestion = await this.requireActive(userId, suggestionId, expectedRevision);
    if (suggestion.candidate.template === null) throw new TrainingSuggestionError("invalid_training_suggestion_input", "这份建议没有可采用的方案", 409);
    const template = await this.options.trainingService.createTemplateFromSuggestion(userId, suggestionId, suggestion.candidate.template);
    const updated = await this.options.repository.markAdopted(userId, suggestionId, expectedRevision, template.id, this.now());
    if (updated === null || updated === "revision_conflict") throw new TrainingSuggestionError("training_suggestion_revision_conflict", "建议状态已经变化，请刷新后重试", 409);
    return { suggestion: { ...updated, stale: false }, template };
  }

  public async dismiss(userId: string, suggestionId: string, expectedRevision: number): Promise<TrainingSuggestionView> {
    await this.requireActive(userId, suggestionId, expectedRevision);
    const updated = await this.options.repository.dismiss(userId, suggestionId, expectedRevision, this.now());
    if (updated === null || updated === "revision_conflict") throw new TrainingSuggestionError("training_suggestion_revision_conflict", "建议状态已经变化，请刷新后重试", 409);
    return { ...updated, stale: false };
  }

  private async requireActive(userId: string, suggestionId: string, expectedRevision: number): Promise<TrainingSuggestion> {
    const value = await this.options.repository.find(userId, suggestionId);
    if (value === null) throw new TrainingSuggestionError("training_suggestion_not_found", "找不到这份训练建议", 404);
    if (value.revision !== expectedRevision || value.status !== "active") throw new TrainingSuggestionError("training_suggestion_revision_conflict", "建议状态已经变化，请刷新后重试", 409);
    return value;
  }

  private async currentSnapshot(userId: string, preferences: TrainingSuggestionPreferences | null): Promise<TrainingSuggestionInputSnapshot> {
    const [profile, strategy, measurements] = await Promise.all([this.options.planningService.getProfile(userId), this.options.planningService.getStrategy(userId), this.options.planningService.listMeasurements(userId)]);
    const latest = measurements[0] ?? null;
    return { generatedOn: this.now().toISOString().slice(0, 10), profileRevision: profile.revision, strategyRevision: strategy.revision, latestMeasurement: latest === null ? null : { id: latest.id, revision: latest.revision, localDate: latest.localDate }, preferences: preferences ?? { goal: "general", experience: "beginner", equipment: "minimal", availableDaysPerWeek: 2, sessionMinutes: 45, hasInjuryOrMedicalLimitation: false } };
  }

  private now(): Date { return this.options.now?.() ?? new Date(); }
}
