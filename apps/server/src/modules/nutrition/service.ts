import { createHash, randomUUID } from "node:crypto";
import { catalogFoods, externalFoodVersion, foodCategories, foodSnapshot, personalFood, scaleFood, type FoodCategory, type FoodCatalogPage, type FoodDefinition } from "./food-catalog.js";

import type { ImageNutritionCandidate } from "../image-analysis/types.js";
import { imageFoodContributions } from "./image-foods.js";
import { NutritionError } from "./errors.js";
import { PublicFoodProviderError, type PublicFoodProvider } from "./public-food-provider.js";
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
  public imageReplacement(userId: string, analysisId: string) { return this.repository.imageReplacement(userId, analysisId); }
  public async replaceImageFoods(userId: string, mealId: string, analysisId: string, input: import("../image-analysis/replacement.js").ImageReplacementInput, candidate: ImageNutritionCandidate, undo: boolean) {
    const result = await this.repository.replaceImageFoods(userId, mealId, analysisId, input, imageFoodContributions(analysisId, candidate), undo);
    if (result === "not_found") throw new NutritionError("meal_not_found", "找不到这顿饭或识别结果", 404);
    if (result === "revision_conflict") throw new NutritionError("nutrition_revision_conflict", "餐食或识别结果已变化，请重新查看后操作；原内容未被覆盖", 409);
    if (result === "replacement_required") throw new NutritionError("nutrition_replacement_required", "请选择照片覆盖的原食物；整餐总量不能与新食物重复计入", 409);
    return result;
  }
  readonly #externalFoods = new Map<string, { food: FoodDefinition; expiresAt: number }>();
  public constructor(private readonly repository: NutritionRepository, private readonly publicFoodProvider: PublicFoodProvider | null = null) {}

  private externalFoods(): FoodDefinition[] {
    for (const [key, value] of this.#externalFoods) if (value.expiresAt <= Date.now()) this.#externalFoods.delete(key);
    return [...this.#externalFoods.values()].map((entry) => entry.food);
  }

  public async searchFoodCatalog(userId: string, query: string, category: FoodCategory | "all" = "all", cursor: string | null = null, limit = 25): Promise<FoodCatalogPage> {
    const local = await this.getFoodCatalog(userId, query, category, null, limit);
    if (query.trim().length < 2) return this.getFoodCatalog(userId, query, category, cursor, limit);
    let external: FoodDefinition[];
    try {
      external = (await this.searchPublicFoods(query)).map((result) => {
        const food: FoodDefinition = { id: result.id, version: "", label: result.brand ? `${result.label} · ${result.brand}` : result.label,
          category: "other", provider: "open_food_facts", sourceName: "Open Food Facts · 请核对包装标签", sourceUrl: result.sourceUrl,
          license: "ODbL-1.0 / DbCL-1.0", originalName: null, basisAmount: 100, basisUnit: "g",
          energyKcal: result.energyKcal, proteinGrams: result.proteinGrams, carbohydrateGrams: result.carbohydrateGrams, fatGrams: result.fatGrams };
        food.version = externalFoodVersion(food);
        this.#externalFoods.set(food.id, { food, expiresAt: Date.now() + 600_000 });
        return food;
      });
      this.externalFoods();
      while (this.#externalFoods.size > 1000) this.#externalFoods.delete(this.#externalFoods.keys().next().value!);
    } catch {
      const page = cursor ? await this.getFoodCatalog(userId, query, category, cursor, limit) : local;
      return { ...page, warning: "在线食物来源暂不可用；已有目录、已选内容和个人食物仍可使用。" };
    }
    return this.getFoodCatalog(userId, query, category, cursor, limit, external);
  }

  public async getFoodCatalog(userId: string, query = "", category: FoodCategory | "all" = "all", cursor: string | null = null, limit = 25, external: readonly FoodDefinition[] = []): Promise<FoodCatalogPage> {
    if (query.length > 100 || !Number.isInteger(limit) || limit < 1 || limit > 50 || (category !== "all" && !Object.hasOwn(foodCategories, category)))
      throw new NutritionError("invalid_nutrition_input", "食物查询条件无效", 400);
    const text = query.trim().toLocaleLowerCase("zh-CN");
    const foods = catalogFoods(await this.repository.listFoodTemplates(userId), external).filter((food) =>
      (category === "all" || category === food.category) && `${food.label} ${food.originalName ?? ""}`.toLocaleLowerCase("zh-CN").includes(text));
    const start = cursor === null ? 0 : foods.findIndex((food) => food.id === cursor) + 1;
    if (cursor !== null && start === 0) throw new NutritionError("food_catalog_changed", "列表已变化，请重新搜索；已选食物会保留", 409);
    const items = foods.slice(start, start + limit);
    return { items, total: foods.length, nextCursor: start + items.length < foods.length ? items.at(-1)!.id : null, categories: foodCategories, warning: null };
  }

  public async setFoodFavorite(userId: string, foodId: string, favorite: boolean): Promise<void> {
    const food = catalogFoods(await this.repository.listFoodTemplates(userId), this.externalFoods()).find((value) => value.id === foodId);
    if (!food) throw new NutritionError("food_not_found", "找不到这个食物", 404);
    const isPublic = food.provider === "usda_sr_legacy" || food.provider === "open_food_facts";
    const { category, provider, sourceName, sourceUrl, license, originalName } = food;
    await this.repository.setFoodFavorite(userId, foodId, favorite, isPublic ? {
      label: food.label, portionAmount: food.basisAmount, portionUnit: food.basisUnit, basisDescription: food.sourceName,
      energyKcal: food.energyKcal, proteinGrams: food.proteinGrams, carbohydrateGrams: food.carbohydrateGrams, fatGrams: food.fatGrams,
      catalogKey: food.id, catalogMetadata: { category, provider, sourceName, sourceUrl, license, originalName }, isFavorite: favorite,
    } : null);
  }

  public async createPersonalFood(userId: string, input: ContributionRequest & { category: FoodCategory; submissionId?: string }) {
    if (!Object.hasOwn(foodCategories, input.category) || input.portionAmount === null || input.portionAmount <= 0 || !input.portionUnit?.trim())
      throw new NutritionError("invalid_nutrition_input", "请填写食物分类与正数的基准份量和单位", 400);
    const validated = this.foodTemplateInput(input);
    const precision = (value: number | null) => value === null ? null : Math.round(value * 1000) / 1000;
    const definition: FoodTemplateInput = { ...validated, portionAmount: precision(validated.portionAmount),
      energyKcal: precision(validated.energyKcal), proteinGrams: precision(validated.proteinGrams),
      carbohydrateGrams: precision(validated.carbohydrateGrams), fatGrams: precision(validated.fatGrams), isFavorite: false,
      catalogMetadata: { category: input.category, provider: "personal", sourceName: "个人录入", sourceUrl: null, license: null, originalName: null } };
    if (definition.portionAmount === 0) throw new NutritionError("invalid_nutrition_input", "基准份量最小为0.001", 400);
    // Legacy clients without a submission ID retain their old contract.
    if (input.submissionId === undefined) return personalFood(await this.repository.createFoodTemplate(userId, definition));
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.submissionId))
      throw new NutritionError("invalid_nutrition_input", "保存编号无效", 400);
    const hash = createHash("sha256").update(JSON.stringify(["personal-food", userId, input.submissionId.toLowerCase()])).digest("hex");
    const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
    const saved = await this.repository.createPersonalFoodOnce(userId, id, definition);
    if (saved === "revision_conflict") throw new NutritionError("food_creation_conflict", "这次保存的内容已变化或食物已删除，请核对原记录；不会重复新建。", 409);
    return personalFood(saved);
  }

  public async favoriteMealFood(userId: string, mealId: string, contributionId: string): Promise<void> {
    const item = (await this.getMeal(userId, mealId)).contributions.find((value) => value.id === contributionId);
    if (!item) throw new NutritionError("contribution_not_found", "找不到这项食物", 404);
    if (item.foodSnapshot && catalogFoods(await this.repository.listFoodTemplates(userId)).some((food) => food.id === item.foodSnapshot!.id)) {
      await this.setFoodFavorite(userId, item.foodSnapshot.id, true);
      return;
    }
    const basis = item.foodSnapshot;
    const key = basis?.provider === "open_food_facts" && /^open_food_facts:\d+$/.test(basis.id) ? basis.id : `meal-food:${item.id}`;
    await this.repository.setFoodFavorite(userId, key, true, {
      label: item.label, portionAmount: basis?.basisAmount ?? item.portionAmount, portionUnit: basis?.basisUnit ?? item.portionUnit,
      basisDescription: basis?.sourceName ?? item.basisDescription,
      energyKcal: basis ? basis.energyKcal : item.energyKcal, proteinGrams: basis ? basis.proteinGrams : item.proteinGrams,
      carbohydrateGrams: basis ? basis.carbohydrateGrams : item.carbohydrateGrams, fatGrams: basis ? basis.fatGrams : item.fatGrams,
      catalogKey: key, isFavorite: true, catalogMetadata: basis ? { category: basis.category, provider: basis.provider, sourceName: basis.sourceName, sourceUrl: basis.sourceUrl, license: basis.license, originalName: basis.originalName }
        : { category: "other", provider: item.source === "model_adopted" ? "photo_estimate" : "personal", sourceName: item.source === "model_adopted" ? "照片估算（个人食物）" : "个人录入", sourceUrl: null, license: null, originalName: null },
    });
  }

  public async addFoodSelections(userId: string, mealId: string, mealRevision: number, submissionId: string, selections: readonly FoodSelection[]): Promise<Meal> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(submissionId) || selections.length < 1 || selections.length > 20
      || new Set(selections.map((s) => s.foodId)).size !== selections.length)
      throw new NutritionError("invalid_nutrition_input", "每次请选择1–20种不同食物", 400);
    // Verify ownership before resolving any private food references.
    await this.getMeal(userId, mealId);
    const catalog = catalogFoods(await this.repository.listFoodTemplates(userId), this.externalFoods());
    const inputs = selections.map((selection, index): ContributionInput & { id: string } => {
      const food = catalog.find((f) => f.id === selection.foodId);
      if (!food) throw new NutritionError("food_not_found", "所选食物已不可用；其他选择仍会保留", 404);
      if (food.version !== selection.version) throw new NutritionError("food_catalog_changed", "所选食物已修改，请重新选择该食物", 409);
      if (!Number.isFinite(selection.amount) || selection.amount <= 0 || selection.amount > 100000 || food.basisAmount === null || food.basisAmount <= 0 || food.basisUnit === null)
        throw new NutritionError("invalid_nutrition_input", "请填写有效份量；旧食物没有基准时需先补充个人食物", 400);
      const amount = Math.round(selection.amount * 1000) / 1000;
      if (amount <= 0) throw new NutritionError("invalid_nutrition_input", "份量最小为0.001", 400);
      const hash = createHash("sha256").update(JSON.stringify([userId, mealId, submissionId, index])).digest("hex");
      const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
      return { id, mode: "item", source: "manual", reviewStatus: "confirmed", sourceAnalysisId: null,
        label: food.label, portionAmount: amount, portionUnit: food.basisUnit, basisDescription: food.sourceName,
        foodSnapshot: foodSnapshot(food), ...this.nutrients(scaleFood(food, amount)) };
    });
    return this.unwrapMeal(await this.repository.addSelectedFoods(userId, mealId, mealRevision, inputs, submissionId));
  }

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

  public async ensureTentativeModelContribution(userId: string, mealId: string, analysisId: string, candidate: ImageNutritionCandidate): Promise<Meal> {
    const meal = await this.getMeal(userId, mealId);
    const result = await this.repository.addInitialModelContributions(userId, mealId, meal.revision, imageFoodContributions(analysisId, candidate));
    if (result === "revision_conflict") return this.getMeal(userId, mealId);
    return this.unwrapMeal(result);
  }

  public async changePortion(userId: string, mealId: string, contributionId: string, mealRevision: number, contributionRevision: number, amount: number): Promise<Meal> {
    nonnegative(amount, "份量", 100000);
    const meal = await this.getMeal(userId, mealId);
    const existing = meal.contributions.find((value) => value.id === contributionId);
    if (existing === undefined) throw new NutritionError("contribution_not_found", "找不到这项食物", 404);
    if (meal.revision !== mealRevision || existing.revision !== contributionRevision) this.revisionConflict();
    let basis: Pick<ContributionInput, "portionAmount" | "portionUnit" | keyof NutrientValues> = existing.foodSnapshot
      ? { ...existing.foodSnapshot, portionAmount: existing.foodSnapshot.basisAmount, portionUnit: existing.foodSnapshot.basisUnit } : existing;
    if (basis.portionAmount === null || basis.portionAmount <= 0) {
      const history = await this.listContributionRevisions(userId, mealId);
      const prior = history.filter((value) => value.contributionId === existing.id
        && value.label === existing.label && value.portionUnit === existing.portionUnit
        && value.portionAmount !== null && value.portionAmount > 0)
        .sort((left, right) => right.contributionRevision - left.contributionRevision)[0];
      if (prior !== undefined) basis = prior;
    }
    if (basis.portionAmount === null || basis.portionAmount <= 0 || basis.portionUnit === null) {
      throw new NutritionError("portion_basis_required", "这项食物缺少可换算的份量基准，请先补充份量和单位", 409);
    }
    const scale = (value: number | null) => value === null ? null : Math.round(value * amount / basis.portionAmount! * 1000) / 1000;
    const nutrients = this.nutrients({ energyKcal: scale(basis.energyKcal), proteinGrams: scale(basis.proteinGrams), carbohydrateGrams: scale(basis.carbohydrateGrams), fatGrams: scale(basis.fatGrams) });
    const input: ContributionInput = { mode: existing.mode, label: existing.label, source: existing.source,
      sourceAnalysisId: existing.sourceAnalysisId, reviewStatus: "confirmed", foodSnapshot: existing.foodSnapshot ?? null,
      portionAmount: amount, portionUnit: existing.portionUnit, basisDescription: existing.basisDescription, ...nutrients };
    return this.unwrapMeal(await this.repository.updateContribution(userId, mealId, contributionId, mealRevision, contributionRevision, input, false));
  }

  public async updateContribution(userId: string, mealId: string, contributionId: string, mealRevision: number, contributionRevision: number, input: ContributionRequest, replaceExisting: boolean): Promise<Meal> {
    const meal = await this.getMeal(userId, mealId);
    const existing = meal.contributions.find((value) => value.id === contributionId);
    // Preserve old clients' amount-only edits as well as the dedicated portion endpoint.
    if (existing !== undefined && !replaceExisting && input.portionAmount !== null
      && input.portionAmount !== existing.portionAmount && input.label === existing.label
      && input.portionUnit === existing.portionUnit && input.mode === existing.mode
      && input.energyKcal === existing.energyKcal && input.proteinGrams === existing.proteinGrams
      && input.carbohydrateGrams === existing.carbohydrateGrams && input.fatGrams === existing.fatGrams
      && input.basisDescription === existing.basisDescription) {
      return this.changePortion(userId, mealId, contributionId, mealRevision, contributionRevision, input.portionAmount);
    }
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

  public async listFoodTemplates(userId: string) { return (await this.repository.listFoodTemplates(userId)).filter((food) => food.isFavorite !== false); }

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

  public async searchPublicFoods(query: string) {
    const normalized = query.trim();
    if (normalized.length < 2) throw new NutritionError("invalid_nutrition_input", "至少输入 2 个字符再搜索公开食品", 400);
    if (normalized.length > 100) throw new NutritionError("invalid_nutrition_input", "搜索内容不能超过 100 个字符", 400);
    if (this.publicFoodProvider === null) throw new NutritionError("public_food_search_unavailable", "公开食品搜索当前未启用", 503);
    try {
      return await this.publicFoodProvider.search(normalized);
    } catch (error) {
      if (error instanceof PublicFoodProviderError && error.code === "rate_limited") {
        throw new NutritionError("public_food_search_rate_limited", "公开食品搜索较繁忙，请稍后再试；个人记录仍可使用", 429);
      }
      throw new NutritionError("public_food_search_unavailable", "公开食品搜索暂时不可用；个人记录和手工录入仍可使用", 503);
    }
  }

  public async createFoodTemplate(userId: string, input: ContributionRequest) { return this.repository.createFoodTemplate(userId, this.foodTemplateInput(input)); }
  public async updateFoodTemplate(userId: string, id: string, revision: number, input: ContributionRequest) {
    const previous = (await this.repository.listFoodTemplates(userId)).find((food) => food.id === id);
    const result = await this.repository.updateFoodTemplate(userId, id, revision, { ...this.foodTemplateInput(input), catalogKey: null,
      catalogMetadata: { category: previous?.catalogMetadata?.category ?? "other", provider: "personal", sourceName: "个人录入", sourceUrl: null, license: null, originalName: null } });
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
    if (input.mode !== "item" && Object.values(nutrients).every((value) => value === null)) throw new NutritionError("invalid_nutrition_input", "至少填写一项营养值；未知项可以留空", 400);
    const label = cleanText(input.label, 100);
    if (label === null) throw new NutritionError("invalid_nutrition_input", "请填写食物名称", 400);
    return { mode: input.mode, source: "manual", reviewStatus: "confirmed", sourceAnalysisId: null, foodSnapshot: null, label, portionAmount: nonnegative(input.portionAmount, "份量", 100000), portionUnit: cleanText(input.portionUnit, 30), basisDescription: cleanText(input.basisDescription, 200), ...nutrients };
  }

  private foodTemplateInput(input: ContributionRequest): FoodTemplateInput {
    const value = this.contributionInput({ ...input, mode: "item" });
    const { mode: _mode, source: _source, reviewStatus: _reviewStatus, sourceAnalysisId: _sourceAnalysisId, foodSnapshot: _snapshot, ...template } = value;
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

export interface FoodSelection { readonly foodId: string; readonly version: string; readonly amount: number; }
