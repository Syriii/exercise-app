import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Database } from "../../db/database.js";
import { mealContributions, mealContributionRevisions, mealImageAnalyses, meals } from "../../db/schema/index.js";
import { sameReplacement, startsNewReplacement, type ImageReplacementInput } from "../image-analysis/replacement.js";
import type { ImageNutritionCandidate } from "../image-analysis/types.js";
import { imageFoodContributions } from "./image-foods.js";
import type { ContributionInput } from "./repository.js";
import type { MealContribution } from "./types.js";

function values(item: ContributionInput) {
  return { mode: item.mode, source: item.source, reviewStatus: item.reviewStatus, sourceAnalysisId: item.sourceAnalysisId,
    foodSnapshot: item.foodSnapshot ?? null, label: item.label, portionAmount: item.portionAmount?.toString() ?? null,
    portionUnit: item.portionUnit, basisDescription: item.basisDescription, energyKcal: item.energyKcal?.toString() ?? null,
    proteinGrams: item.proteinGrams?.toString() ?? null, carbohydrateGrams: item.carbohydrateGrams?.toString() ?? null,
    fatGrams: item.fatGrams?.toString() ?? null };
}
function snapshot(row: typeof mealContributions.$inferSelect): MealContribution {
  const number = (value: string | null) => value === null ? null : Number(value);
  return { ...row, portionAmount: number(row.portionAmount), energyKcal: number(row.energyKcal), proteinGrams: number(row.proteinGrams), carbohydrateGrams: number(row.carbohydrateGrams), fatGrams: number(row.fatGrams) };
}

/** The displayed meal revision binds the replacement scope across preview and commit. */
export async function replaceImageFoods(database: Database, userId: string, mealId: string, analysisId: string, input: ImageReplacementInput, undo: boolean) {
  return database.transaction(async tx => {
    const [analysis] = await tx.select().from(mealImageAnalyses).where(and(eq(mealImageAnalyses.id, analysisId), eq(mealImageAnalyses.userId, userId), eq(mealImageAnalyses.mealId, mealId))).for("update");
    const [meal] = await tx.select().from(meals).where(and(eq(meals.id, mealId), eq(meals.userId, userId), isNull(meals.deletedAt))).for("update");
    if (!analysis || !meal) return "not_found" as const;
    const state = analysis.replacementState;
    const fresh = startsNewReplacement(state, input, undo);
    if (state && !fresh && (!sameReplacement(state, input) || state.mealRevision !== meal.revision)) return "revision_conflict" as const;
    if (state && !fresh && state.undone === undo) return "saved" as const;
    if (meal.revision !== input.mealRevision || (!state && undo) || (state && !undo && !fresh) || analysis.revision !== input.analysisRevision || analysis.status !== "succeeded") return "revision_conflict" as const;
    const active = await tx.select().from(mealContributions).where(and(eq(mealContributions.mealId, mealId), isNull(mealContributions.supersededAt))).for("update");
    const now = new Date();
    const audit = async (rows: typeof active) => {
      if (rows.length) await tx.insert(mealContributionRevisions).values(rows.map(row => ({ ...values(snapshot(row)), contributionId: row.id, contributionRevision: row.revision })));
    };
    if (undo && state) {
      await audit(active);
      await tx.update(mealContributions).set({ supersededAt: now, revision: sql`${mealContributions.revision} + 1`, updatedAt: now }).where(and(eq(mealContributions.mealId, mealId), isNull(mealContributions.supersededAt)));
      for (const item of state.before) await tx.update(mealContributions).set({ ...values(item), supersededAt: null, revision: sql`${mealContributions.revision} + 1`, updatedAt: now }).where(and(eq(mealContributions.id, item.id), eq(mealContributions.mealId, mealId)));
      await tx.update(mealImageAnalyses).set({ replacementState: { ...state, undone: true, mealRevision: meal.revision + 1 }, revision: analysis.revision + 1, updatedAt: now }).where(eq(mealImageAnalyses.id, analysisId));
    } else {
      const candidate = analysis.rawCandidate as unknown as ImageNutritionCandidate | null;
      if (!candidate?.foods?.length) return "revision_conflict" as const;
      const replaced = new Set(input.replaceIds);
      if (replaced.size !== input.replaceIds.length || input.replaceIds.some(id => !active.some(item => item.id === id))) return "revision_conflict" as const;
      const kept = active.filter(item => !replaced.has(item.id));
      if (kept.some(item => item.mode === "whole_meal" || item.sourceAnalysisId === analysisId)) return "replacement_required" as const;
      const removed = active.filter(item => replaced.has(item.id));
      await audit(removed);
      if (removed.length) await tx.update(mealContributions).set({ supersededAt: now, revision: sql`${mealContributions.revision} + 1`, updatedAt: now }).where(inArray(mealContributions.id, removed.map(item => item.id)));
      const addedIds: string[] = [];
      for (const [sourceItemIndex, item] of imageFoodContributions(analysisId, candidate).entries()) {
        const [existing] = await tx.select().from(mealContributions).where(and(eq(mealContributions.sourceAnalysisId, analysisId), eq(mealContributions.sourceItemIndex, sourceItemIndex))).for("update");
        if (existing) {
          if (!removed.some(row => row.id === existing.id)) await audit([existing]);
          await tx.update(mealContributions).set({ ...values(item), supersededAt: null, revision: sql`${mealContributions.revision} + 1`, updatedAt: now }).where(eq(mealContributions.id, existing.id));
          addedIds.push(existing.id);
        } else {
          const [added] = await tx.insert(mealContributions).values({ mealId, ...values(item), sourceItemIndex }).returning({ id: mealContributions.id });
          addedIds.push(added!.id);
        }
      }
      await tx.update(mealImageAnalyses).set({ replacementState: { operationId: input.operationId, previousOperationIds: state ? [...(state.previousOperationIds ?? []), state.operationId] : [], mealRevision: meal.revision + 1, undone: false, replaceIds: input.replaceIds, before: active.map(snapshot), addedIds }, adoptedAt: now, revision: analysis.revision + 1, updatedAt: now }).where(eq(mealImageAnalyses.id, analysisId));
    }
    await tx.update(meals).set({ revision: meal.revision + 1, updatedAt: now }).where(eq(meals.id, mealId));
    return "saved" as const;
  });
}
