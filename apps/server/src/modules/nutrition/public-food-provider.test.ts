import { describe, expect, it, vi } from "vitest";

import { OpenFoodFactsPublicFoodProvider, PublicFoodProviderError } from "./public-food-provider.js";

describe("OpenFoodFactsPublicFoodProvider", () => {
  it("requests explicit Chinese search fields and keeps only usable per-100g nutrition", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("q")).toBe("豆浆");
      expect(url.searchParams.getAll("langs")).toEqual(["zh", "en"]);
      expect(url.searchParams.get("page_size")).toBe("8");
      expect((init?.headers as Record<string, string>)["user-agent"]).toContain("ExerciseApp");
      return new Response(JSON.stringify({ hits: [
        { code: "6907992515960", product_name: "原浆豆奶", brands: ["示例品牌"], nutriments: { "energy-kcal_100g": 62, proteins_100g: 6, carbohydrates_100g: 1.5, fat_100g: 3.5999999 } },
        { code: "missing", product_name: "没有营养数据" },
        { code: "6907992515960", product_name: "重复条码", nutriments: { "energy-kcal_100g": 10 } },
      ] }), { status: 200 });
    });
    const provider = new OpenFoodFactsPublicFoodProvider({ baseUrl: "https://search.openfoodfacts.org/search", timeoutMs: 1_000, cacheTtlMs: 60_000, fetcher });

    await expect(provider.search(" 豆浆 ")).resolves.toEqual([expect.objectContaining({
      id: "open_food_facts:6907992515960",
      label: "原浆豆奶",
      brand: "示例品牌",
      basisAmount: 100,
      energyKcal: 62,
      fatGrams: 3.6,
    })]);
    await provider.search("豆浆");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("classifies upstream rate limits and malformed responses", async () => {
    const limited = new OpenFoodFactsPublicFoodProvider({ baseUrl: "https://example.test/search", timeoutMs: 1_000, cacheTtlMs: 1_000, fetcher: vi.fn(async () => new Response("", { status: 429 })) });
    await expect(limited.search("鸡蛋")).rejects.toMatchObject({ code: "rate_limited" } satisfies Partial<PublicFoodProviderError>);
    const malformed = new OpenFoodFactsPublicFoodProvider({ baseUrl: "https://example.test/search", timeoutMs: 1_000, cacheTtlMs: 1_000, fetcher: vi.fn(async () => new Response(JSON.stringify({ products: [] }), { status: 200 })) });
    await expect(malformed.search("鸡蛋")).rejects.toMatchObject({ code: "invalid_response" } satisfies Partial<PublicFoodProviderError>);
  });
});
