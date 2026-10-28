import { describe, expect, it } from "vitest";

import type { ImageAnalyzerCall } from "./analyzer.js";
import { mergeAttemptCalls, mergePreparedCall } from "./attempt-evidence.js";
import { MemoryImageAnalysisRepository } from "./memory-repository.js";

const call: ImageAnalyzerCall = { startedAt: "2026-10-28T04:00:00.000Z", configuredModel: "requested-model",
  providerModel: "returned-model", providerRequestId: "request-1", status: "succeeded",
  usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 }, cost: null, durationMs: 10 };

describe("attempt billing evidence", () => {
  it("records preparation once as intent and rejects conflicting reuse of its id", () => {
    const preparation = { callId: "call-1", preparedAt: "2026-10-28T03:59:59.000Z", configuredModel: call.configuredModel };
    const original = { model: "original-model", promptVersion: "original-prompt" };
    const prepared = mergePreparedCall(original, preparation);
    if (!prepared) throw Error("expected accepted preparation");
    expect(prepared).toEqual({ ...original, preparedCalls: [preparation] });
    expect(prepared.calls).toBeUndefined();
    expect(mergePreparedCall(prepared, { ...preparation })).toBe(prepared);
    expect(mergePreparedCall(prepared, { ...preparation, configuredModel: "another-model" })).toBe(false);
    const completed = mergeAttemptCalls(prepared, [{ ...call, callId: preparation.callId }])!;
    expect(completed.preparedCalls).toEqual([preparation]);
    expect(completed.calls).toEqual([{ ...call, callId: preparation.callId }]);
    expect(mergePreparedCall(completed, preparation)).toBe(completed);
  });

  it("keeps call identities separate even when timestamps and provider details otherwise match", () => {
    const preparation = { callId: "call-1", preparedAt: "2026-10-28T03:59:59.000Z", configuredModel: call.configuredModel };
    const prepared = mergePreparedCall({ model: "original", promptVersion: "original" }, preparation);
    if (!prepared) throw Error("expected accepted preparation");
    expect(mergeAttemptCalls(prepared, [{ ...call, callId: "call-1", configuredModel: "wrong-model" }])).toBe(prepared);
    const completed = mergeAttemptCalls(prepared, [{ ...call, callId: "call-1" }])!;
    expect(mergeAttemptCalls(completed, [{ ...call, callId: "call-2" }])).toBe(completed);
    expect(mergeAttemptCalls(completed, [call])).toBe(completed);
    const legacy = { model: "original", promptVersion: "original", calls: [call] };
    expect(mergeAttemptCalls(legacy, [{ ...call, callId: "call-1" }])?.calls?.[0]?.callId).toBe("call-1");
  });

  it("strictly rejects unprepared or conflicting response snapshots without changing the evidence", () => {
    const preparation = { callId: "call-1", preparedAt: "2026-10-28T03:59:59.000Z", configuredModel: call.configuredModel };
    const prepared = mergePreparedCall({ model: "original", promptVersion: "original" }, preparation);
    if (!prepared) throw Error("expected accepted preparation");
    const response = { ...call, callId: preparation.callId };
    const original = structuredClone(prepared);
    expect(() => mergeAttemptCalls(prepared, [{ ...response, callId: "unknown-call" }], true)).toThrow("image_analysis_call_evidence_conflict");
    expect(() => mergeAttemptCalls(prepared, [{ ...response, configuredModel: "wrong-model" }], true)).toThrow("image_analysis_call_evidence_conflict");
    expect(() => mergeAttemptCalls(prepared, [response, response], true)).toThrow("image_analysis_call_evidence_conflict");
    expect(prepared).toEqual(original);
    const completed = mergeAttemptCalls(prepared, [response], true)!;
    expect(mergeAttemptCalls(completed, [structuredClone(response)], true)).toBe(completed);
    for (const conflict of [{ ...response, providerRequestId: "another-request" }, { ...response, startedAt: "2026-10-28T04:01:00.000Z" },
      { ...response, usage: { promptTokens: 999, completionTokens: 20, totalTokens: 1019 } }]) {
      expect(() => mergeAttemptCalls(completed, [conflict], true)).toThrow("image_analysis_call_evidence_conflict");
    }
    expect(completed.calls).toEqual([response]);
    expect(completed.preparedCalls).toEqual([preparation]);
    expect(mergeAttemptCalls({ model: "legacy", promptVersion: "legacy" }, [call], true)?.calls).toEqual([call]);
    expect(mergeAttemptCalls(completed, [call], true)).toBe(completed);
  });

  it("makes the memory record path reject conflicts rather than reporting a silent successful write", async () => {
    const repository = new MemoryImageAnalysisRepository();
    const photo = await repository.create("owner", "meal", "image/png", { objectKey: "fake.png", byteSize: 1, sha256: "a".repeat(64) }, null, "original", "original");
    const attempt = await repository.beginAttempt(photo.id);
    if (typeof attempt === "string") throw Error(attempt);
    const preparation = { callId: "call-1", preparedAt: "2026-10-28T03:59:59.000Z", configuredModel: call.configuredModel };
    expect(await repository.prepareCall(photo.id, attempt.attemptId, preparation)).toBe(true);
    const prepared = await repository.get("owner", photo.id);
    const response = { ...call, callId: preparation.callId };
    await expect(repository.recordCalls(photo.id, attempt.attemptId, [{ ...response, callId: "unknown-call" }])).rejects.toThrow("image_analysis_call_evidence_conflict");
    await expect(repository.recordCalls(photo.id, attempt.attemptId, [{ ...response, configuredModel: "wrong-model" }])).rejects.toThrow("image_analysis_call_evidence_conflict");
    expect(await repository.get("owner", photo.id)).toEqual(prepared);
    await repository.recordCalls(photo.id, attempt.attemptId, [response]);
    const completed = await repository.get("owner", photo.id);
    await repository.recordCalls(photo.id, attempt.attemptId, [response]);
    await expect(repository.recordCalls(photo.id, attempt.attemptId, [{ ...response, usage: { promptTokens: 999, completionTokens: 20, totalTokens: 1019 } }])).rejects.toThrow("image_analysis_call_evidence_conflict");
    expect(await repository.get("owner", photo.id)).toEqual(completed);
    await repository.recordCalls("deleted-analysis", attempt.attemptId, [response]);
    await repository.recordCalls(photo.id, "deleted-attempt", [response]);
    expect(await repository.get("owner", photo.id)).toEqual(completed);
  });

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
