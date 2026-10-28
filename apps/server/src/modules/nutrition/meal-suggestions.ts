import type { FastifyInstance } from "fastify";

import type { IdentityService } from "../identity/service.js";
import { sessionCookieName } from "../identity/routes.js";
import { builtinFoods, catalogFoods, foodMatchesSearch, foodSnapshot, normalizeFoodSearch, scaleFood, type CatalogFood, type FoodDefinition } from "./food-catalog.js";
import type { NutritionService } from "./service.js";
import type { Meal, NutrientValues } from "./types.js";

export type MealSuggestionStyle = "all" | "rice" | "noodles" | "dumplings" | "breakfast";
export interface MealSuggestionPreferences {
  readonly style?: MealSuggestionStyle;
  readonly availableFoods?: readonly string[];
}
export interface MealSuggestionItem {
  readonly food: CatalogFood;
  readonly amount: number;
  readonly nutrients: NutrientValues;
  readonly energyFormula: string;
}
export interface MealSuggestion {
  readonly id: string;
  readonly title: string;
  readonly style: Exclude<MealSuggestionStyle, "all">;
  readonly searchTerms: readonly string[];
  readonly items: readonly MealSuggestionItem[];
  readonly nutrients: NutrientValues;
  readonly knownSubtotal: NutrientValues;
  readonly complete: Readonly<Record<keyof NutrientValues, boolean>>;
  readonly assumptions: readonly string[];
  readonly reason: string | null;
}
export interface MealSuggestionsResult {
  readonly method: "catalog-combinations-v1";
  readonly choices: readonly MealSuggestion[];
  readonly notice: string;
}

interface Recipe {
  id: string;
  title: string;
  style: Exclude<MealSuggestionStyle, "all">;
  searchTerms: readonly string[];
  parts: readonly { id: string; amount: number }[];
  primary: readonly string[];
  note?: string;
}

// Product reference combinations, not individual calorie prescriptions. The quantities
// remain editable in the intake draft; every nutrient comes from the exact catalog item.
const recipes: readonly Recipe[] = [
  { id: "chicken-rice", title: "鸡胸肉饭配西兰花", style: "rice", searchTerms: ["鸡胸肉饭", "轻食鸡胸饭"], primary: ["usda:171477"],
    parts: [{ id: "usda:168878", amount: 150 }, { id: "usda:171477", amount: 150 }, { id: "usda:169967", amount: 150 }] },
  { id: "egg-rice", title: "鸡蛋米饭配菠菜", style: "rice", searchTerms: ["水煮蛋", "米饭", "清烫菠菜"], primary: ["usda:173424"],
    parts: [{ id: "usda:168878", amount: 150 }, { id: "usda:173424", amount: 100 }, { id: "usda:168463", amount: 150 }] },
  { id: "beancurd-rice", title: "五香豆干饭配胡萝卜", style: "rice", searchTerms: ["五香豆干饭", "豆干便当"], primary: ["tfda:R4700202"],
    parts: [{ id: "usda:168878", amount: 150 }, { id: "tfda:R4700202", amount: 120 }, { id: "usda:170394", amount: 150 }],
    note: "豆干使用目录中的五香成品参考，不套用于普通嫩豆腐或油豆腐。" },
  { id: "minced-pork-noodles", title: "肉燥面配鸡蛋和西兰花", style: "noodles", searchTerms: ["担仔面", "肉燥面"], primary: ["tfda:R2100401"],
    parts: [{ id: "tfda:R2100401", amount: 250 }, { id: "usda:173424", amount: 50 }, { id: "usda:169967", amount: 150 }],
    note: "面条采用含肉燥、去汤的担仔面样品；清汤面、干面和不同肉酱不能直接套用。" },
  { id: "dumplings-spinach", title: "高丽菜水饺配菠菜", style: "dumplings", searchTerms: ["高丽菜水饺", "白菜水饺", "清烫菠菜"], primary: ["tfda:R2201501"],
    parts: [{ id: "tfda:R2201501", amount: 220 }, { id: "usda:168463", amount: 150 }],
    note: "水饺按目录熟重估算；目录没有每只重量，不能把这份克数直接说成固定个数。" },
  { id: "bun-soymilk-egg", title: "馒头豆浆配水煮蛋", style: "breakfast", searchTerms: ["馒头", "无糖豆浆", "水煮蛋"], primary: ["tfda:R2400201"],
    parts: [{ id: "tfda:R2400201", amount: 100 }, { id: "tfda:H1150201", amount: 200 }, { id: "usda:173424", amount: 50 }],
    note: "豆浆目录基准是克，不自动换成毫升；饮品配方以实际包装为准。" },
  { id: "bread-milk-apple", title: "全麦面包配牛奶和苹果", style: "breakfast", searchTerms: ["全麦面包", "纯牛奶", "苹果"], primary: ["usda:172688"],
    parts: [{ id: "usda:172688", amount: 80 }, { id: "usda:172217", amount: 250 }, { id: "usda:171688", amount: 150 }],
    note: "面包按包装净重、牛奶按目录克重、苹果按实际可食部分修改；不把片数或毫升无依据换成克。" },
  { id: "yogurt-bread-banana", title: "原味酸奶配面包和香蕉", style: "breakfast", searchTerms: ["原味酸奶", "全麦面包", "香蕉"], primary: ["usda:171284"],
    parts: [{ id: "usda:171284", amount: 200 }, { id: "usda:172688", amount: 60 }, { id: "usda:173944", amount: 100 }],
    note: "原味全脂酸奶参考不能代替干噎酸奶、奶油底或额外甜品配料。香蕉使用可食部分。" },
];

const keys = ["energyKcal", "proteinGrams", "carbohydrateGrams", "fatGrams"] as const;
const round = (value: number) => Math.round(value * 1000) / 1000;
function sumItems(items: readonly MealSuggestionItem[]) {
  const complete = Object.fromEntries(keys.map(key => [key, items.every(item => item.nutrients[key] !== null)])) as Record<keyof NutrientValues, boolean>;
  const knownSubtotal = Object.fromEntries(keys.map(key => {
    const values = items.flatMap(item => item.nutrients[key] === null ? [] : [item.nutrients[key]!]);
    return [key, values.length ? round(values.reduce((sum, value) => sum + value, 0)) : null];
  })) as unknown as NutrientValues;
  const nutrients = Object.fromEntries(keys.map(key => [key, complete[key] ? knownSubtotal[key] : null])) as unknown as NutrientValues;
  return { complete, knownSubtotal, nutrients };
}

/** Deterministic, local catalog calculation. Reads no model, credential or external service. */
export function deriveMealSuggestions(
  foods: readonly FoodDefinition[] = builtinFoods,
  recentMeals: readonly Pick<Meal, "contributions">[] = [],
  preferences: MealSuggestionPreferences = {},
): MealSuggestionsResult {
  const byId = new Map(foods.map(food => [food.id, food]));
  const recentIds = new Set(recentMeals.flatMap(meal => meal.contributions.flatMap(item => item.foodSnapshot ? [item.foodSnapshot.id] : [])));
  const recentLabels = new Set(recentMeals.flatMap(meal => meal.contributions.map(item => normalizeFoodSearch(item.label))));
  const available = [...new Set((preferences.availableFoods ?? []).map(normalizeFoodSearch).filter(value => value.length > 0))].slice(0, 8);
  const ranked = recipes.flatMap((recipe, index) => {
    const items: MealSuggestionItem[] = [];
    for (const part of recipe.parts) {
      const food = byId.get(part.id);
      // These reference quantities are grams. Never reinterpret them as raw weights,
      // item counts or millilitres when a caller supplies a different catalog basis.
      if (!food || food.basisUnit !== "g" || food.basisAmount === null || !Number.isFinite(food.basisAmount) || food.basisAmount <= 0) return [];
      const snapshot = foodSnapshot(food);
      const nutrients = scaleFood(snapshot, part.amount);
      items.push({ food: { ...snapshot, isFavorite: "isFavorite" in food && food.isFavorite === true }, amount: part.amount, nutrients,
        energyFormula: snapshot.energyKcal === null ? `${part.amount} g ÷ ${snapshot.basisAmount} g × 单位能量未知`
          : `${part.amount} g ÷ ${snapshot.basisAmount} g × ${snapshot.energyKcal} kcal = ${nutrients.energyKcal} kcal` });
    }
    const availableMatches = items.filter(item => available.some(value => foodMatchesSearch(item.food, value))).length;
    const recent = recipe.primary.filter(id => recentIds.has(id) || (byId.has(id) && recentLabels.has(normalizeFoodSearch(byId.get(id)!.label)))).length;
    const preferred = preferences.style !== undefined && preferences.style !== "all" && preferences.style === recipe.style;
    const score = Number(preferred) * 100 + availableMatches * 20 + items.filter(item => item.food.isFavorite).length * 2 - recent * 10;
    const choice: MealSuggestion = { id: recipe.id, title: recipe.title, style: recipe.style, searchTerms: [...recipe.searchTerms], items, ...sumItems(items),
      assumptions: ["以下份量是可修改的搭配参考，不是按你的身体资料生成的个性化处方。", "按所列食物的具体做法与来源计算；商家额外油、酱汁和不同配方需在实际记录时核对。", ...(recipe.note ? [recipe.note] : [])],
      reason: availableMatches > 0 ? "可优先用到你填写的已有食物" : recent > 0 ? "近期吃过相近主食或主菜，仍可再次选择" : null };
    return [{ choice, score, index }];
  }).sort((a, b) => b.score - a.score || a.index - b.index);

  // When no style is preferred, the first screen contains different kinds of meal.
  // This changes presentation order only; repeat meals remain selectable.
  const ordered = preferences.style && preferences.style !== "all" ? ranked : (() => {
    const first: typeof ranked = [], remainder: typeof ranked = [];
    const styles = new Set<string>();
    for (const entry of ranked) {
      if (first.length < 3 && !styles.has(entry.choice.style)) { first.push(entry); styles.add(entry.choice.style); }
      else remainder.push(entry);
    }
    return [...first, ...remainder];
  })();
  return { method: "catalog-combinations-v1", choices: ordered.map(entry => entry.choice),
    notice: "常见搭配与目录样品估算，实际供应和商家配方未核实。选入后仍需核对实际吃入量再保存。" };
}

export async function registerMealSuggestionRoutes(app: FastifyInstance, options: { identityService: IdentityService; nutritionService: NutritionService }): Promise<void> {
  app.post<{ Body: { localDate: string; style?: MealSuggestionStyle; availableFoods?: string[] } }>("/api/v1/nutrition/meal-suggestions", {
    schema: { body: { type: "object", additionalProperties: false, required: ["localDate"], properties: {
      localDate: { type: "string", format: "date" }, style: { type: "string", enum: ["all", "rice", "noodles", "dumplings", "breakfast"] },
      availableFoods: { type: "array", maxItems: 8, items: { type: "string", minLength: 1, maxLength: 40 } },
    } }, response: { 200: { type: "object", additionalProperties: true } } },
    handler: async request => {
      const owner = (await options.identityService.authenticate(request.cookies[sessionCookieName])).id;
      const date = new Date(`${request.body.localDate}T00:00:00.000Z`);
      date.setUTCDate(date.getUTCDate() - 6);
      const from = date.toISOString().slice(0, 10);
      const [templates, recent] = await Promise.all([
        options.nutritionService.listFoodTemplates(owner),
        options.nutritionService.listMeals(owner, from, request.body.localDate),
      ]);
      return deriveMealSuggestions(catalogFoods(templates), recent, request.body);
    },
  });
}
