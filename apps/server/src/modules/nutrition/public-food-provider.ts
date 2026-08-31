export interface PublicFoodSearchResult {
  readonly id: string;
  readonly provider: "open_food_facts";
  readonly label: string;
  readonly brand: string | null;
  readonly barcode: string;
  readonly basisAmount: 100;
  readonly basisUnit: "g";
  readonly energyKcal: number | null;
  readonly proteinGrams: number | null;
  readonly carbohydrateGrams: number | null;
  readonly fatGrams: number | null;
  readonly sourceUrl: string;
}

export interface PublicFoodProvider {
  search(query: string): Promise<readonly PublicFoodSearchResult[]>;
}

export type PublicFoodProviderErrorCode = "rate_limited" | "timeout" | "unavailable" | "invalid_response";

export class PublicFoodProviderError extends Error {
  public constructor(public readonly code: PublicFoodProviderErrorCode) {
    super(`public_food_provider_${code}`);
  }
}

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface OpenFoodFactsHit {
  readonly code?: unknown;
  readonly product_name?: unknown;
  readonly brands?: unknown;
  readonly nutriments?: unknown;
}

interface CacheEntry {
  readonly expiresAt: number;
  readonly results: readonly PublicFoodSearchResult[];
}

function nutrient(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value * 10) / 10
    : null;
}

export class OpenFoodFactsPublicFoodProvider implements PublicFoodProvider {
  readonly #cache = new Map<string, CacheEntry>();
  readonly #inFlight = new Map<string, Promise<readonly PublicFoodSearchResult[]>>();
  #requestTimes: number[] = [];

  public constructor(private readonly options: {
    readonly baseUrl: string;
    readonly timeoutMs: number;
    readonly cacheTtlMs: number;
    readonly maxRequestsPerMinute?: number;
    readonly fetcher?: Fetcher;
    readonly now?: () => number;
  }) {}

  public async search(query: string): Promise<readonly PublicFoodSearchResult[]> {
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    const now = (this.options.now ?? Date.now)();
    const cached = this.#cache.get(normalized);
    if (cached !== undefined && cached.expiresAt > now) return cached.results;
    const pending = this.#inFlight.get(normalized);
    if (pending !== undefined) return pending;
    const request = this.#request(normalized, now).finally(() => this.#inFlight.delete(normalized));
    this.#inFlight.set(normalized, request);
    return request;
  }

  async #request(query: string, now: number): Promise<readonly PublicFoodSearchResult[]> {
    this.#requestTimes = this.#requestTimes.filter((value) => value > now - 60_000);
    if (this.#requestTimes.length >= (this.options.maxRequestsPerMinute ?? 9)) {
      throw new PublicFoodProviderError("rate_limited");
    }
    this.#requestTimes.push(now);

    const url = new URL(this.options.baseUrl);
    url.searchParams.set("q", query);
    url.searchParams.append("langs", "zh");
    url.searchParams.append("langs", "en");
    url.searchParams.set("page_size", "8");
    url.searchParams.set("fields", "code,product_name,brands,nutriments");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await (this.options.fetcher ?? fetch)(url, {
        method: "GET",
        signal: controller.signal,
        headers: {
          accept: "application/json",
          "user-agent": "ExerciseApp/1.0 (https://github.com/Syriii/exercise-app)",
        },
      });
      if (response.status === 429) throw new PublicFoodProviderError("rate_limited");
      if (!response.ok) throw new PublicFoodProviderError("unavailable");
      const body = await response.json() as { hits?: unknown };
      if (!Array.isArray(body.hits)) throw new PublicFoodProviderError("invalid_response");
      const seen = new Set<string>();
      const results = body.hits.flatMap((raw): PublicFoodSearchResult[] => {
        const hit = raw as OpenFoodFactsHit;
        const barcode = typeof hit.code === "string" ? hit.code.trim() : "";
        const label = typeof hit.product_name === "string" ? hit.product_name.trim() : "";
        if (barcode.length === 0 || label.length === 0 || seen.has(barcode)) return [];
        const values = typeof hit.nutriments === "object" && hit.nutriments !== null
          ? hit.nutriments as Record<string, unknown>
          : {};
        const result: PublicFoodSearchResult = {
          id: `open_food_facts:${barcode}`,
          provider: "open_food_facts",
          label,
          brand: Array.isArray(hit.brands) && typeof hit.brands[0] === "string" && hit.brands[0].trim().length > 0 ? hit.brands[0].trim() : null,
          barcode,
          basisAmount: 100,
          basisUnit: "g",
          energyKcal: nutrient(values["energy-kcal_100g"]),
          proteinGrams: nutrient(values.proteins_100g),
          carbohydrateGrams: nutrient(values.carbohydrates_100g),
          fatGrams: nutrient(values.fat_100g),
          sourceUrl: `https://world.openfoodfacts.org/product/${encodeURIComponent(barcode)}`,
        };
        if ([result.energyKcal, result.proteinGrams, result.carbohydrateGrams, result.fatGrams].every((value) => value === null)) return [];
        seen.add(barcode);
        return [result];
      });
      this.#cache.set(query, { expiresAt: now + this.options.cacheTtlMs, results });
      if (this.#cache.size > 100) this.#cache.delete(this.#cache.keys().next().value ?? "");
      return results;
    } catch (error) {
      if (error instanceof PublicFoodProviderError) throw error;
      if (error instanceof Error && error.name === "AbortError") throw new PublicFoodProviderError("timeout");
      throw new PublicFoodProviderError("unavailable");
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class FixedPublicFoodProvider implements PublicFoodProvider {
  public constructor(private readonly results: readonly PublicFoodSearchResult[]) {}
  public async search(query: string) {
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    return this.results.filter((value) => value.label.toLocaleLowerCase("zh-CN").includes(normalized));
  }
}
