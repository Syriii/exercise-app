import { randomUUID } from "node:crypto";

import type { ContributionInput, DietPlanRepositoryInput, FoodTemplateInput, MealMetadataInput, NutritionRepository } from "./repository.js";
import type { DietPlan, Meal, MealContribution, MealContributionRevision, MealRevision, PersonalFoodTemplate } from "./types.js";

function clone<T>(value: T): T { return structuredClone(value); }

export class MemoryNutritionRepository implements NutritionRepository {
  readonly #meals = new Map<string, Meal[]>();
  readonly #mealRevisions = new Map<string, MealRevision[]>();
  readonly #contributionRevisions = new Map<string, MealContributionRevision[]>();
  readonly #contributionMeals = new Map<string, string>();
  readonly #coverage = new Map<string, boolean>();
  readonly #templates = new Map<string, PersonalFoodTemplate[]>();
  readonly #dietPlans = new Map<string, DietPlan[]>();

  public async listDietPlans(userId: string, dateFrom: string, dateTo: string, includeArchived: boolean): Promise<readonly DietPlan[]> {
    return clone((this.#dietPlans.get(userId) ?? []).filter((value) => value.dateFrom <= dateTo && value.dateTo >= dateFrom && (includeArchived || value.archivedAt === null)).sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime()));
  }

  public async createDietPlan(userId: string, input: DietPlanRepositoryInput): Promise<DietPlan> {
    const now = new Date();
    const saved: DietPlan = { id: randomUUID(), userId, ...input, revision: 1, archivedAt: null, createdAt: now, updatedAt: now };
    this.#dietPlans.set(userId, [...(this.#dietPlans.get(userId) ?? []), saved]);
    return clone(saved);
  }

  public async updateDietPlan(userId: string, planId: string, expectedRevision: number, input: DietPlanRepositoryInput): Promise<DietPlan | "not_found" | "revision_conflict"> {
    const values = this.#dietPlans.get(userId) ?? []; const index = values.findIndex((value) => value.id === planId);
    if (index < 0) return "not_found"; if (values[index]!.revision !== expectedRevision) return "revision_conflict";
    const saved = { ...values[index]!, ...input, revision: expectedRevision + 1, updatedAt: new Date() }; values[index] = saved; return clone(saved);
  }

  public async archiveDietPlan(userId: string, planId: string, expectedRevision: number, archivedAt: Date): Promise<DietPlan | "not_found" | "revision_conflict"> {
    const values = this.#dietPlans.get(userId) ?? []; const index = values.findIndex((value) => value.id === planId);
    if (index < 0) return "not_found"; if (values[index]!.revision !== expectedRevision) return "revision_conflict";
    const saved = { ...values[index]!, archivedAt, revision: expectedRevision + 1, updatedAt: new Date() }; values[index] = saved; return clone(saved);
  }

  public async listMeals(userId: string, from: string, to: string): Promise<readonly Meal[]> {
    return clone((this.#meals.get(userId) ?? []).filter((meal) => meal.localDate >= from && meal.localDate <= to).sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()));
  }

  public async getMeal(userId: string, mealId: string): Promise<Meal | null> {
    const meal = (this.#meals.get(userId) ?? []).find((candidate) => candidate.id === mealId);
    return meal === undefined ? null : clone(meal);
  }

  public async createMeal(userId: string, input: MealMetadataInput): Promise<Meal> {
    const now = new Date();
    const meal: Meal = { id: randomUUID(), ...input, revision: 1, contributions: [], createdAt: now, updatedAt: now };
    this.#meals.set(userId, [...(this.#meals.get(userId) ?? []), meal]);
    return clone(meal);
  }

  public async updateMeal(userId: string, mealId: string, expectedRevision: number, input: MealMetadataInput): Promise<Meal | "not_found" | "revision_conflict"> {
    const pair = this.findMeal(userId, mealId);
    if (pair === null) return "not_found";
    if (pair.meal.revision !== expectedRevision) return "revision_conflict";
    this.saveMealRevision(pair.meal);
    const saved: Meal = { ...pair.meal, ...input, revision: expectedRevision + 1, updatedAt: new Date() };
    pair.values[pair.index] = saved;
    return clone(saved);
  }

  public async deleteMeal(userId: string, mealId: string, expectedRevision: number): Promise<"deleted" | "not_found" | "revision_conflict"> {
    const pair = this.findMeal(userId, mealId);
    if (pair === null) return "not_found";
    if (pair.meal.revision !== expectedRevision) return "revision_conflict";
    pair.values.splice(pair.index, 1);
    return "deleted";
  }

  public async listMealRevisions(userId: string, mealId: string): Promise<readonly MealRevision[] | "not_found"> {
    if (this.findMeal(userId, mealId) === null) return "not_found";
    return clone([...(this.#mealRevisions.get(mealId) ?? [])].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()));
  }

  public async addContribution(userId: string, mealId: string, expectedMealRevision: number, input: ContributionInput, replaceExisting: boolean): Promise<Meal | "not_found" | "revision_conflict" | "replacement_required"> {
    const pair = this.findMeal(userId, mealId);
    if (pair === null) return "not_found";
    if (pair.meal.revision !== expectedMealRevision) return "revision_conflict";
    if (this.requiresReplacement(pair.meal.contributions, input.mode) && !replaceExisting) return "replacement_required";
    const now = new Date();
    const contribution: MealContribution = { id: randomUUID(), mealId, ...input, revision: 1, createdAt: now, updatedAt: now };
    this.#contributionMeals.set(contribution.id, mealId);
    if (replaceExisting) pair.meal.contributions.forEach((value) => this.saveContributionRevision(value));
    const saved: Meal = { ...pair.meal, contributions: replaceExisting ? [contribution] : [...pair.meal.contributions, contribution], revision: expectedMealRevision + 1, updatedAt: now };
    pair.values[pair.index] = saved;
    return clone(saved);
  }

  public async updateContribution(userId: string, mealId: string, contributionId: string, expectedMealRevision: number, expectedContributionRevision: number, input: ContributionInput, replaceExisting: boolean): Promise<Meal | "not_found" | "contribution_not_found" | "revision_conflict" | "replacement_required"> {
    const pair = this.findMeal(userId, mealId);
    if (pair === null) return "not_found";
    if (pair.meal.revision !== expectedMealRevision) return "revision_conflict";
    const existing = pair.meal.contributions.find((value) => value.id === contributionId);
    if (existing === undefined) return "contribution_not_found";
    if (existing.revision !== expectedContributionRevision) return "revision_conflict";
    const others = pair.meal.contributions.filter((value) => value.id !== contributionId);
    if (this.requiresReplacement(others, input.mode) && !replaceExisting) return "replacement_required";
    this.saveContributionRevision(existing);
    const updated: MealContribution = { ...existing, ...input, revision: expectedContributionRevision + 1, updatedAt: new Date() };
    if (replaceExisting) others.forEach((value) => this.saveContributionRevision(value));
    const contributions = replaceExisting ? [updated] : pair.meal.contributions.map((value) => value.id === contributionId ? updated : value);
    const saved: Meal = { ...pair.meal, contributions, revision: expectedMealRevision + 1, updatedAt: new Date() };
    pair.values[pair.index] = saved;
    return clone(saved);
  }

  public async deleteContribution(userId: string, mealId: string, contributionId: string, expectedMealRevision: number, expectedContributionRevision: number): Promise<Meal | "not_found" | "contribution_not_found" | "revision_conflict"> {
    const pair = this.findMeal(userId, mealId);
    if (pair === null) return "not_found";
    if (pair.meal.revision !== expectedMealRevision) return "revision_conflict";
    const existing = pair.meal.contributions.find((value) => value.id === contributionId);
    if (existing === undefined) return "contribution_not_found";
    if (existing.revision !== expectedContributionRevision) return "revision_conflict";
    this.saveContributionRevision(existing);
    const saved: Meal = { ...pair.meal, contributions: pair.meal.contributions.filter((value) => value.id !== contributionId), revision: expectedMealRevision + 1, updatedAt: new Date() };
    pair.values[pair.index] = saved;
    return clone(saved);
  }

  public async listContributionRevisions(userId: string, mealId: string): Promise<readonly MealContributionRevision[] | "not_found"> {
    if (this.findMeal(userId, mealId) === null) return "not_found";
    return clone([...this.#contributionRevisions.entries()].filter(([id]) => this.#contributionMeals.get(id) === mealId).flatMap(([, values]) => values).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()));
  }

  public async getCoverageConfirmed(userId: string, localDate: string): Promise<boolean> { return this.#coverage.get(`${userId}:${localDate}`) ?? false; }
  public async setCoverageConfirmed(userId: string, localDate: string, confirmed: boolean): Promise<boolean> { this.#coverage.set(`${userId}:${localDate}`, confirmed); return confirmed; }

  public async listFoodTemplates(userId: string): Promise<readonly PersonalFoodTemplate[]> { return clone([...(this.#templates.get(userId) ?? [])].sort((a, b) => a.label.localeCompare(b.label, "zh-CN"))); }
  public async createFoodTemplate(userId: string, input: FoodTemplateInput): Promise<PersonalFoodTemplate> {
    const now = new Date(); const saved = { id: randomUUID(), ...input, revision: 1, createdAt: now, updatedAt: now };
    this.#templates.set(userId, [...(this.#templates.get(userId) ?? []), saved]); return clone(saved);
  }
  public async updateFoodTemplate(userId: string, templateId: string, expectedRevision: number, input: FoodTemplateInput): Promise<PersonalFoodTemplate | "not_found" | "revision_conflict"> {
    const values = this.#templates.get(userId) ?? []; const index = values.findIndex((value) => value.id === templateId);
    if (index < 0) return "not_found"; if (values[index]!.revision !== expectedRevision) return "revision_conflict";
    const saved = { ...values[index]!, ...input, revision: expectedRevision + 1, updatedAt: new Date() }; values[index] = saved; return clone(saved);
  }
  public async deleteFoodTemplate(userId: string, templateId: string, expectedRevision: number): Promise<"deleted" | "not_found" | "revision_conflict"> {
    const values = this.#templates.get(userId) ?? []; const index = values.findIndex((value) => value.id === templateId);
    if (index < 0) return "not_found"; if (values[index]!.revision !== expectedRevision) return "revision_conflict"; values.splice(index, 1); return "deleted";
  }

  private findMeal(userId: string, mealId: string) { const values = this.#meals.get(userId) ?? []; const index = values.findIndex((meal) => meal.id === mealId); return index < 0 ? null : { values, index, meal: values[index]! }; }
  private requiresReplacement(values: readonly MealContribution[], mode: MealContribution["mode"]) { return values.length > 0 && (mode === "whole_meal" || values.some((value) => value.mode === "whole_meal")); }
  private saveMealRevision(meal: Meal) { const values = this.#mealRevisions.get(meal.id) ?? []; values.push({ id: randomUUID(), mealId: meal.id, mealRevision: meal.revision, occurredAt: meal.occurredAt, localDate: meal.localDate, timeZone: meal.timeZone, name: meal.name, note: meal.note, createdAt: new Date() }); this.#mealRevisions.set(meal.id, values); }
  private saveContributionRevision(value: MealContribution) { const values = this.#contributionRevisions.get(value.id) ?? []; values.push({ id: randomUUID(), contributionId: value.id, contributionRevision: value.revision, mode: value.mode, source: value.source, reviewStatus: value.reviewStatus, sourceAnalysisId: value.sourceAnalysisId, label: value.label, portionAmount: value.portionAmount, portionUnit: value.portionUnit, basisDescription: value.basisDescription, energyKcal: value.energyKcal, proteinGrams: value.proteinGrams, carbohydrateGrams: value.carbohydrateGrams, fatGrams: value.fatGrams, createdAt: new Date() }); this.#contributionRevisions.set(value.id, values); }
}
