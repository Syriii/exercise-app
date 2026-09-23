import { describe, expect, it } from "vitest";
import { estimateDeepSeekCost } from "./deepseek-pricing.js";

describe("DeepSeek Flash cost estimate", () => {
  it("uses the returned cache split and Shanghai peak hours", () => {
    const value = estimateDeepSeekCost("deepseek-v4-flash-vision-exp", new Date("2026-09-23T02:00:00Z"), {
      promptTokens: 1000, completionTokens: 200, totalTokens: 1200,
      promptCacheHitTokens: 600, promptCacheMissTokens: 400,
    });
    expect(value).toMatchObject({ ratePeriod: "peak", billedModel: "deepseek-flash", basis: "provider_cache_split" });
    expect(value?.minimumCny).toBeCloseTo((600 * 0.04 + 400 * 2 + 200 * 8) / 1_000_000);
    expect(value?.maximumCny).toBe(value?.minimumCny);
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
});
