import { describe, expect, it } from "vitest";

import type { ImageAnalyzerCall } from "./analyzer.js";
import { mergeAttemptCalls } from "./attempt-evidence.js";

const call: ImageAnalyzerCall = { startedAt: "2026-10-28T04:00:00.000Z", configuredModel: "requested-model",
  providerModel: "returned-model", providerRequestId: "request-1", status: "succeeded",
  usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 }, cost: null, durationMs: 10 };

describe("attempt billing evidence", () => {
  it("merges cumulative snapshots once and preserves original version metadata", () => {
    const original = { model: "original-model", promptVersion: "original-prompt" };
    const first = mergeAttemptCalls(original, [call])!;
    expect(first).toEqual({ ...original, calls: [call] });
    expect(mergeAttemptCalls(first, [structuredClone(call)])).toBe(first);
    const second = { ...call, providerRequestId: "request-2", startedAt: "2026-10-28T04:00:01.000Z" };
    const complete = mergeAttemptCalls(first, [call, second])!;
    expect(complete.calls).toEqual([call, second]);
    expect(mergeAttemptCalls(complete, [call])).toBe(complete);
    expect(original).toEqual({ model: "original-model", promptVersion: "original-prompt" });
  });

  it("fills unknown billing fields without overwriting attributed requests or known usage", () => {
    const partial = { ...call, providerModel: null, providerRequestId: null, usage: { promptTokens: 100, completionTokens: null, totalTokens: null } };
    const original = { model: "original", promptVersion: "original", calls: [partial] };
    const enriched = mergeAttemptCalls(original, [{ ...call, usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120, promptCacheHitTokens: 40, promptCacheMissTokens: 60 } }])!;
    expect(enriched.calls?.[0]).toMatchObject({ providerRequestId: "request-1", providerModel: "returned-model",
      usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120, promptCacheHitTokens: 40, promptCacheMissTokens: 60 } });
    expect(mergeAttemptCalls(enriched, [{ ...call, providerRequestId: "unrelated-request" }])).toBe(enriched);
    expect(mergeAttemptCalls(enriched, [{ ...call, usage: { promptTokens: 999, completionTokens: 20, totalTokens: 1019 } }])).toBe(enriched);
  });

  it("marks missing legacy metadata unknown rather than copying a newer attempt's version", () => {
    expect(mergeAttemptCalls(null, [call])).toEqual({ model: "unknown", promptVersion: "unknown", calls: [call] });
    expect(mergeAttemptCalls(null, [])).toBeNull();
  });
});
