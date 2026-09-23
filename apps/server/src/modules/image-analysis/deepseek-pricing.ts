import type { ImageAnalyzerUsage } from "./analyzer.js";

// Snapshot checked 2026-09-23. Prices are CNY per million tokens.
export const deepSeekPriceSource = "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/";
export const deepSeekPriceVersion = "deepseek-flash-2026-09-10-checked-2026-09-23";

export interface DeepSeekCostEstimate {
  readonly currency: "CNY";
  readonly priceVersion: string;
  readonly priceSource: string;
  readonly ratePeriod: "peak" | "off_peak";
  readonly billedModel: "deepseek-flash";
  readonly cacheHitInputPerMillion: number;
  readonly cacheMissInputPerMillion: number;
  readonly outputPerMillion: number;
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
  const peak = !["Sat", "Sun"].includes(weekday) && ((minutes >= 540 && minutes < 720) || (minutes >= 840 && minutes < 1080));
  const hitRate = peak ? 0.04 : 0.02;
  const missRate = peak ? 2 : 1;
  const outputRate = peak ? 8 : 4;
  const splitKnown = usage.promptCacheHitTokens != null && usage.promptCacheMissTokens != null
    && usage.promptCacheHitTokens + usage.promptCacheMissTokens === usage.promptTokens;
  const output = usage.completionTokens * outputRate;
  const minimumCny = (splitKnown
    ? usage.promptCacheHitTokens! * hitRate + usage.promptCacheMissTokens! * missRate + output
    : usage.promptTokens * hitRate + output) / 1_000_000;
  const maximumCny = (splitKnown ? minimumCny * 1_000_000 : usage.promptTokens * missRate + output) / 1_000_000;
  return { currency: "CNY", priceVersion: deepSeekPriceVersion, priceSource: deepSeekPriceSource,
    ratePeriod: peak ? "peak" : "off_peak", billedModel: "deepseek-flash",
    cacheHitInputPerMillion: hitRate, cacheMissInputPerMillion: missRate, outputPerMillion: outputRate,
    minimumCny, maximumCny, basis: splitKnown ? "provider_cache_split" : "cache_split_unknown" };
}
