import { TrainingError } from "./errors.js";
import { getExerciseMediaFile, listExerciseCatalog, type ExerciseMediaKind } from "./exercise-catalog.js";
import { findExerciseGuidance } from "./guidance-catalog.js";
import type { PlanningService } from "../planning/service.js";
import type { TrainingRepository } from "./repository.js";
import type {
  ExtraTrainingItemInput,
  TrainingExpenditureActivity,
  TrainingExpenditureAssessment,
  TrainingExpenditureAssessmentInput,
  TrainingProgram,
  TrainingProgramInput,
  TrainingProgramUnitInput,
  TrainingSchedule,
  TrainingScheduleInput,
  TrainingSession,
  TrainingSessionItemUpdate,
  TrainingSessionStatus,
  TrainingTemplate,
  TrainingTemplateInput,
} from "./types.js";

const trainingExpenditureActivities: readonly TrainingExpenditureActivity[] = [
  { code: "barbell_bench_25rm", label: "杠铃卧推 · 25RM", description: "5 组 × 25 次，组间休息 1 分钟", met: 4.9, intensity: "moderate" },
  { code: "barbell_bench_12rm", label: "杠铃卧推 · 12RM", description: "3 组 × 12 次，组间休息 2 分钟", met: 5.2, intensity: "vigorous" },
  { code: "dumbbell_squat_25rm", label: "哑铃深蹲 · 25RM", description: "5 组 × 25 次，组间休息 1 分钟", met: 5.7, intensity: "moderate" },
  { code: "dumbbell_squat_12rm", label: "哑铃深蹲 · 12RM", description: "3 组 × 12 次，组间休息 2 分钟", met: 6.8, intensity: "vigorous" },
  { code: "combined_upper_25rm", label: "上肢、胸腹组合 · 25RM", description: "每个动作 5 组 × 25 次，组间休息 1 分钟", met: 5.7, intensity: "moderate" },
  { code: "combined_upper_12rm", label: "上肢、胸腹组合 · 12RM", description: "每个动作 3 组 × 12 次，组间休息 2 分钟", met: 6.6, intensity: "vigorous" },
] as const;

function ageOnDate(birthDate: string, localDate: string): number {
  const birthParts = birthDate.split("-").map(Number);
  const dateParts = localDate.split("-").map(Number);
  const birthYear = birthParts[0] ?? 0;
  const birthMonth = birthParts[1] ?? 0;
  const birthDay = birthParts[2] ?? 0;
  const year = dateParts[0] ?? 0;
  const month = dateParts[1] ?? 0;
  const day = dateParts[2] ?? 0;
  let age = year - birthYear;
  if (month < birthMonth || (month === birthMonth && day < birthDay)) age -= 1;
  return age;
}

function roundedEnergy(value: number): number {
  return Math.round(value * 10) / 10;
}

const decimalPattern = /^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/;

function cleanText(value: string | null, maximum: number): string | null {
  if (value === null) return null;
  const cleaned = value.trim();
  if (cleaned.length === 0) return null;
  if (cleaned.length > maximum) {
    throw new TrainingError("invalid_training_input", `文字不能超过 ${maximum} 个字符`, 400);
  }
  return cleaned;
}

function positiveInteger(value: number | null, field: string): number | null {
  if (value !== null && (!Number.isInteger(value) || value <= 0)) {
    throw new TrainingError("invalid_training_input", `${field}必须是正整数`, 400);
  }
  return value;
}

function nonNegativeInteger(value: number | null, field: string): number | null {
  if (value !== null && (!Number.isInteger(value) || value < 0)) {
    throw new TrainingError("invalid_training_input", `${field}不能为负数`, 400);
  }
  return value;
}

function decimal(value: string | null, field: string, allowZero: boolean): string | null {
  if (value === null) return null;
  const cleaned = value.trim();
  if (!decimalPattern.test(cleaned) || (!allowZero && Number(cleaned) <= 0)) {
    throw new TrainingError("invalid_training_input", `${field}格式不正确`, 400);
  }
  return cleaned;
}

function normalizeTemplate(input: TrainingTemplateInput): TrainingTemplateInput {
  const name = cleanText(input.name, 80);
  if (name === null) {
    throw new TrainingError("invalid_training_input", "训练方案需要名称", 400);
  }
  if (input.items.length === 0 || input.items.length > 50) {
    throw new TrainingError("invalid_training_input", "训练方案需包含 1–50 个动作", 400);
  }
  return {
    name,
    note: cleanText(input.note, 1000),
    items: input.items.map((item) => {
      const exerciseName = cleanText(item.exerciseName, 100);
      if (exerciseName === null) {
        throw new TrainingError("invalid_training_input", "动作名称不能为空", 400);
      }
      const targetRepsMin = positiveInteger(item.targetRepsMin, "最低次数");
      const targetRepsMax = positiveInteger(item.targetRepsMax, "最高次数");
      if (targetRepsMin !== null && targetRepsMax !== null && targetRepsMax < targetRepsMin) {
        throw new TrainingError("invalid_training_input", "最高次数不能小于最低次数", 400);
      }
      return {
        exerciseName,
        targetSets: positiveInteger(item.targetSets, "目标组数"),
        targetRepsMin,
        targetRepsMax,
        targetWeightKg: decimal(item.targetWeightKg, "目标重量", false),
        targetDurationSeconds: positiveInteger(item.targetDurationSeconds, "目标时长"),
        targetDistanceMeters: decimal(item.targetDistanceMeters, "目标距离", false),
        note: cleanText(item.note, 500),
      };
    }),
  };
}

function normalizeProgram(input: TrainingProgramInput): TrainingProgramInput {
  const name = cleanText(input.name, 80);
  if (name === null) {
    throw new TrainingError("invalid_training_input", "周期计划需要名称", 400);
  }
  if (!Number.isInteger(input.weekCount) || input.weekCount < 1 || input.weekCount > 52) {
    throw new TrainingError("invalid_training_input", "周期周数需为 1–52", 400);
  }
  return { name, note: cleanText(input.note, 1000), weekCount: input.weekCount };
}

function normalizeProgramUnit(input: TrainingProgramUnitInput): TrainingProgramUnitInput {
  const normalized = normalizeTemplate({ name: input.name, note: input.note, items: input.items });
  if (!Number.isInteger(input.weekNumber) || input.weekNumber < 1) {
    throw new TrainingError("invalid_training_input", "周次必须是正整数", 400);
  }
  return {
    weekNumber: input.weekNumber,
    name: normalized.name,
    note: normalized.note,
    items: normalized.items,
  };
}

function normalizeActual(input: TrainingSessionItemUpdate): TrainingSessionItemUpdate {
  if (input.sets.length > 100) {
    throw new TrainingError("invalid_training_input", "单个动作不能超过 100 组", 400);
  }
  const performedExerciseName = cleanText(input.performedExerciseName, 100);
  if (input.status === "completed" && performedExerciseName === null) {
    throw new TrainingError("invalid_training_input", "完成动作时需要填写实际动作名称", 400);
  }
  if (input.status !== "completed") {
    return {
      status: input.status,
      performedExerciseName: null,
      actualNote: input.status === "skipped" ? cleanText(input.actualNote, 1000) : null,
      sets: [],
    };
  }
  return {
    status: input.status,
    performedExerciseName,
    actualNote: cleanText(input.actualNote, 1000),
    sets: input.sets.map((set) => ({
      reps: nonNegativeInteger(set.reps, "次数"),
      weightKg: decimal(set.weightKg, "重量", true),
      durationSeconds: nonNegativeInteger(set.durationSeconds, "时长"),
      distanceMeters: decimal(set.distanceMeters, "距离", true),
      note: cleanText(set.note, 500),
    })),
  };
}

function localDateAt(now: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    if (values.year === undefined || values.month === undefined || values.day === undefined) {
      throw new Error("missing date part");
    }
    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    throw new TrainingError("invalid_time_zone", "无法识别当前时区", 400);
  }
}

function validLocalDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TrainingError("invalid_training_input", "训练日期格式不正确", 400);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new TrainingError("invalid_training_input", "训练日期不存在", 400);
  }
  return value;
}

function requireResult<T>(result: T | "revision_conflict" | null, notFoundCode: "training_template_not_found" | "training_session_not_found"): T {
  if (result === "revision_conflict") {
    throw new TrainingError("training_revision_conflict", "内容已在其他页面更新，请刷新后重试", 409);
  }
  if (result === null) {
    throw new TrainingError(notFoundCode, "没有找到这条训练内容", 404);
  }
  return result;
}

function requireProgramResult(
  result: TrainingProgram | "revision_conflict" | "unit_started" | null,
  notFoundCode: "training_program_not_found" | "training_program_unit_not_found",
): TrainingProgram {
  if (result === "revision_conflict") {
    throw new TrainingError("training_revision_conflict", "内容已在其他页面更新，请刷新后重试", 409);
  }
  if (result === "unit_started") {
    throw new TrainingError(
      "training_program_unit_started",
      "这个训练日已经开始，不能再覆盖它的计划内容",
      409,
    );
  }
  if (result === null) {
    throw new TrainingError(notFoundCode, "没有找到这条周期训练内容", 404);
  }
  return result;
}

function requireScheduleResult(
  result: TrainingSchedule | "revision_conflict" | "schedule_unavailable" | null,
): TrainingSchedule {
  if (result === "revision_conflict") {
    throw new TrainingError("training_revision_conflict", "日程已在其他页面更新，请刷新后重试", 409);
  }
  if (result === "schedule_unavailable") {
    throw new TrainingError("training_schedule_unavailable", "这条训练日程已经取消或开始", 409);
  }
  if (result === null) {
    throw new TrainingError("training_schedule_not_found", "没有找到这条训练日程", 404);
  }
  return result;
}

export class TrainingService {
  readonly #repository: TrainingRepository;
  readonly #now: () => Date;
  readonly #planningService: PlanningService | null;
  readonly #exerciseMediaRoot: string | null;

  public constructor(options: { repository: TrainingRepository; planningService?: PlanningService; exerciseMediaRoot?: string | null; now?: () => Date }) {
    this.#repository = options.repository;
    this.#planningService = options.planningService ?? null;
    this.#exerciseMediaRoot = options.exerciseMediaRoot ?? null;
    this.#now = options.now ?? (() => new Date());
  }

  public listExpenditureActivities(): readonly TrainingExpenditureActivity[] {
    return trainingExpenditureActivities;
  }

  public getExerciseGuidance(exerciseName: string) {
    const cleaned = cleanText(exerciseName, 100);
    if (cleaned === null) {
      throw new TrainingError("invalid_training_input", "动作名称不能为空", 400);
    }
    return findExerciseGuidance(cleaned, this.#exerciseMediaRoot);
  }

  public listExerciseCatalog(options: { readonly query?: string; readonly bodyPart?: string; readonly equipment?: string; readonly limit?: number }) {
    return listExerciseCatalog(options, this.#exerciseMediaRoot);
  }

  public getExerciseMedia(exerciseId: string, kind: ExerciseMediaKind) {
    return getExerciseMediaFile(exerciseId, kind, this.#exerciseMediaRoot);
  }

  public listTemplates(userId: string, includeArchived = false): Promise<readonly TrainingTemplate[]> {
    return this.#repository.listTemplates(userId, includeArchived);
  }

  public createTemplate(userId: string, input: TrainingTemplateInput): Promise<TrainingTemplate> {
    return this.#repository.createTemplate(userId, normalizeTemplate(input));
  }

  public createTemplateFromSuggestion(userId: string, suggestionId: string, input: TrainingTemplateInput): Promise<TrainingTemplate> {
    return this.#repository.createTemplateFromSuggestion(userId, suggestionId, normalizeTemplate(input));
  }

  public async updateTemplate(userId: string, templateId: string, expectedRevision: number, input: TrainingTemplateInput): Promise<TrainingTemplate> {
    return requireResult(
      await this.#repository.updateTemplate(userId, templateId, expectedRevision, normalizeTemplate(input)),
      "training_template_not_found",
    );
  }

  public async archiveTemplate(userId: string, templateId: string, expectedRevision: number): Promise<TrainingTemplate> {
    return requireResult(
      await this.#repository.setTemplateArchived(userId, templateId, expectedRevision, this.#now()),
      "training_template_not_found",
    );
  }

  public listPrograms(userId: string, includeArchived = false): Promise<readonly TrainingProgram[]> {
    return this.#repository.listPrograms(userId, includeArchived);
  }

  public async getProgram(userId: string, programId: string): Promise<TrainingProgram> {
    const program = await this.#repository.findProgram(userId, programId);
    if (program === null) {
      throw new TrainingError("training_program_not_found", "没有找到这个周期计划", 404);
    }
    return program;
  }

  public createProgram(userId: string, input: TrainingProgramInput): Promise<TrainingProgram> {
    return this.#repository.createProgram(userId, normalizeProgram(input));
  }

  public async updateProgram(
    userId: string,
    programId: string,
    expectedRevision: number,
    input: TrainingProgramInput,
  ): Promise<TrainingProgram> {
    const normalized = normalizeProgram(input);
    const existing = await this.getProgram(userId, programId);
    if (existing.units.some((unit) => unit.weekNumber > normalized.weekCount)) {
      throw new TrainingError(
        "invalid_training_input",
        "缩短周期前，请先移动超出新周数的训练日",
        409,
      );
    }
    return requireProgramResult(
      await this.#repository.updateProgram(userId, programId, expectedRevision, normalized),
      "training_program_not_found",
    );
  }

  public async archiveProgram(
    userId: string,
    programId: string,
    expectedRevision: number,
  ): Promise<TrainingProgram> {
    return requireProgramResult(
      await this.#repository.setProgramArchived(userId, programId, expectedRevision, this.#now()),
      "training_program_not_found",
    );
  }

  public async addProgramUnit(
    userId: string,
    programId: string,
    expectedRevision: number,
    input: TrainingProgramUnitInput,
    sourceTemplateId: string | null,
  ): Promise<TrainingProgram> {
    const program = await this.#requireEditableProgram(userId, programId, input.weekNumber);
    if (program.revision !== expectedRevision) {
      throw new TrainingError("training_revision_conflict", "内容已在其他页面更新，请刷新后重试", 409);
    }
    let normalized: TrainingProgramUnitInput;
    let template: TrainingTemplate | null = null;
    if (sourceTemplateId !== null) {
      template = await this.#repository.findTemplate(userId, sourceTemplateId);
      if (template === null || template.archivedAt !== null) {
        throw new TrainingError("training_template_not_found", "没有找到可导入的训练方案", 404);
      }
      normalized = {
        weekNumber: input.weekNumber,
        name: template.name,
        note: template.note,
        items: template.items,
      };
    } else {
      normalized = normalizeProgramUnit(input);
    }
    return requireProgramResult(
      await this.#repository.addProgramUnit(userId, programId, expectedRevision, {
        ...normalized,
        sourceTemplateId: template?.id ?? null,
        sourceTemplateName: template?.name ?? null,
        sourceTemplateRevision: template?.revision ?? null,
        importedAt: template === null ? null : this.#now(),
      }),
      "training_program_not_found",
    );
  }

  public async updateProgramUnit(
    userId: string,
    programId: string,
    unitId: string,
    expectedRevision: number,
    input: TrainingProgramUnitInput,
  ): Promise<TrainingProgram> {
    await this.#requireEditableProgram(userId, programId, input.weekNumber);
    return requireProgramResult(
      await this.#repository.updateProgramUnit(
        userId,
        programId,
        unitId,
        expectedRevision,
        normalizeProgramUnit(input),
      ),
      "training_program_unit_not_found",
    );
  }

  public async reimportProgramUnit(
    userId: string,
    programId: string,
    unitId: string,
    expectedRevision: number,
  ): Promise<TrainingProgram> {
    const program = await this.getProgram(userId, programId);
    const unit = program.units.find((candidate) => candidate.id === unitId);
    if (unit === undefined) {
      throw new TrainingError("training_program_unit_not_found", "没有找到这个周期训练日", 404);
    }
    if (unit.started) {
      throw new TrainingError("training_program_unit_started", "这个训练日已经开始，不能重新导入", 409);
    }
    if (unit.sourceTemplateId === null) {
      throw new TrainingError("invalid_training_input", "这个训练日不是从单次方案导入的", 409);
    }
    const template = await this.#repository.findTemplate(userId, unit.sourceTemplateId);
    if (template === null || template.archivedAt !== null) {
      throw new TrainingError("training_template_not_found", "来源训练方案已经不可用", 404);
    }
    return requireProgramResult(
      await this.#repository.reimportProgramUnit(
        userId,
        programId,
        unitId,
        expectedRevision,
        template,
        this.#now(),
      ),
      "training_program_unit_not_found",
    );
  }

  public listSchedules(userId: string, dateFrom?: string, dateTo?: string): Promise<readonly TrainingSchedule[]> {
    const normalizedFrom = dateFrom === undefined ? undefined : validLocalDate(dateFrom);
    const normalizedTo = dateTo === undefined ? undefined : validLocalDate(dateTo);
    if (normalizedFrom !== undefined && normalizedTo !== undefined && normalizedFrom > normalizedTo) {
      throw new TrainingError("invalid_training_input", "开始日期不能晚于结束日期", 400);
    }
    return this.#repository.listSchedules(userId, normalizedFrom, normalizedTo);
  }

  public async createSchedule(userId: string, input: TrainingScheduleInput): Promise<TrainingSchedule> {
    return this.#repository.createSchedule(userId, await this.#normalizeSchedule(userId, input));
  }

  public async updateSchedule(
    userId: string,
    scheduleId: string,
    expectedRevision: number,
    input: TrainingScheduleInput,
  ): Promise<TrainingSchedule> {
    return requireScheduleResult(
      await this.#repository.updateSchedule(
        userId,
        scheduleId,
        expectedRevision,
        await this.#normalizeSchedule(userId, input),
      ),
    );
  }

  public async cancelSchedule(
    userId: string,
    scheduleId: string,
    expectedRevision: number,
  ): Promise<TrainingSchedule> {
    return requireScheduleResult(
      await this.#repository.cancelSchedule(userId, scheduleId, expectedRevision, this.#now()),
    );
  }

  public listSessions(
    userId: string,
    filter?: { readonly status?: TrainingSessionStatus; readonly dateFrom?: string; readonly dateTo?: string },
  ): Promise<readonly TrainingSession[]> {
    const dateFrom = filter?.dateFrom === undefined ? undefined : validLocalDate(filter.dateFrom);
    const dateTo = filter?.dateTo === undefined ? undefined : validLocalDate(filter.dateTo);
    if (dateFrom !== undefined && dateTo !== undefined && dateFrom > dateTo) {
      throw new TrainingError("invalid_training_input", "开始日期不能晚于结束日期", 400);
    }
    return this.#repository.listSessions(userId, {
      ...(filter?.status === undefined ? {} : { status: filter.status }),
      ...(dateFrom === undefined ? {} : { dateFrom }),
      ...(dateTo === undefined ? {} : { dateTo }),
    });
  }

  public async getSession(userId: string, sessionId: string): Promise<TrainingSession> {
    const session = await this.#repository.findSession(userId, sessionId);
    if (session === null) {
      throw new TrainingError("training_session_not_found", "没有找到这次训练", 404);
    }
    return session;
  }

  public async listSessionItemRevisions(userId: string, sessionId: string) {
    await this.getSession(userId, sessionId);
    return this.#repository.listSessionItemRevisions(userId, sessionId);
  }

  public async listSessionRevisions(userId: string, sessionId: string) {
    await this.getSession(userId, sessionId);
    return this.#repository.listSessionRevisions(userId, sessionId);
  }

  public async updateSessionMetadata(
    userId: string,
    sessionId: string,
    expectedRevision: number,
    input: { readonly localDate: string; readonly note: string | null },
  ): Promise<TrainingSession> {
    await this.getSession(userId, sessionId);
    return requireResult(
      await this.#repository.updateSessionMetadata(userId, sessionId, expectedRevision, {
        localDate: validLocalDate(input.localDate),
        note: cleanText(input.note, 1000),
      }),
      "training_session_not_found",
    );
  }

  public async assessSessionExpenditure(
    userId: string,
    sessionId: string,
    expectedRevision: number,
    input: TrainingExpenditureAssessmentInput,
  ): Promise<TrainingSession> {
    const session = await this.getSession(userId, sessionId);
    if (session.status === "in_progress") {
      throw new TrainingError("training_session_in_progress", "训练结束后才能估算消耗", 409);
    }
    const activity = input.activityCode === null
      ? null
      : trainingExpenditureActivities.find((candidate) => candidate.code === input.activityCode) ?? null;
    if (input.activityCode !== null && activity === null) {
      throw new TrainingError("invalid_training_input", "没有找到对应的官方活动模式", 400);
    }
    if (activity !== null && (!Number.isInteger(input.durationMinutes) || input.durationMinutes === null || input.durationMinutes < 1 || input.durationMinutes > 720)) {
      throw new TrainingError("invalid_training_input", "有效训练时长需为 1–720 分钟", 400);
    }
    if (activity === null && input.durationMinutes !== null) {
      throw new TrainingError("invalid_training_input", "未匹配活动模式时不应填写训练时长", 400);
    }

    const profile = this.#planningService === null ? null : await this.#planningService.getProfile(userId);
    const measurement = this.#planningService === null ? null : await this.#planningService.getLatestMeasurement(userId, session.localDate);
    const messages: string[] = [];
    if (activity === null) messages.push("本次训练与当前官方活动模式不完全相符，未给出能量数值。");
    if (this.#planningService === null) messages.push("规划资料服务不可用，无法取得受控的个人档案与体重。");
    if (profile?.birthDate === null || profile === null) messages.push("需要出生日期才能判断公式适用年龄。");
    const age = profile?.birthDate === null || profile === null ? null : ageOnDate(profile.birthDate, session.localDate);
    if (age !== null && (age < 18 || age > 64)) messages.push("当前官方参考适用于 18–64 岁健康成年人。");
    if (profile?.pregnantOrBreastfeeding) messages.push("孕期或哺乳期不使用这项一般成年人估算。");
    if (profile?.medicalNutritionCondition) messages.push("存在需专业人员处理的健康情况，不提供该项估算。");
    if (profile?.specialBodyComposition) messages.push("特殊身体组成可能使体重乘算产生较大偏差。");
    if (measurement === null) messages.push("训练日期当日或之前没有可用体重记录。");

    const canEstimate = activity !== null && input.durationMinutes !== null && profile !== null && age !== null && age >= 18 && age <= 64
      && !profile.pregnantOrBreastfeeding && !profile.medicalNutritionCondition && !profile.specialBodyComposition && measurement !== null;
    const durationHours = input.durationMinutes === null ? 0 : input.durationMinutes / 60;
    const assessment: TrainingExpenditureAssessment = {
      status: canEstimate ? "estimated" : "unavailable",
      inputSnapshot: {
        sessionId: session.id,
        sessionRevision: session.revision,
        localDate: session.localDate,
        activityCode: activity?.code ?? null,
        durationMinutes: activity === null ? null : input.durationMinutes,
        profileRevision: profile?.revision ?? 0,
        weightMeasurement: measurement === null ? null : {
          id: measurement.id,
          revision: measurement.revision,
          localDate: measurement.localDate,
          weightKg: measurement.weightKg,
        },
      },
      activityLabel: activity?.label ?? null,
      activityDescription: activity?.description ?? null,
      met: activity?.met ?? null,
      grossEnergyKcal: canEstimate ? roundedEnergy(activity.met * measurement.weightKg * durationHours) : null,
      netEnergyKcal: canEstimate ? roundedEnergy((activity.met - 1) * measurement.weightKg * durationHours) : null,
      methodVersion: "training-expenditure-e003-v1",
      evidenceIds: ["E-003"],
      formula: "总消耗 = MET × 体重(kg) × 时长(h)；净消耗 = (MET − 1) × 体重(kg) × 时长(h)",
      messages,
      limitations: [
        "仅在本次动作、RM、组数、次数和休息时间与所选模式相符时使用。",
        "结果是群体参考值推算，不代表穿戴设备或实验室实测。",
        "结果只用于训练回顾，不改变每日饮食建议。",
      ],
      assessedAt: this.#now().toISOString(),
    };
    return requireResult(
      await this.#repository.updateSessionExpenditure(userId, sessionId, expectedRevision, assessment),
      "training_session_not_found",
    );
  }

  public async startSession(userId: string, templateId: string | null, timeZone: string): Promise<TrainingSession> {
    const template = templateId === null ? null : await this.#repository.findTemplate(userId, templateId);
    if (templateId !== null && (template === null || template.archivedAt !== null)) {
      throw new TrainingError("training_template_not_found", "没有找到可用的训练方案", 404);
    }
    const startedAt = this.#now();
    const result = await this.#repository.startSession({
      userId,
      template,
      program: null,
      programUnit: null,
      schedule: null,
      timeZone,
      localDate: localDateAt(startedAt, timeZone),
      startedAt,
    });
    if (result === "schedule_unavailable") throw new Error("direct session unexpectedly had a schedule");
    return result;
  }

  public async startProgramSession(
    userId: string,
    programId: string,
    unitId: string,
    timeZone: string,
  ): Promise<TrainingSession> {
    const program = await this.getProgram(userId, programId);
    if (program.archivedAt !== null) {
      throw new TrainingError("training_program_not_found", "没有找到可用的周期计划", 404);
    }
    const unit = program.units.find((candidate) => candidate.id === unitId);
    if (unit === undefined) {
      throw new TrainingError("training_program_unit_not_found", "没有找到这个周期训练日", 404);
    }
    const startedAt = this.#now();
    const result = await this.#repository.startSession({
      userId,
      template: null,
      program,
      programUnit: unit,
      schedule: null,
      timeZone,
      localDate: localDateAt(startedAt, timeZone),
      startedAt,
    });
    if (result === "schedule_unavailable") throw new Error("direct program session unexpectedly had a schedule");
    return result;
  }

  public async startScheduledSession(
    userId: string,
    scheduleId: string,
  ): Promise<TrainingSession> {
    const schedule = await this.#repository.findSchedule(userId, scheduleId);
    if (schedule === null) {
      throw new TrainingError("training_schedule_not_found", "没有找到这条训练日程", 404);
    }
    if (schedule.status !== "scheduled") {
      throw new TrainingError("training_schedule_unavailable", "这条训练日程已经取消或开始", 409);
    }
    const template = schedule.sourceTemplateId === null
      ? null
      : await this.#repository.findTemplate(userId, schedule.sourceTemplateId);
    let program: TrainingProgram | null = null;
    let programUnit = null;
    if (schedule.sourceProgramId !== null && schedule.sourceProgramUnitId !== null) {
      program = await this.#repository.findProgram(userId, schedule.sourceProgramId);
      programUnit = program?.units.find((unit) => unit.id === schedule.sourceProgramUnitId) ?? null;
    }
    if (schedule.sourceTemplateId !== null && template === null) {
      throw new TrainingError("training_template_not_found", "日程引用的单次方案已经不可用", 409);
    }
    if (schedule.sourceProgramUnitId !== null && (program === null || programUnit === null)) {
      throw new TrainingError("training_program_unit_not_found", "日程引用的周期训练日已经不可用", 409);
    }
    const startedAt = this.#now();
    const result = await this.#repository.startSession({
      userId,
      template,
      program,
      programUnit,
      schedule,
      timeZone: schedule.timeZone,
      localDate: schedule.localDate,
      startedAt,
    });
    if (result === "schedule_unavailable") {
      throw new TrainingError("training_schedule_unavailable", "这条训练日程已经取消或开始", 409);
    }
    return result;
  }

  public async updateSessionItem(userId: string, sessionId: string, itemId: string, expectedRevision: number, input: TrainingSessionItemUpdate): Promise<TrainingSession> {
    await this.getSession(userId, sessionId);
    const result = await this.#repository.updateSessionItem(userId, sessionId, itemId, expectedRevision, normalizeActual(input));
    if (result === null) {
      throw new TrainingError("training_session_item_not_found", "没有找到这个训练动作", 404);
    }
    return requireResult(result, "training_session_not_found");
  }

  public async addExtraSessionItem(userId: string, sessionId: string, expectedRevision: number, input: ExtraTrainingItemInput): Promise<TrainingSession> {
    await this.getSession(userId, sessionId);
    const exerciseName = cleanText(input.exerciseName, 100);
    if (exerciseName === null) {
      throw new TrainingError("invalid_training_input", "动作名称不能为空", 400);
    }
    const normalizedActual = normalizeActual({
      status: "completed",
      performedExerciseName: exerciseName,
      actualNote: input.actualNote,
      sets: input.sets,
    });
    return requireResult(
      await this.#repository.addExtraSessionItem(userId, sessionId, expectedRevision, {
        exerciseName,
        actualNote: normalizedActual.actualNote,
        sets: normalizedActual.sets,
      }),
      "training_session_not_found",
    );
  }

  public async finishSession(userId: string, sessionId: string, expectedRevision: number, status: "completed" | "abandoned"): Promise<TrainingSession> {
    await this.#requireOpenSession(userId, sessionId);
    return requireResult(
      await this.#repository.finishSession(userId, sessionId, expectedRevision, status, this.#now()),
      "training_session_not_found",
    );
  }

  async #requireOpenSession(userId: string, sessionId: string): Promise<void> {
    const session = await this.#repository.findSession(userId, sessionId);
    if (session === null) {
      throw new TrainingError("training_session_not_found", "没有找到这次训练", 404);
    }
    if (session.status !== "in_progress") {
      throw new TrainingError("training_session_closed", "这次训练已经结束，不能继续修改", 409);
    }
  }

  async #requireEditableProgram(
    userId: string,
    programId: string,
    weekNumber: number,
  ): Promise<TrainingProgram> {
    const program = await this.getProgram(userId, programId);
    if (program.archivedAt !== null) {
      throw new TrainingError("training_program_not_found", "这个周期计划已经归档", 404);
    }
    if (!Number.isInteger(weekNumber) || weekNumber < 1 || weekNumber > program.weekCount) {
      throw new TrainingError("invalid_training_input", "训练日周次超出周期范围", 400);
    }
    return program;
  }

  async #normalizeSchedule(
    userId: string,
    input: TrainingScheduleInput,
  ): Promise<TrainingScheduleInput & {
    readonly sourceTemplateName: string | null;
    readonly sourceProgramName: string | null;
    readonly sourceWeekNumber: number | null;
    readonly sourceTrainingDayName: string | null;
  }> {
    localDateAt(this.#now(), input.timeZone);
    const localDate = validLocalDate(input.localDate);
    const usesTemplate = input.sourceTemplateId !== null;
    const usesProgramUnit = input.sourceProgramId !== null || input.sourceProgramUnitId !== null;
    if ((usesTemplate && usesProgramUnit) || (input.sourceProgramId === null) !== (input.sourceProgramUnitId === null)) {
      throw new TrainingError("invalid_training_input", "训练日程只能选择一个方案、一个周期训练日或纯主题", 400);
    }
    const template = input.sourceTemplateId === null
      ? null
      : await this.#repository.findTemplate(userId, input.sourceTemplateId);
    if (input.sourceTemplateId !== null && (template === null || template.archivedAt !== null)) {
      throw new TrainingError("training_template_not_found", "没有找到可安排的单次方案", 404);
    }
    const program = input.sourceProgramId === null
      ? null
      : await this.#repository.findProgram(userId, input.sourceProgramId);
    const unit = input.sourceProgramUnitId === null
      ? null
      : program?.units.find((candidate) => candidate.id === input.sourceProgramUnitId) ?? null;
    if (input.sourceProgramId !== null && (program === null || program.archivedAt !== null || unit === null)) {
      throw new TrainingError("training_program_unit_not_found", "没有找到可安排的周期训练日", 404);
    }
    const sourceTitle = template?.name ?? unit?.name ?? null;
    const title = cleanText(input.title, 80) ?? sourceTitle;
    if (title === null) {
      throw new TrainingError("invalid_training_input", "纯训练主题需要填写名称", 400);
    }
    return {
      localDate,
      timeZone: input.timeZone,
      title,
      note: cleanText(input.note, 1000),
      sourceTemplateId: template?.id ?? null,
      sourceTemplateName: template?.name ?? null,
      sourceProgramId: program?.id ?? null,
      sourceProgramName: program?.name ?? null,
      sourceProgramUnitId: unit?.id ?? null,
      sourceWeekNumber: unit?.weekNumber ?? null,
      sourceTrainingDayName: unit?.name ?? null,
    };
  }
}
