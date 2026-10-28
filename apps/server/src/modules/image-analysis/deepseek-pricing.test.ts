import { describe, expect, it } from "vitest";
import { estimateDeepSeekCost } from "./deepseek-pricing.js";

describe("DeepSeek Flash cost estimate", () => {
  it("keeps both weekday rates until Chinese public holidays are verified", () => {
    const value = estimateDeepSeekCost("deepseek-v4-flash-vision-exp", new Date("2026-09-23T02:00:00Z"), {
      promptTokens: 1000, completionTokens: 200, totalTokens: 1200,
      promptCacheHitTokens: 600, promptCacheMissTokens: 400,
    });
    expect(value).toMatchObject({ ratePeriod: "peak_or_off_peak", ratePeriodReason: "public_holiday_unverified", billedModel: "deepseek-flash", basis: "provider_cache_split",
      minimumRates: { cacheHitInputPerMillion: 0.02, cacheMissInputPerMillion: 1, outputPerMillion: 4 } });
    expect(value?.minimumCny).toBeCloseTo((600 * 0.02 + 400 * 1 + 200 * 4) / 1_000_000);
    expect(value?.maximumCny).toBeCloseTo((600 * 0.04 + 400 * 2 + 200 * 8) / 1_000_000);
  });

  it("keeps a range when cache usage is absent and refuses unknown models", () => {
    const value = estimateDeepSeekCost("deepseek-flash", new Date("2026-09-20T02:00:00Z"), {
      promptTokens: 1000, completionTokens: 200, totalTokens: 1200,
      promptCacheHitTokens: null, promptCacheMissTokens: null,
    });
    expect(value).toMatchObject({ ratePeriod: "off_peak", basis: "cache_split_unknown" });
    expect(value?.minimumCny).toBeCloseTo((1000 * 0.02 + 200 * 4) / 1_000_000);
    expect(value?.maximumCny).toBeCloseTo((1000 * 1 + 200 * 4) / 1_000_000);
    expect(estimateDeepSeekCost("other-model", new Date(), { promptTokens: 1, completionTokens: 1, totalTokens: 2 })).toBeNull();
  });

  it("does not turn a holiday weekday or an unverified future calendar into an exact peak bill", () => {
    for (const date of ["2026-10-01T02:00:00Z", "2027-01-01T02:00:00Z"]) {
      const value = estimateDeepSeekCost("deepseek-flash", new Date(date), { promptTokens: 1000, completionTokens: 200, totalTokens: 1200 });
      expect(value?.ratePeriod).toBe("peak_or_off_peak");
      expect(value?.minimumCny).toBeCloseTo((1000 * 0.02 + 200 * 4) / 1_000_000);
      expect(value?.maximumCny).toBeCloseTo((1000 * 2 + 200 * 8) / 1_000_000);
    }
  });

  it.each([
    ["2026-10-28T00:59:00Z", "off_peak"], ["2026-10-28T01:00:00Z", "peak_or_off_peak"],
    ["2026-10-28T04:00:00Z", "off_peak"], ["2026-10-28T06:00:00Z", "peak_or_off_peak"],
    ["2026-10-28T10:00:00Z", "off_peak"], ["2026-09-20T02:00:00Z", "off_peak"],
  ])("uses Shanghai time boundaries and keeps weekends off peak: %s", (date, period) => {
    const value = estimateDeepSeekCost("deepseek-flash", new Date(date), {
      promptTokens: 1000, completionTokens: 200, totalTokens: 1200, promptCacheHitTokens: 600, promptCacheMissTokens: 400,
    });
    expect(value?.ratePeriod).toBe(period);
    if (period === "off_peak") expect(value?.maximumCny).toBe(value?.minimumCny);
  });
});
