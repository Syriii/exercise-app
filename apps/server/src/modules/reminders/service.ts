import type { NutritionService } from "../nutrition/service.js";
import type { PlanningService } from "../planning/service.js";
import type { TrainingService } from "../training/service.js";
import { ReminderError } from "./errors.js";
import type { ReminderRepository } from "./repository.js";
import type { MeasurementReminderSettings, MeasurementReminderStatus, NutritionReminderSettings, NutritionReminderStatus, TrainingReminderDayState, TrainingReminderSettings, TrainingReminderStatus } from "./types.js";

const localTimePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

function validTimeZone(timeZone: string, now: Date): string {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);
    return timeZone;
  } catch {
    throw new ReminderError("invalid_reminder_input", "无法识别提醒时区", 400);
  }
}

function validLocalDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ReminderError("invalid_reminder_input", "提醒日期格式不正确", 400);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new ReminderError("invalid_reminder_input", "提醒日期不存在", 400);
  }
  return value;
}

function localClock(now: Date, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}` };
}

export class ReminderService {
  readonly #repository: ReminderRepository;
  readonly #trainingService: TrainingService;
  readonly #nutritionService: NutritionService | undefined;
  readonly #planningService: PlanningService | undefined;
  readonly #now: () => Date;

  public constructor(options: {
    repository: ReminderRepository;
    trainingService: TrainingService;
    nutritionService?: NutritionService;
    planningService?: PlanningService;
    now?: () => Date;
  }) {
    this.#repository = options.repository;
    this.#trainingService = options.trainingService;
    this.#nutritionService = options.nutritionService;
    this.#planningService = options.planningService;
    this.#now = options.now ?? (() => new Date());
  }

  public async getTrainingSettings(userId: string, defaultTimeZone: string): Promise<TrainingReminderSettings> {
    const stored = await this.#repository.getTrainingSettings(userId);
    if (stored !== null) return stored;
    return {
      enabled: false,
      localTime: "18:00",
      timeZone: validTimeZone(defaultTimeZone, this.#now()),
      revision: 0,
      updatedAt: null,
    };
  }

  public async updateTrainingSettings(
    userId: string,
    expectedRevision: number,
    input: { readonly enabled: boolean; readonly localTime: string; readonly timeZone: string },
  ): Promise<TrainingReminderSettings> {
    if (!localTimePattern.test(input.localTime)) {
      throw new ReminderError("invalid_reminder_input", "提醒时间格式不正确", 400);
    }
    const result = await this.#repository.saveTrainingSettings(userId, expectedRevision, {
      enabled: input.enabled,
      localTime: input.localTime,
      timeZone: validTimeZone(input.timeZone, this.#now()),
    });
    if (result === "revision_conflict") {
      throw new ReminderError("reminder_revision_conflict", "提醒设置已在其他页面更新，请刷新后重试", 409);
    }
    return result;
  }

  public async getTrainingStatus(
    userId: string,
    localDateInput: string,
    defaultTimeZone: string,
  ): Promise<TrainingReminderStatus> {
    const localDate = validLocalDate(localDateInput);
    const settings = await this.getTrainingSettings(userId, defaultTimeZone);
    const schedules = await this.#trainingService.listSchedules(userId, localDate, localDate);
    const scheduleCount = schedules.filter((schedule) => schedule.status === "scheduled").length;
    if (!settings.enabled) return { state: "disabled", scheduleCount, nextAt: null };
    if (scheduleCount === 0) return { state: "none_scheduled", scheduleCount: 0, nextAt: null };
    const dayState = await this.#repository.getTrainingDayState(userId, localDate);
    if (dayState?.status === "dismissed") return { state: "dismissed", scheduleCount, nextAt: null };
    const now = this.#now();
    if (dayState?.status === "snoozed" && dayState.snoozedUntil !== null && dayState.snoozedUntil > now) {
      return { state: "snoozed", scheduleCount, nextAt: dayState.snoozedUntil };
    }
    const clock = localClock(now, settings.timeZone);
    if (clock.date !== localDate || clock.time < settings.localTime) {
      return { state: "not_due", scheduleCount, nextAt: null };
    }
    return { state: "due", scheduleCount, nextAt: null };
  }

  public async snoozeTraining(userId: string, localDateInput: string, minutes: number) {
    const localDate = validLocalDate(localDateInput);
    if (!Number.isInteger(minutes) || minutes < 15 || minutes > 1440) {
      throw new ReminderError("invalid_reminder_input", "稍后提醒需设置为 15 分钟到 24 小时", 400);
    }
    const snoozedUntil = new Date(this.#now().getTime() + minutes * 60_000);
    return this.#repository.saveTrainingDayState(userId, { localDate, status: "snoozed", snoozedUntil });
  }

  public dismissTraining(userId: string, localDateInput: string) {
    return this.#repository.saveTrainingDayState(userId, {
      localDate: validLocalDate(localDateInput),
      status: "dismissed",
      snoozedUntil: null,
    });
  }

  public async getNutritionSettings(userId: string, defaultTimeZone: string): Promise<NutritionReminderSettings> {
    return (await this.#repository.getNutritionSettings(userId)) ?? { enabled: false, localTime: "20:00", timeZone: validTimeZone(defaultTimeZone, this.#now()), revision: 0, updatedAt: null };
  }

  public async updateNutritionSettings(userId: string, expectedRevision: number, input: { enabled: boolean; localTime: string; timeZone: string }) {
    this.#validateSettings(input.localTime, input.timeZone);
    const result = await this.#repository.saveNutritionSettings(userId, expectedRevision, input);
    if (result === "revision_conflict") this.#revisionConflict();
    return result;
  }

  public async getNutritionStatus(userId: string, localDateInput: string, defaultTimeZone: string): Promise<NutritionReminderStatus> {
    const localDate = validLocalDate(localDateInput);
    const settings = await this.getNutritionSettings(userId, defaultTimeZone);
    if (!settings.enabled) return { state: "disabled", reason: null, mealCount: 0, nextAt: null };
    const paused = await this.#pausedStatus(await this.#repository.getNutritionDayState(userId, localDate));
    if (paused !== null) return { ...paused, reason: null, mealCount: 0 };
    if (!this.#isDue(localDate, settings.localTime, settings.timeZone)) return { state: "not_due", reason: null, mealCount: 0, nextAt: null };
    if (this.#nutritionService === undefined || this.#planningService === undefined) throw new Error("nutrition reminder dependencies unavailable");
    const reference = await this.#planningService.getDailyReference(userId, localDate, settings.timeZone);
    const summary = await this.#nutritionService.getDaySummary(userId, localDate, { energyKcal: reference.result.targetEnergyKcal, proteinGrams: reference.result.proteinGrams, carbohydrateGrams: reference.result.carbohydrateGrams, fatGrams: reference.result.fatGrams });
    const values = [summary.energyKcal, summary.proteinGrams, summary.carbohydrateGrams, summary.fatGrams];
    const reason = summary.mealCount === 0 ? "no_meals" : values.some((value) => !value.complete) ? "incomplete" : values.some((value) => value.remaining !== null && value.remaining < 0) ? "over_target" : "remaining";
    return { state: "due", reason, mealCount: summary.mealCount, nextAt: null };
  }

  public snoozeNutrition(userId: string, localDateInput: string, minutes: number) { return this.#snooze((state) => this.#repository.saveNutritionDayState(userId, state), localDateInput, minutes); }
  public dismissNutrition(userId: string, localDateInput: string) { return this.#repository.saveNutritionDayState(userId, { localDate: validLocalDate(localDateInput), status: "dismissed", snoozedUntil: null }); }

  public async getMeasurementSettings(userId: string, defaultTimeZone: string): Promise<MeasurementReminderSettings> {
    return (await this.#repository.getMeasurementSettings(userId)) ?? { enabled: true, intervalDays: 7, localTime: "09:00", timeZone: validTimeZone(defaultTimeZone, this.#now()), revision: 0, updatedAt: null };
  }

  public async updateMeasurementSettings(userId: string, expectedRevision: number, input: { enabled: boolean; intervalDays: number; localTime: string; timeZone: string }) {
    this.#validateSettings(input.localTime, input.timeZone);
    if (!Number.isInteger(input.intervalDays) || input.intervalDays < 1 || input.intervalDays > 365) throw new ReminderError("invalid_reminder_input", "身体测量提醒周期需为 1–365 天", 400);
    const result = await this.#repository.saveMeasurementSettings(userId, expectedRevision, input);
    if (result === "revision_conflict") this.#revisionConflict();
    return result;
  }

  public async getMeasurementStatus(userId: string, localDateInput: string, defaultTimeZone: string): Promise<MeasurementReminderStatus> {
    const localDate = validLocalDate(localDateInput);
    const settings = await this.getMeasurementSettings(userId, defaultTimeZone);
    const latest = this.#planningService === undefined ? null : (await this.#planningService.listMeasurements(userId))[0] ?? null;
    const nextDueDate = latest === null ? localDate : addDays(latest.localDate, settings.intervalDays);
    if (!settings.enabled) return { state: "disabled", latestMeasurementDate: latest?.localDate ?? null, nextDueDate, nextAt: null };
    const paused = await this.#pausedStatus(await this.#repository.getMeasurementDayState(userId, localDate));
    if (paused !== null) return { ...paused, latestMeasurementDate: latest?.localDate ?? null, nextDueDate };
    const due = localDate >= nextDueDate && this.#isDue(localDate, settings.localTime, settings.timeZone);
    return { state: due ? "due" : "not_due", latestMeasurementDate: latest?.localDate ?? null, nextDueDate, nextAt: null };
  }

  public snoozeMeasurement(userId: string, localDateInput: string, minutes: number) { return this.#snooze((state) => this.#repository.saveMeasurementDayState(userId, state), localDateInput, minutes); }
  public dismissMeasurement(userId: string, localDateInput: string) { return this.#repository.saveMeasurementDayState(userId, { localDate: validLocalDate(localDateInput), status: "dismissed", snoozedUntil: null }); }

  #validateSettings(localTime: string, timeZone: string) { if (!localTimePattern.test(localTime)) throw new ReminderError("invalid_reminder_input", "提醒时间格式不正确", 400); validTimeZone(timeZone, this.#now()); }
  #revisionConflict(): never { throw new ReminderError("reminder_revision_conflict", "提醒设置已在其他页面更新，请刷新后重试", 409); }
  #isDue(localDate: string, localTime: string, timeZone: string) { const clock = localClock(this.#now(), timeZone); return clock.date === localDate && clock.time >= localTime; }
  async #pausedStatus(state: { status: "snoozed" | "dismissed"; snoozedUntil: Date | null } | null): Promise<{ state: "snoozed" | "dismissed"; nextAt: Date | null } | null> { if (state?.status === "dismissed") return { state: "dismissed", nextAt: null }; if (state?.status === "snoozed" && state.snoozedUntil !== null && state.snoozedUntil > this.#now()) return { state: "snoozed", nextAt: state.snoozedUntil }; return null; }
  #snooze(save: (state: TrainingReminderDayState) => Promise<TrainingReminderDayState>, localDateInput: string, minutes: number) { const localDate = validLocalDate(localDateInput); if (!Number.isInteger(minutes) || minutes < 15 || minutes > 1440) throw new ReminderError("invalid_reminder_input", "稍后提醒需设置为 15 分钟到 24 小时", 400); const state = { localDate, status: "snoozed" as const, snoozedUntil: new Date(this.#now().getTime() + minutes * 60_000) }; return save(state); }
}

function addDays(localDate: string, days: number): string { const value = new Date(`${localDate}T00:00:00.000Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); }
