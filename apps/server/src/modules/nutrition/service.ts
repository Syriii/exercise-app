import { randomUUID } from "node:crypto";

import { NutritionError } from "./errors.js";
import type { ContributionInput, FoodTemplateInput, MealMetadataInput, NutritionRepository } from "./repository.js";
import type { DietPlanInput, FoodSearchResult, Meal, MealContributionMode, NutrientValues, NutritionDaySummary } from "./types.js";

export interface DailyNutritionTargets extends NutrientValues {}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validTimeZone(value: string): boolean {
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
}

function cleanText(value: string | null, maximum: number): string | null {
  if (value === null) return null;
  const cleaned = value.trim();
  if (cleaned.length === 0) return null;
  if (cleaned.length > maximum) throw new NutritionError("invalid_nutrition_input", `文字不能超过 ${maximum} 个字符`, 400);
  return cleaned;
}

function nonnegative(value: number | null, name: string, maximum: number): number | null {
  if (value === null) return null;
  if (!Number.isFinite(value) || value < 0 || value > maximum) throw new NutritionError("invalid_nutrition_input", `${name}必须是 0–${maximum} 的数字`, 400);
  return value;
}

function round(value: number): number { return Math.round(value * 10) / 10; }

export class NutritionService {
  public constructor(private readonly repository: NutritionRepository) {}

  public async listMeals(userId: string, from: string, to: string): Promise<readonly Meal[]> {
    this.assertDate(from); this.assertDate(to);
    if (from > to) throw new NutritionError("invalid_nutrition_input", "开始日期不能晚于结束日期", 400);
    return this.repository.listMeals(userId, from, to);
  }

  public async listDietPlans(userId: string, dateFrom: string, dateTo: string, includeArchived = false) {
    this.assertDate(dateFrom); this.assertDate(dateTo);
    if (dateFrom > dateTo) throw new NutritionError("invalid_nutrition_input", "饮食计划开始日期不能晚于结束日期", 400);
    return this.repository.listDietPlans(userId, dateFrom, dateTo, includeArchived);
  }

  public async createDietPlan(userId: string, input: DietPlanInput) {
    return this.repository.createDietPlan(userId, this.dietPlanInput(input));
  }

  public async updateDietPlan(userId: string, planId: string, revision: number, input: DietPlanInput) {
    const result = await this.repository.updateDietPlan(userId, planId, revision, this.dietPlanInput(input));
    if (result === "not_found") throw new NutritionError("diet_plan_not_found", "找不到这份饮食计划", 404);
    if (result === "revision_conflict") this.revisionConflict();
    return result;
  }

  public async archiveDietPlan(userId: string, planId: string, revision: number) {
    const result = await this.repository.archiveDietPlan(userId, planId, revision, new Date());
    if (result === "not_found") throw new NutritionError("diet_plan_not_found", "找不到这份饮食计划", 404);
    if (result === "revision_conflict") this.revisionConflict();
    return result;
  }

  public async getMeal(userId: string, mealId: string): Promise<Meal> {
    const meal = await this.repository.getMeal(userId, mealId);
    if (meal === null) throw new NutritionError("meal_not_found", "找不到这顿饭", 404);
    return meal;
  }

  public async createMeal(userId: string, input: { occurredAt: string; localDate: string; timeZone: string; name: string | null; note: string | null }): Promise<Meal> {
    return this.repository.createMeal(userId, this.mealInput(input));
  }

  public async updateMeal(userId: string, mealId: string, revision: number, input: { occurredAt: string; localDate: string; timeZone: string; name: string | null; note: string | null }): Promise<Meal> {
    const result = await this.repository.updateMeal(userId, mealId, revision, this.mealInput(input));
    return this.unwrapMeal(result);
  }

  public async deleteMeal(userId: string, mealId: string, revision: number): Promise<void> {
    const result = await this.repository.deleteMeal(userId, mealId, revision);
    if (result === "not_found") throw new NutritionError("meal_not_found", "找不到这顿饭", 404);
    if (result === "revision_conflict") this.revisionConflict();
  }

  public async listMealRevisions(userId: string, mealId: string) {
    const result = await this.repository.listMealRevisions(userId, mealId);
    if (result === "not_found") throw new NutritionError("meal_not_found", "找不到这顿饭", 404);
    return result;
  }

  public async addContribution(userId: string, mealId: string, mealRevision: number, input: ContributionRequest, replaceExisting: boolean): Promise<Meal> {
    return this.unwrapMeal(await this.repository.addContribution(userId, mealId, mealRevision, this.contributionInput(input), replaceExisting));
  }

  public async adoptModelContribution(userId: string, mealId: string, mealRevision: number, analysisId: string, input: ContributionRequest, replaceExisting: boolean): Promise<Meal> {
    const meal = await this.getMeal(userId, mealId);
    const tentative = meal.contributions.find((value) => value.sourceAnalysisId === analysisId && value.reviewStatus === "tentative");
    const alreadyConfirmed = meal.contributions.find((value) => value.sourceAnalysisId === analysisId && value.reviewStatus === "confirmed");
    if (alreadyConfirmed !== undefined) return meal;
    const confirmed = { ...this.contributionInput(input), source: "model_adopted" as const, sourceAnalysisId: analysisId, reviewStatus: "confirmed" as const };
    if (tentative !== undefined) {
      return this.unwrapMeal(await this.repository.updateContribution(userId, mealId, tentative.id, mealRevision, tentative.revision, confirmed, replaceExisting));
    }
    return this.unwrapMeal(await this.repository.addContribution(userId, mealId, mealRevision, confirmed, replaceExisting));
  }

  public async ensureTentativeModelContribution(userId: string, mealId: string, analysisId: string, candidate: {
    readonly title: string;
    readonly energyKcal: number | null;
    readonly proteinGrams: number | null;
    readonly carbohydrateGrams: number | null;
    readonly fatGrams: number | null;
    readonly uncertaintyNote: string;
  }): Promise<Meal> {
    let meal = await this.getMeal(userId, mealId);
    if (meal.contributions.length > 0 || [candidate.energyKcal, candidate.proteinGrams, candidate.carbohydrateGrams, candidate.fatGrams].every((value) => value === null)) return meal;
    const result = await this.repository.addContribution(userId, mealId, meal.revision, {
      mode: "whole_meal",
      source: "model_adopted",
      reviewStatus: "tentative",
      sourceAnalysisId: analysisId,
      label: candidate.title.trim() || "照片营养估算",
      portionAmount: null,
      portionUnit: null,
      basisDescription: candidate.uncertaintyNote.trim() || "按照片中可见盛取量估算",
      energyKcal: candidate.energyKcal,
      proteinGrams: candidate.proteinGrams,
      carbohydrateGrams: candidate.carbohydrateGrams,
      fatGrams: candidate.fatGrams,
    }, false);
    if (result === "revision_conflict" || result === "replacement_required") {
      meal = await this.getMeal(userId, mealId);
      return meal;
    }
    return this.unwrapMeal(result);
  }

  public async updateContribution(userId: string, mealId: string, contributionId: string, mealRevision: number, contributionRevision: number, input: ContributionRequest, replaceExisting: boolean): Promise<Meal> {
    const meal = await this.getMeal(userId, mealId);
    const existing = meal.contributions.find((value) => value.id === contributionId);
    const normalized = this.contributionInput(input);
    const savedInput = existing?.source === "model_adopted"
      ? { ...normalized, source: existing.source, sourceAnalysisId: existing.sourceAnalysisId, reviewStatus: "confirmed" as const }
      : normalized;
    return this.unwrapMeal(await this.repository.updateContribution(userId, mealId, contributionId, mealRevision, contributionRevision, savedInput, replaceExisting));
  }

  public async deleteContribution(userId: string, mealId: string, contributionId: string, mealRevision: number, contributionRevision: number): Promise<Meal> {
    return this.unwrapMeal(await this.repository.deleteContribution(userId, mealId, contributionId, mealRevision, contributionRevision));
  }

  public async listContributionRevisions(userId: string, mealId: string) {
    const result = await this.repository.listContributionRevisions(userId, mealId);
    if (result === "not_found") throw new NutritionError("meal_not_found", "找不到这顿饭", 404);
    return result;
  }

  public async getDaySummary(userId: string, localDate: string, targets: DailyNutritionTargets): Promise<NutritionDaySummary> {
    this.assertDate(localDate);
    const meals = await this.repository.listMeals(userId, localDate, localDate);
    const contributions = meals.flatMap((meal) => [...meal.contributions]);
    const summarize = (key: keyof NutrientValues, target: number | null) => {
      const values = contributions.map((value) => value[key]);
      const known = values.filter((value): value is number => value !== null);
      const recorded = meals.length === 0
        ? 0
        : known.length === 0
          ? null
          : round(known.reduce((total, value) => total + value, 0));
      const complete = meals.length > 0 && contributions.length > 0 && values.length > 0 && values.every((value) => value !== null) && meals.every((meal) => meal.contributions.length > 0);
      return { recorded, target, remaining: recorded === null || target === null ? null : round(target - recorded), complete };
    };
    return {
      localDate,
      mealCount: meals.length,
      coverageConfirmed: await this.repository.getCoverageConfirmed(userId, localDate),
      energyKcal: summarize("energyKcal", targets.energyKcal),
      proteinGrams: summarize("proteinGrams", targets.proteinGrams),
      carbohydrateGrams: summarize("carbohydrateGrams", targets.carbohydrateGrams),
      fatGrams: summarize("fatGrams", targets.fatGrams),
    };
  }

  public async setCoverageConfirmed(userId: string, localDate: string, confirmed: boolean): Promise<boolean> { this.assertDate(localDate); return this.repository.setCoverageConfirmed(userId, localDate, confirmed); }

  public async listFoodTemplates(userId: string) { return this.repository.listFoodTemplates(userId); }

  public async searchFoods(userId: string, query: string, asOfDate: string): Promise<readonly FoodSearchResult[]> {
    this.assertDate(asOfDate);
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
    if (normalizedQuery.length > 100) throw new NutritionError("invalid_nutrition_input", "搜索内容不能超过 100 个字符", 400);
    const start = new Date(`${asOfDate}T00:00:00.000Z`);
    start.setUTCDate(start.getUTCDate() - 89);
    const from = start.toISOString().slice(0, 10);
    const [templates, meals] = await Promise.all([
      this.repository.listFoodTemplates(userId),
      this.repository.listMeals(userId, from, asOfDate),
    ]);
    const matches = (label: string) => normalizedQuery.length === 0 || label.toLocaleLowerCase("zh-CN").includes(normalizedQuery);
    const candidates: FoodSearchResult[] = [
      ...templates.filter((value) => matches(value.label)).map((value) => ({
        id: `template:${value.id}`,
        source: "personal_template" as const,
        label: value.label,
        portionAmount: value.portionAmount,
        portionUnit: value.portionUnit,
        basisDescription: value.basisDescription,
        energyKcal: value.energyKcal,
        proteinGrams: value.proteinGrams,
        carbohydrateGrams: value.carbohydrateGrams,
        fatGrams: value.fatGrams,
        lastUsedAt: value.updatedAt,
      })),
      ...meals.flatMap((meal) => meal.contributions
        .filter((value) => matches(value.label))
        .map((value) => ({
          id: `recent:${value.id}`,
          source: "recent_meal" as const,
          label: value.label,
          portionAmount: value.portionAmount,
          portionUnit: value.portionUnit,
          basisDescription: value.basisDescription,
          energyKcal: value.energyKcal,
          proteinGrams: value.proteinGrams,
          carbohydrateGrams: value.carbohydrateGrams,
          fatGrams: value.fatGrams,
          lastUsedAt: value.updatedAt,
        }))),
    ].sort((left, right) => {
      if (left.source !== right.source) return left.source === "personal_template" ? -1 : 1;
      return right.lastUsedAt.getTime() - left.lastUsedAt.getTime();
    });
    const seen = new Set<string>();
    return candidates.filter((value) => {
      const key = JSON.stringify([value.label.trim().toLocaleLowerCase("zh-CN"), value.portionAmount, value.portionUnit, value.basisDescription, value.energyKcal, value.proteinGrams, value.carbohydrateGrams, value.fatGrams]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 50);
  }

  public async createFoodTemplate(userId: string, input: ContributionRequest) { return this.repository.createFoodTemplate(userId, this.foodTemplateInput(input)); }
  public async updateFoodTemplate(userId: string, id: string, revision: number, input: ContributionRequest) {
    const result = await this.repository.updateFoodTemplate(userId, id, revision, this.foodTemplateInput(input));
    if (result === "not_found") throw new NutritionError("food_template_not_found", "找不到这个常用食物", 404);
    if (result === "revision_conflict") this.revisionConflict();
    return result;
  }
  public async deleteFoodTemplate(userId: string, id: string, revision: number): Promise<void> {
    const result = await this.repository.deleteFoodTemplate(userId, id, revision);
    if (result === "not_found") throw new NutritionError("food_template_not_found", "找不到这个常用食物", 404);
    if (result === "revision_conflict") this.revisionConflict();
  }

  private mealInput(input: { occurredAt: string; localDate: string; timeZone: string; name: string | null; note: string | null }): MealMetadataInput {
    const occurredAt = new Date(input.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) throw new NutritionError("invalid_nutrition_input", "用餐时间格式不正确", 400);
    this.assertDate(input.localDate);
    if (!validTimeZone(input.timeZone)) throw new NutritionError("invalid_nutrition_input", "用餐时区无效", 400);
    return { occurredAt, localDate: input.localDate, timeZone: input.timeZone, name: cleanText(input.name, 100), note: cleanText(input.note, 500) };
  }

  private dietPlanInput(input: DietPlanInput) {
    this.assertDate(input.dateFrom); this.assertDate(input.dateTo);
    if (input.dateFrom > input.dateTo) throw new NutritionError("invalid_nutrition_input", "饮食计划开始日期不能晚于结束日期", 400);
    const rangeDays = Math.round((new Date(`${input.dateTo}T00:00:00.000Z`).getTime() - new Date(`${input.dateFrom}T00:00:00.000Z`).getTime()) / 86_400_000);
    if (rangeDays > 366) throw new NutritionError("invalid_nutrition_input", "一份饮食计划的日期范围不能超过 366 天", 400);
    const title = cleanText(input.title, 100);
    if (title === null) throw new NutritionError("invalid_nutrition_input", "饮食计划需要名称", 400);
    if (input.entries.length > 50) throw new NutritionError("invalid_nutrition_input", "一份饮食计划最多包含 50 条安排", 400);
    const entries = input.entries.map((entry) => {
      if (entry.localDate !== null) {
        this.assertDate(entry.localDate);
        if (entry.localDate < input.dateFrom || entry.localDate > input.dateTo) throw new NutritionError("invalid_nutrition_input", "计划条目的日期必须在计划范围内", 400);
      }
      const foodPlan = cleanText(entry.foodPlan, 500);
      if (foodPlan === null) throw new NutritionError("invalid_nutrition_input", "每条饮食安排都要说明准备怎么吃", 400);
      return { id: randomUUID(), localDate: entry.localDate, mealName: cleanText(entry.mealName, 50), foodPlan, note: cleanText(entry.note, 300) };
    });
    return { dateFrom: input.dateFrom, dateTo: input.dateTo, title, note: cleanText(input.note, 1000), entries };
  }

  private contributionInput(input: ContributionRequest): ContributionInput {
    const nutrients = this.nutrients(input);
    if (Object.values(nutrients).every((value) => value === null)) throw new NutritionError("invalid_nutrition_input", "至少填写一项营养值；未知项可以留空", 400);
    return { mode: input.mode, source: "manual", reviewStatus: "confirmed", sourceAnalysisId: null, label: cleanText(input.label, 100) ?? "", portionAmount: nonnegative(input.portionAmount, "份量", 100000), portionUnit: cleanText(input.portionUnit, 30), basisDescription: cleanText(input.basisDescription, 200), ...nutrients };
  }

  private foodTemplateInput(input: ContributionRequest): FoodTemplateInput {
    const value = this.contributionInput({ ...input, mode: "item" });
    const { mode: _mode, source: _source, reviewStatus: _reviewStatus, sourceAnalysisId: _sourceAnalysisId, ...template } = value;
    return template;
  }

  private nutrients(input: NutrientValues): NutrientValues { return { energyKcal: nonnegative(input.energyKcal, "能量", 100000), proteinGrams: nonnegative(input.proteinGrams, "蛋白质", 10000), carbohydrateGrams: nonnegative(input.carbohydrateGrams, "碳水化合物", 10000), fatGrams: nonnegative(input.fatGrams, "脂肪", 10000) }; }
  private assertDate(value: string) { if (!validDate(value)) throw new NutritionError("invalid_nutrition_input", "日期格式不正确", 400); }
  private revisionConflict(): never { throw new NutritionError("nutrition_revision_conflict", "记录已经在其他页面更新，请刷新后重试", 409); }
  private unwrapMeal(result: Meal | "not_found" | "contribution_not_found" | "revision_conflict" | "replacement_required"): Meal {
    if (result === "not_found") throw new NutritionError("meal_not_found", "找不到这顿饭", 404);
    if (result === "contribution_not_found") throw new NutritionError("contribution_not_found", "找不到这条营养记录", 404);
    if (result === "revision_conflict") this.revisionConflict();
    if (result === "replacement_required") throw new NutritionError("nutrition_replacement_required", "整餐总量与食物条目不能同时计入；请明确选择替代现有内容", 409);
    return result;
  }
}

export interface ContributionRequest extends NutrientValues {
  readonly mode: MealContributionMode;
  readonly label: string;
  readonly portionAmount: number | null;
  readonly portionUnit: string | null;
  readonly basisDescription: string | null;
}
