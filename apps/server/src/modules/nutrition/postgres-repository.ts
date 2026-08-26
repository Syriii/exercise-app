import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";

import type { Database } from "../../db/database.js";
import {
  mealContributionRevisions,
  mealContributions,
  dietPlans,
  mealRevisions,
  meals,
  nutritionDayStates,
  personalFoodTemplates,
} from "../../db/schema/index.js";
import type { ContributionInput, DietPlanRepositoryInput, FoodTemplateInput, MealMetadataInput, NutritionRepository } from "./repository.js";
import type { DietPlan, Meal, MealContribution, MealContributionRevision, MealRevision, PersonalFoodTemplate } from "./types.js";

function numberValue(value: string | null): number | null { return value === null ? null : Number(value); }
function numericValues<T extends { portionAmount: number | null; energyKcal: number | null; proteinGrams: number | null; carbohydrateGrams: number | null; fatGrams: number | null }>(value: T) {
  return { ...value, portionAmount: value.portionAmount?.toString() ?? null, energyKcal: value.energyKcal?.toString() ?? null, proteinGrams: value.proteinGrams?.toString() ?? null, carbohydrateGrams: value.carbohydrateGrams?.toString() ?? null, fatGrams: value.fatGrams?.toString() ?? null };
}
function contributionFromRow(row: typeof mealContributions.$inferSelect): MealContribution {
  return { id: row.id, mealId: row.mealId, mode: row.mode, source: row.source, reviewStatus: row.reviewStatus, sourceAnalysisId: row.sourceAnalysisId, label: row.label, portionAmount: numberValue(row.portionAmount), portionUnit: row.portionUnit, basisDescription: row.basisDescription, energyKcal: numberValue(row.energyKcal), proteinGrams: numberValue(row.proteinGrams), carbohydrateGrams: numberValue(row.carbohydrateGrams), fatGrams: numberValue(row.fatGrams), revision: row.revision, createdAt: row.createdAt, updatedAt: row.updatedAt };
}
function templateFromRow(row: typeof personalFoodTemplates.$inferSelect): PersonalFoodTemplate {
  return { id: row.id, label: row.label, portionAmount: numberValue(row.portionAmount), portionUnit: row.portionUnit, basisDescription: row.basisDescription, energyKcal: numberValue(row.energyKcal), proteinGrams: numberValue(row.proteinGrams), carbohydrateGrams: numberValue(row.carbohydrateGrams), fatGrams: numberValue(row.fatGrams), revision: row.revision, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

export class PostgresNutritionRepository implements NutritionRepository {
  public constructor(private readonly database: Database) {}

  public async listDietPlans(userId: string, dateFrom: string, dateTo: string, includeArchived: boolean): Promise<readonly DietPlan[]> {
    const rows = await this.database.select().from(dietPlans).where(and(eq(dietPlans.userId, userId), lte(dietPlans.dateFrom, dateTo), gte(dietPlans.dateTo, dateFrom), ...(includeArchived ? [] : [isNull(dietPlans.archivedAt)]))).orderBy(desc(dietPlans.updatedAt));
    return rows;
  }

  public async createDietPlan(userId: string, input: DietPlanRepositoryInput): Promise<DietPlan> {
    const [saved] = await this.database.insert(dietPlans).values({ userId, ...input, entries: [...input.entries] }).returning();
    if (saved === undefined) throw new Error("created diet plan not returned");
    return saved;
  }

  public async updateDietPlan(userId: string, planId: string, expectedRevision: number, input: DietPlanRepositoryInput): Promise<DietPlan | "not_found" | "revision_conflict"> {
    const [existing] = await this.database.select({ revision: dietPlans.revision }).from(dietPlans).where(and(eq(dietPlans.id, planId), eq(dietPlans.userId, userId))).limit(1);
    if (existing === undefined) return "not_found"; if (existing.revision !== expectedRevision) return "revision_conflict";
    const [saved] = await this.database.update(dietPlans).set({ ...input, entries: [...input.entries], revision: sql`${dietPlans.revision} + 1`, updatedAt: new Date() }).where(and(eq(dietPlans.id, planId), eq(dietPlans.userId, userId), eq(dietPlans.revision, expectedRevision))).returning();
    return saved ?? "revision_conflict";
  }

  public async archiveDietPlan(userId: string, planId: string, expectedRevision: number, archivedAt: Date): Promise<DietPlan | "not_found" | "revision_conflict"> {
    const [existing] = await this.database.select({ revision: dietPlans.revision }).from(dietPlans).where(and(eq(dietPlans.id, planId), eq(dietPlans.userId, userId))).limit(1);
    if (existing === undefined) return "not_found"; if (existing.revision !== expectedRevision) return "revision_conflict";
    const [saved] = await this.database.update(dietPlans).set({ archivedAt, revision: sql`${dietPlans.revision} + 1`, updatedAt: new Date() }).where(and(eq(dietPlans.id, planId), eq(dietPlans.userId, userId), eq(dietPlans.revision, expectedRevision))).returning();
    return saved ?? "revision_conflict";
  }

  public async listMeals(userId: string, from: string, to: string): Promise<readonly Meal[]> {
    const rows = await this.database.select().from(meals).where(and(eq(meals.userId, userId), isNull(meals.deletedAt), gte(meals.localDate, from), lte(meals.localDate, to))).orderBy(desc(meals.occurredAt));
    return this.withContributions(rows);
  }

  public async getMeal(userId: string, mealId: string): Promise<Meal | null> {
    const [row] = await this.database.select().from(meals).where(and(eq(meals.id, mealId), eq(meals.userId, userId), isNull(meals.deletedAt))).limit(1);
    if (row === undefined) return null;
    return (await this.withContributions([row]))[0] ?? null;
  }

  public async createMeal(userId: string, input: MealMetadataInput): Promise<Meal> {
    const [row] = await this.database.insert(meals).values({ userId, ...input }).returning();
    if (row === undefined) throw new Error("created meal not returned");
    return this.mealFromRow(row, []);
  }

  public async updateMeal(userId: string, mealId: string, expectedRevision: number, input: MealMetadataInput): Promise<Meal | "not_found" | "revision_conflict"> {
    const result = await this.database.transaction(async (transaction) => {
      const [existing] = await transaction.select().from(meals).where(and(eq(meals.id, mealId), eq(meals.userId, userId), isNull(meals.deletedAt))).for("update").limit(1);
      if (existing === undefined) return "not_found" as const;
      if (existing.revision !== expectedRevision) return "revision_conflict" as const;
      await transaction.insert(mealRevisions).values({ mealId, mealRevision: existing.revision, occurredAt: existing.occurredAt, localDate: existing.localDate, timeZone: existing.timeZone, name: existing.name, note: existing.note });
      const [saved] = await transaction.update(meals).set({ ...input, revision: sql`${meals.revision} + 1`, updatedAt: new Date() }).where(and(eq(meals.id, mealId), eq(meals.revision, expectedRevision))).returning();
      return saved === undefined ? "revision_conflict" as const : "saved" as const;
    });
    if (result !== "saved") return result;
    const saved = await this.getMeal(userId, mealId);
    if (saved === null) throw new Error("saved meal not found");
    return saved;
  }

  public async deleteMeal(userId: string, mealId: string, expectedRevision: number): Promise<"deleted" | "not_found" | "revision_conflict"> {
    const [existing] = await this.database.select({ revision: meals.revision }).from(meals).where(and(eq(meals.id, mealId), eq(meals.userId, userId), isNull(meals.deletedAt))).limit(1);
    if (existing === undefined) return "not_found";
    if (existing.revision !== expectedRevision) return "revision_conflict";
    const [saved] = await this.database.update(meals).set({ deletedAt: new Date(), revision: sql`${meals.revision} + 1`, updatedAt: new Date() }).where(and(eq(meals.id, mealId), eq(meals.userId, userId), eq(meals.revision, expectedRevision), isNull(meals.deletedAt))).returning({ id: meals.id });
    return saved === undefined ? "revision_conflict" : "deleted";
  }

  public async listMealRevisions(userId: string, mealId: string): Promise<readonly MealRevision[] | "not_found"> {
    if (!(await this.ownsMeal(userId, mealId))) return "not_found";
    return this.database.select().from(mealRevisions).where(eq(mealRevisions.mealId, mealId)).orderBy(desc(mealRevisions.createdAt));
  }

  public async addContribution(userId: string, mealId: string, expectedMealRevision: number, input: ContributionInput, replaceExisting: boolean): Promise<Meal | "not_found" | "revision_conflict" | "replacement_required"> {
    const result = await this.database.transaction(async (transaction) => {
      const [meal] = await transaction.select().from(meals).where(and(eq(meals.id, mealId), eq(meals.userId, userId), isNull(meals.deletedAt))).for("update").limit(1);
      if (meal === undefined) return "not_found" as const;
      if (meal.revision !== expectedMealRevision) return "revision_conflict" as const;
      const active = await transaction.select().from(mealContributions).where(and(eq(mealContributions.mealId, mealId), isNull(mealContributions.supersededAt))).for("update");
      if (this.requiresReplacement(active, input.mode) && !replaceExisting) return "replacement_required" as const;
      if (replaceExisting && active.length > 0) {
        await transaction.insert(mealContributionRevisions).values(active.map((value) => ({ contributionId: value.id, contributionRevision: value.revision, mode: value.mode, source: value.source, reviewStatus: value.reviewStatus, sourceAnalysisId: value.sourceAnalysisId, label: value.label, portionAmount: value.portionAmount, portionUnit: value.portionUnit, basisDescription: value.basisDescription, energyKcal: value.energyKcal, proteinGrams: value.proteinGrams, carbohydrateGrams: value.carbohydrateGrams, fatGrams: value.fatGrams })));
        await transaction.update(mealContributions).set({ supersededAt: new Date(), updatedAt: new Date() }).where(and(eq(mealContributions.mealId, mealId), isNull(mealContributions.supersededAt)));
      }
      await transaction.insert(mealContributions).values({ mealId, ...numericValues(input) });
      await transaction.update(meals).set({ revision: sql`${meals.revision} + 1`, updatedAt: new Date() }).where(and(eq(meals.id, mealId), eq(meals.revision, expectedMealRevision)));
      return "saved" as const;
    });
    if (result !== "saved") return result;
    const saved = await this.getMeal(userId, mealId); if (saved === null) throw new Error("saved meal not found"); return saved;
  }

  public async updateContribution(userId: string, mealId: string, contributionId: string, expectedMealRevision: number, expectedContributionRevision: number, input: ContributionInput, replaceExisting: boolean): Promise<Meal | "not_found" | "contribution_not_found" | "revision_conflict" | "replacement_required"> {
    const result = await this.database.transaction(async (transaction) => {
      const [meal] = await transaction.select().from(meals).where(and(eq(meals.id, mealId), eq(meals.userId, userId), isNull(meals.deletedAt))).for("update").limit(1);
      if (meal === undefined) return "not_found" as const;
      if (meal.revision !== expectedMealRevision) return "revision_conflict" as const;
      const [existing] = await transaction.select().from(mealContributions).where(and(eq(mealContributions.id, contributionId), eq(mealContributions.mealId, mealId), isNull(mealContributions.supersededAt))).for("update").limit(1);
      if (existing === undefined) return "contribution_not_found" as const;
      if (existing.revision !== expectedContributionRevision) return "revision_conflict" as const;
      const others = await transaction.select().from(mealContributions).where(and(eq(mealContributions.mealId, mealId), ne(mealContributions.id, contributionId), isNull(mealContributions.supersededAt))).for("update");
      if (this.requiresReplacement(others, input.mode) && !replaceExisting) return "replacement_required" as const;
      await transaction.insert(mealContributionRevisions).values({ contributionId, contributionRevision: existing.revision, mode: existing.mode, source: existing.source, reviewStatus: existing.reviewStatus, sourceAnalysisId: existing.sourceAnalysisId, label: existing.label, portionAmount: existing.portionAmount, portionUnit: existing.portionUnit, basisDescription: existing.basisDescription, energyKcal: existing.energyKcal, proteinGrams: existing.proteinGrams, carbohydrateGrams: existing.carbohydrateGrams, fatGrams: existing.fatGrams });
      if (replaceExisting && others.length > 0) {
        await transaction.insert(mealContributionRevisions).values(others.map((value) => ({ contributionId: value.id, contributionRevision: value.revision, mode: value.mode, source: value.source, reviewStatus: value.reviewStatus, sourceAnalysisId: value.sourceAnalysisId, label: value.label, portionAmount: value.portionAmount, portionUnit: value.portionUnit, basisDescription: value.basisDescription, energyKcal: value.energyKcal, proteinGrams: value.proteinGrams, carbohydrateGrams: value.carbohydrateGrams, fatGrams: value.fatGrams })));
        await transaction.update(mealContributions).set({ supersededAt: new Date(), updatedAt: new Date() }).where(and(eq(mealContributions.mealId, mealId), ne(mealContributions.id, contributionId), isNull(mealContributions.supersededAt)));
      }
      await transaction.update(mealContributions).set({ ...numericValues(input), revision: sql`${mealContributions.revision} + 1`, updatedAt: new Date() }).where(and(eq(mealContributions.id, contributionId), eq(mealContributions.revision, expectedContributionRevision)));
      await transaction.update(meals).set({ revision: sql`${meals.revision} + 1`, updatedAt: new Date() }).where(and(eq(meals.id, mealId), eq(meals.revision, expectedMealRevision)));
      return "saved" as const;
    });
    if (result !== "saved") return result;
    const saved = await this.getMeal(userId, mealId); if (saved === null) throw new Error("saved meal not found"); return saved;
  }

  public async deleteContribution(userId: string, mealId: string, contributionId: string, expectedMealRevision: number, expectedContributionRevision: number): Promise<Meal | "not_found" | "contribution_not_found" | "revision_conflict"> {
    const result = await this.database.transaction(async (transaction) => {
      const [meal] = await transaction.select().from(meals).where(and(eq(meals.id, mealId), eq(meals.userId, userId), isNull(meals.deletedAt))).for("update").limit(1);
      if (meal === undefined) return "not_found" as const; if (meal.revision !== expectedMealRevision) return "revision_conflict" as const;
      const [existing] = await transaction.select().from(mealContributions).where(and(eq(mealContributions.id, contributionId), eq(mealContributions.mealId, mealId), isNull(mealContributions.supersededAt))).for("update").limit(1);
      if (existing === undefined) return "contribution_not_found" as const; if (existing.revision !== expectedContributionRevision) return "revision_conflict" as const;
      await transaction.insert(mealContributionRevisions).values({ contributionId, contributionRevision: existing.revision, mode: existing.mode, source: existing.source, reviewStatus: existing.reviewStatus, sourceAnalysisId: existing.sourceAnalysisId, label: existing.label, portionAmount: existing.portionAmount, portionUnit: existing.portionUnit, basisDescription: existing.basisDescription, energyKcal: existing.energyKcal, proteinGrams: existing.proteinGrams, carbohydrateGrams: existing.carbohydrateGrams, fatGrams: existing.fatGrams });
      await transaction.update(mealContributions).set({ supersededAt: new Date(), updatedAt: new Date() }).where(eq(mealContributions.id, contributionId));
      await transaction.update(meals).set({ revision: sql`${meals.revision} + 1`, updatedAt: new Date() }).where(and(eq(meals.id, mealId), eq(meals.revision, expectedMealRevision)));
      return "saved" as const;
    });
    if (result !== "saved") return result;
    const saved = await this.getMeal(userId, mealId); if (saved === null) throw new Error("saved meal not found"); return saved;
  }

  public async listContributionRevisions(userId: string, mealId: string): Promise<readonly MealContributionRevision[] | "not_found"> {
    if (!(await this.ownsMeal(userId, mealId))) return "not_found";
    const rows = await this.database.select({ revision: mealContributionRevisions }).from(mealContributionRevisions).innerJoin(mealContributions, eq(mealContributionRevisions.contributionId, mealContributions.id)).where(eq(mealContributions.mealId, mealId)).orderBy(desc(mealContributionRevisions.createdAt));
    return rows.map(({ revision: row }) => ({ id: row.id, contributionId: row.contributionId, contributionRevision: row.contributionRevision, mode: row.mode, source: row.source, reviewStatus: row.reviewStatus, sourceAnalysisId: row.sourceAnalysisId, label: row.label, portionAmount: numberValue(row.portionAmount), portionUnit: row.portionUnit, basisDescription: row.basisDescription, energyKcal: numberValue(row.energyKcal), proteinGrams: numberValue(row.proteinGrams), carbohydrateGrams: numberValue(row.carbohydrateGrams), fatGrams: numberValue(row.fatGrams), createdAt: row.createdAt }));
  }

  public async getCoverageConfirmed(userId: string, localDate: string): Promise<boolean> { const [row] = await this.database.select({ value: nutritionDayStates.coverageConfirmed }).from(nutritionDayStates).where(and(eq(nutritionDayStates.userId, userId), eq(nutritionDayStates.localDate, localDate))).limit(1); return row?.value ?? false; }
  public async setCoverageConfirmed(userId: string, localDate: string, confirmed: boolean): Promise<boolean> { await this.database.insert(nutritionDayStates).values({ userId, localDate, coverageConfirmed: confirmed }).onConflictDoUpdate({ target: [nutritionDayStates.userId, nutritionDayStates.localDate], set: { coverageConfirmed: confirmed, updatedAt: new Date() } }); return confirmed; }

  public async listFoodTemplates(userId: string): Promise<readonly PersonalFoodTemplate[]> { return (await this.database.select().from(personalFoodTemplates).where(and(eq(personalFoodTemplates.userId, userId), isNull(personalFoodTemplates.deletedAt))).orderBy(asc(personalFoodTemplates.label))).map(templateFromRow); }
  public async createFoodTemplate(userId: string, input: FoodTemplateInput): Promise<PersonalFoodTemplate> { const [row] = await this.database.insert(personalFoodTemplates).values({ userId, ...numericValues(input) }).returning(); if (row === undefined) throw new Error("created food template not returned"); return templateFromRow(row); }
  public async updateFoodTemplate(userId: string, id: string, revision: number, input: FoodTemplateInput): Promise<PersonalFoodTemplate | "not_found" | "revision_conflict"> { const [existing] = await this.database.select().from(personalFoodTemplates).where(and(eq(personalFoodTemplates.id, id), eq(personalFoodTemplates.userId, userId), isNull(personalFoodTemplates.deletedAt))).limit(1); if (existing === undefined) return "not_found"; if (existing.revision !== revision) return "revision_conflict"; const [saved] = await this.database.update(personalFoodTemplates).set({ ...numericValues(input), revision: sql`${personalFoodTemplates.revision} + 1`, updatedAt: new Date() }).where(and(eq(personalFoodTemplates.id, id), eq(personalFoodTemplates.revision, revision))).returning(); return saved === undefined ? "revision_conflict" : templateFromRow(saved); }
  public async deleteFoodTemplate(userId: string, id: string, revision: number): Promise<"deleted" | "not_found" | "revision_conflict"> { const [existing] = await this.database.select().from(personalFoodTemplates).where(and(eq(personalFoodTemplates.id, id), eq(personalFoodTemplates.userId, userId), isNull(personalFoodTemplates.deletedAt))).limit(1); if (existing === undefined) return "not_found"; if (existing.revision !== revision) return "revision_conflict"; const [saved] = await this.database.update(personalFoodTemplates).set({ deletedAt: new Date(), revision: sql`${personalFoodTemplates.revision} + 1`, updatedAt: new Date() }).where(and(eq(personalFoodTemplates.id, id), eq(personalFoodTemplates.revision, revision))).returning({ id: personalFoodTemplates.id }); return saved === undefined ? "revision_conflict" : "deleted"; }

  private mealFromRow(row: typeof meals.$inferSelect, contributions: readonly MealContribution[]): Meal { return { id: row.id, occurredAt: row.occurredAt, localDate: row.localDate, timeZone: row.timeZone, name: row.name, note: row.note, revision: row.revision, contributions, createdAt: row.createdAt, updatedAt: row.updatedAt }; }
  private async withContributions(rows: readonly (typeof meals.$inferSelect)[]): Promise<Meal[]> { if (rows.length === 0) return []; const ids = rows.map((row) => row.id); const values = await this.database.select().from(mealContributions).where(and(inArray(mealContributions.mealId, ids), isNull(mealContributions.supersededAt))).orderBy(asc(mealContributions.createdAt)); const grouped = new Map<string, MealContribution[]>(); for (const value of values) grouped.set(value.mealId, [...(grouped.get(value.mealId) ?? []), contributionFromRow(value)]); return rows.map((row) => this.mealFromRow(row, grouped.get(row.id) ?? [])); }
  private async ownsMeal(userId: string, mealId: string): Promise<boolean> { const [row] = await this.database.select({ id: meals.id }).from(meals).where(and(eq(meals.id, mealId), eq(meals.userId, userId), isNull(meals.deletedAt))).limit(1); return row !== undefined; }
  private requiresReplacement(values: readonly { mode: string }[], mode: string) { return values.length > 0 && (mode === "whole_meal" || values.some((value) => value.mode === "whole_meal")); }
}
