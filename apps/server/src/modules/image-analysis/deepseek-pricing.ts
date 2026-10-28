import type { ImageAnalyzerUsage } from "./analyzer.js";

// Snapshot checked 2026-10-28. Prices are CNY per million tokens.
export const deepSeekPriceSource = "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/";
export const deepSeekPriceVersion = "deepseek-flash-checked-2026-10-28";

interface DeepSeekRates {
  readonly cacheHitInputPerMillion: number;
  readonly cacheMissInputPerMillion: number;
  readonly outputPerMillion: number;
}

export interface DeepSeekCostEstimate {
  readonly currency: "CNY";
  readonly priceVersion: string;
  readonly priceSource: string;
  readonly ratePeriod: "peak" | "off_peak" | "peak_or_off_peak";
  readonly ratePeriodReason?: "public_holiday_unverified";
  readonly billedModel: "deepseek-flash";
  // These three rates are the upper bound when the holiday calendar is unknown.
  readonly cacheHitInputPerMillion: number;
  readonly cacheMissInputPerMillion: number;
  readonly outputPerMillion: number;
  readonly minimumRates?: DeepSeekRates;
  readonly minimumCny: number;
  readonly maximumCny: number;
  readonly basis: "provider_cache_split" | "cache_split_unknown";
}

export function estimateDeepSeekCost(model: string, startedAt: Date, usage: ImageAnalyzerUsage | null): DeepSeekCostEstimate | null {
  if (!usage || !["deepseek-flash", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp"].includes(model)
    || usage.promptTokens === null || usage.completionTokens === null) return null;
  const china = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(startedAt);
  const field = (type: string) => china.find(part => part.type === type)?.value ?? "";
  const weekday = field("weekday");
  const minutes = Number(field("hour")) * 60 + Number(field("minute"));
  const peakWindow = !["Sat", "Sun"].includes(weekday) && ((minutes >= 540 && minutes < 720) || (minutes >= 840 && minutes < 1080));
  // DeepSeek excludes Chinese public holidays from weekday peak pricing. Until a
  // verified provider calendar is available, that window has two possible rates.
  const minimumRates = { cacheHitInputPerMillion: 0.02, cacheMissInputPerMillion: 1, outputPerMillion: 4 };
  const hitRate = peakWindow ? 0.04 : minimumRates.cacheHitInputPerMillion;
  const missRate = peakWindow ? 2 : minimumRates.cacheMissInputPerMillion;
  const outputRate = peakWindow ? 8 : minimumRates.outputPerMillion;
  const splitKnown = usage.promptCacheHitTokens != null && usage.promptCacheMissTokens != null
    && usage.promptCacheHitTokens + usage.promptCacheMissTokens === usage.promptTokens;
  const minimumCny = (splitKnown
    ? usage.promptCacheHitTokens! * minimumRates.cacheHitInputPerMillion + usage.promptCacheMissTokens! * minimumRates.cacheMissInputPerMillion
    : usage.promptTokens * minimumRates.cacheHitInputPerMillion) / 1_000_000 + usage.completionTokens * minimumRates.outputPerMillion / 1_000_000;
  const maximumCny = (splitKnown
    ? usage.promptCacheHitTokens! * hitRate + usage.promptCacheMissTokens! * missRate
    : usage.promptTokens * missRate) / 1_000_000 + usage.completionTokens * outputRate / 1_000_000;
  return { currency: "CNY", priceVersion: deepSeekPriceVersion, priceSource: deepSeekPriceSource,
    ratePeriod: peakWindow ? "peak_or_off_peak" : "off_peak", billedModel: "deepseek-flash",
    ...(peakWindow ? { ratePeriodReason: "public_holiday_unverified" as const, minimumRates } : {}),
    cacheHitInputPerMillion: hitRate, cacheMissInputPerMillion: missRate, outputPerMillion: outputRate,
    minimumCny, maximumCny, basis: splitKnown ? "provider_cache_split" : "cache_split_unknown" };
}
