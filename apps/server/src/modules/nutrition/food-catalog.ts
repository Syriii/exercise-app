import type { NutrientValues, PersonalFoodTemplate } from "./types.js";
import { createHash } from "node:crypto";
import { usdaFoods } from "./usda-foods.generated.js";

export const foodCategories = {
  grains: "谷薯主食", vegetables: "蔬菜", fruit: "水果", meat_eggs: "肉鱼蛋",
  dairy: "奶及奶制品", beans: "豆及豆制品", fats: "坚果及油脂", other: "其他食物",
} as const;
export type FoodCategory = keyof typeof foodCategories;
export interface FoodProvenance {
  category: FoodCategory;
  provider: "usda_sr_legacy" | "open_food_facts" | "personal" | "photo_estimate";
  sourceName: string;
  sourceUrl: string | null;
  license: string | null;
  originalName: string | null;
}
export interface FoodDefinition extends NutrientValues, FoodProvenance {
  id: string;
  version: string;
  label: string;
  basisAmount: number | null;
  basisUnit: string | null;
}
export interface CatalogFood extends FoodDefinition { isFavorite: boolean; }
export interface FoodCatalogPage {
  items: CatalogFood[];
  nextCursor: string | null;
  total: number;
  categories: typeof foodCategories;
  warning: string | null;
}
export const builtinFoods: readonly FoodDefinition[] = usdaFoods.map(({ fdcId, ...food }) => ({
  ...food, id: `usda:${fdcId}`, version: "SR-Legacy-2018-04", basisAmount: 100, basisUnit: "g",
  provider: "usda_sr_legacy", sourceName: "USDA FoodData Central · SR Legacy 2018",
  sourceUrl: `https://fdc.nal.usda.gov/food-details/${fdcId}/nutrients`, license: "CC0-1.0",
}));

export function personalFood(food: PersonalFoodTemplate): CatalogFood {
  const result: CatalogFood = {
    id: food.catalogKey ?? `personal:${food.id}`, version: `personal-${food.revision}`,
    label: food.label, basisAmount: food.portionAmount, basisUnit: food.portionUnit,
    energyKcal: food.energyKcal, proteinGrams: food.proteinGrams,
    carbohydrateGrams: food.carbohydrateGrams, fatGrams: food.fatGrams,
    isFavorite: food.isFavorite ?? true,
    ...(food.catalogMetadata ?? { category: "other", provider: "personal", sourceName: food.basisDescription ?? "个人录入", sourceUrl: null, license: null, originalName: null }),
  };
  if (result.provider === "open_food_facts") result.version = externalFoodVersion(result);
  return result;
}

export function externalFoodVersion(food: FoodDefinition): string {
  return createHash("sha256").update(JSON.stringify([food.id, food.label, food.category, food.basisAmount, food.basisUnit,
    food.energyKcal, food.proteinGrams, food.carbohydrateGrams, food.fatGrams])).digest("hex").slice(0, 20);
}

export function catalogFoods(templates: readonly PersonalFoodTemplate[], external: readonly FoodDefinition[] = []): CatalogFood[] {
  const foods = new Map<string, CatalogFood>([...builtinFoods, ...external].map((food) => [food.id, { ...food, isFavorite: false }]));
  for (const template of templates) {
    const food = personalFood(template);
    // A favorite is a preference, not an override of the versioned public reference.
    foods.set(food.id, { ...(foods.get(food.id) ?? food), isFavorite: food.isFavorite });
  }
  return [...foods.values()].sort((a, b) => Number(b.isFavorite) - Number(a.isFavorite)
    || a.label.localeCompare(b.label, "zh-CN") || a.id.localeCompare(b.id));
}

export function foodSnapshot(food: FoodDefinition): FoodDefinition {
  const { id, version, label, basisAmount, basisUnit, category, provider, sourceName, sourceUrl,
    license, originalName, energyKcal, proteinGrams, carbohydrateGrams, fatGrams } = food;
  return { id, version, label, basisAmount, basisUnit, category, provider, sourceName, sourceUrl,
    license, originalName, energyKcal, proteinGrams, carbohydrateGrams, fatGrams };
}

export function scaleFood(food: FoodDefinition, amount: number): NutrientValues {
  const factor = food.basisAmount !== null && food.basisAmount > 0 ? amount / food.basisAmount : null;
  const scale = (value: number | null) => value === null || factor === null ? null : Math.round(value * factor * 1000) / 1000;
  return { energyKcal: scale(food.energyKcal), proteinGrams: scale(food.proteinGrams),
    carbohydrateGrams: scale(food.carbohydrateGrams), fatGrams: scale(food.fatGrams) };
}
