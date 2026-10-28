import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import type { ImageAnalyzerCall } from "../modules/image-analysis/analyzer.js";
import { inspectPhotoEvaluationLog } from "./photo-evaluation-inspection.js";

const values = { energyKcal: null, massGrams: null, proteinGrams: null, carbohydrateGrams: null, fatGrams: null };
const call = (callId = "call-a"): ImageAnalyzerCall => ({
  callId, startedAt: "2026-10-28T05:00:01Z", configuredModel: "deepseek-flash", providerModel: "deepseek-flash",
  providerRequestId: `provider-${callId}`, status: "succeeded", durationMs: 10,
  usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120, promptCacheHitTokens: 0, promptCacheMissTokens: 100 },
  cost: { currency: "CNY", priceVersion: "historical-test-snapshot", priceSource: "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/",
    ratePeriod: "off_peak", billedModel: "deepseek-flash", cacheHitInputPerMillion: 0.02, cacheMissInputPerMillion: 1, outputPerMillion: 4,
    minimumCny: 0.00018, maximumCny: 0.00018, basis: "provider_cache_split" },
});
const started = (id = "sample-a") => ({ type: "request_started", id, at: "2026-10-28T05:00:00Z" });
const prepared = (callId = "call-a", id = "sample-a") => ({ type: "provider_request_prepared", id, callId,
  preparedAt: "2026-10-28T05:00:00Z", configuredModel: "deepseek-flash", dispatchState: "unconfirmed" });
const receipt = (calls: readonly ImageAnalyzerCall[], id = "sample-a") => ({ type: "provider_calls_recorded", id, callId: calls.at(-1)?.callId, calls });
const prediction = (calls: readonly ImageAnalyzerCall[], id = "sample-a") => ({ type: "prediction", id,
  truth: values, prediction: values, error: null, calls, candidate: { title: "DO-NOT-ECHO-CANDIDATE-OR-SECRET" } });
const jsonl = (records: readonly unknown[]) => Buffer.from(records.map(record => JSON.stringify(record)).join("\n") + "\n");

it("recovers each completed call once from cumulative receipts even when prediction and summary were never written", () => {
  const first = call(), second = call("call-b");
  const result = inspectPhotoEvaluationLog(jsonl([
    started(), prepared(), receipt([first]), prepared("call-b"), receipt([first, second]), receipt([first, second]),
  ]));
  expect(result.recordedCompletedCalls).toBe(2);
  expect(result.pricedCompletedCalls).toBe(2);
  expect(result.unresolvedPreparations).toEqual([]);
  expect(result.samplesMissingPrediction).toEqual(["sample-a"]);
  expect(result.callsMissingPrediction.map(item => item.callId)).toEqual(["call-a", "call-b"]);
  expect(result.estimatedCostCny.knownSubtotal.minimum).toBeCloseTo(0.00036);
  expect(result.estimatedCostCny.maximum).toBeCloseTo(0.00036);
  expect(result.recordedCalls.every(item => item.cost?.priceVersion === "historical-test-snapshot")).toBe(true);
  expect(result.manualReviewRequired).toBe(true);
});

it("keeps preparation-only and sample-start-only evidence unknown instead of claiming zero billed calls", () => {
  const result = inspectPhotoEvaluationLog(jsonl([started(), prepared(), started("sample-b")]));
  expect(result.recordedCompletedCalls).toBe(0);
  expect(result.unresolvedPreparations).toMatchObject([{ id: "sample-a", callId: "call-a", outcome: "unknown", cost: null }]);
  expect(result.unknownSampleIntents).toEqual(["sample-b"]);
  expect(result.estimatedCostCny).toMatchObject({ maximum: null, knownSubtotal: { minimum: 0, maximum: 0 } });
});

it("deduplicates legacy prediction snapshots by sample ordinal and request identity without repricing", () => {
  const { callId: _id, ...legacy } = call();
  const legacyPrediction = prediction([legacy]);
  const result = inspectPhotoEvaluationLog(jsonl([started(), legacyPrediction, legacyPrediction]));
  expect(result.recordedCompletedCalls).toBe(1);
  expect(result.recordedCalls[0]).toMatchObject({ id: "sample-a", ordinal: 0, cost: { minimumCny: 0.00018, priceVersion: "historical-test-snapshot" } });
  expect(result.estimatedCostCny.maximum).toBe(0.00018);
  expect(result.issues.conflictingCalls).toEqual([]);
  expect(result.unknownSampleIntents).toEqual([]);
  expect(result.samplesMissingPrediction).toEqual([]);
});

it("joins matching legacy and call-ID snapshots once and leaves conflicting identities or prices unknown", () => {
  const current = call(), { callId: _id, ...legacy } = current;
  const matching = inspectPhotoEvaluationLog(jsonl([prediction([legacy]), prepared(), receipt([current]), prediction([current])]));
  expect(matching.recordedCompletedCalls).toBe(1);
  expect(matching.estimatedCostCny.knownSubtotal.maximum).toBe(0.00018);
  const identityConflict = inspectPhotoEvaluationLog(jsonl([
    prediction([legacy]), prediction([{ ...legacy, providerRequestId: "different-provider-request" }]),
  ]));
  expect(identityConflict.recordedCompletedCalls).toBe(0);
  expect(identityConflict.issues.conflictingCalls).toMatchObject([{ id: "sample-a", ordinal: 0, outcome: "unknown" }]);
  expect(identityConflict.estimatedCostCny.maximum).toBeNull();
  const priceConflict = inspectPhotoEvaluationLog(jsonl([
    prepared(), receipt([current]), receipt([{ ...current, cost: { ...current.cost!, minimumCny: 1, maximumCny: 1 } }]),
  ]));
  expect(priceConflict.recordedCompletedCalls).toBe(0);
  expect(priceConflict.unresolvedPreparations).toHaveLength(1);
  expect(priceConflict.issues.conflictingCalls).toMatchObject([{ callId: "call-a", outcome: "unknown" }]);
  expect(priceConflict.estimatedCostCny.maximum).toBeNull();
});

it("uses complete valid lines around a corrupt middle line and marks a truncated final line without echoing either", () => {
  const bytes = Buffer.concat([
    jsonl([started(), prepared(), receipt([call()])]),
    Buffer.from("BROKEN-DO-NOT-ECHO-SECRET\n"),
    jsonl([prediction([call()])]),
    Buffer.from('{"type":"provider_request_prepared","id":"DO-NOT-ECHO-TAIL'),
  ]);
  const result = inspectPhotoEvaluationLog(bytes);
  expect(result.recordedCompletedCalls).toBe(1);
  expect(result.issues.malformedLines).toEqual([4]);
  expect(result.issues.truncatedFinalLine).toBe(6);
  expect(result.estimatedCostCny.knownSubtotal.maximum).toBe(0.00018);
  expect(result.estimatedCostCny.maximum).toBeNull();
  expect(JSON.stringify(result)).not.toMatch(/DO-NOT-ECHO|BROKEN/);
});

it("does not accept an unterminated receipt or malformed billing fragment as completion", () => {
  const bytes = Buffer.concat([jsonl([prepared()]), Buffer.from(JSON.stringify(receipt([call()]))) ]);
  const truncated = inspectPhotoEvaluationLog(bytes);
  expect(truncated.recordedCompletedCalls).toBe(0);
  expect(truncated.unresolvedPreparations).toHaveLength(1);
  expect(truncated.issues.truncatedFinalLine).toBe(2);
  const invalid = inspectPhotoEvaluationLog(jsonl([prepared(), receipt([{ ...call(), cost: {} as ImageAnalyzerCall["cost"] }])]));
  expect(invalid.recordedCompletedCalls).toBe(0);
  expect(invalid.issues.invalidCallLines).toEqual([2]);
  expect(invalid.unresolvedPreparations).toHaveLength(1);
  expect(invalid.estimatedCostCny.maximum).toBeNull();
});

it("marks metadata-only or conflicting sample counts incomplete without inventing paid calls", () => {
  const incomplete = inspectPhotoEvaluationLog(jsonl([{ type: "metadata", sampleCount: 20 }]));
  expect(incomplete).toMatchObject({ expectedSampleCount: 20, observedSampleCount: 0, unobservedSampleCount: 20,
    evaluationIncomplete: true, manualReviewRequired: true, recordedCompletedCalls: 0, pricedCompletedCalls: 0,
    unresolvedPreparations: [], unknownSampleIntents: [], estimatedCostCny: { maximum: null, knownSubtotal: { minimum: 0, maximum: 0 } } });
  const complete = inspectPhotoEvaluationLog(jsonl([{ type: "metadata", sampleCount: 1 }, started(), prepared(), receipt([call()]), prediction([call()])]));
  expect(complete).toMatchObject({ expectedSampleCount: 1, observedSampleCount: 1, unobservedSampleCount: 0,
    evaluationIncomplete: false, manualReviewRequired: false });
  const conflict = inspectPhotoEvaluationLog(jsonl([{ type: "metadata", sampleCount: 1 }, { type: "metadata", sampleCount: 2 }]));
  expect(conflict).toMatchObject({ expectedSampleCount: null, evaluationIncomplete: true, manualReviewRequired: true,
    recordedCompletedCalls: 0, issues: { metadataSampleCountConflict: true } });
  const exceeded = inspectPhotoEvaluationLog(jsonl([{ type: "metadata", sampleCount: 0 }, prediction([call()])]));
  expect(exceeded).toMatchObject({ evaluationIncomplete: true, manualReviewRequired: true, issues: { sampleCountExceeded: true } });
});

it("copies only supported call, usage and price fields including minimum rates", () => {
  const marker = "DO-NOT-ECHO-UNEXPECTED-CREDENTIAL";
  const current = call();
  const unexpected = { ...current, credential: marker, candidate: { secret: marker },
    usage: { ...current.usage!, credential: marker },
    cost: { ...current.cost!, credential: marker, minimumRates: {
      cacheHitInputPerMillion: 0.02, cacheMissInputPerMillion: 1, outputPerMillion: 4, credential: marker,
    } },
  };
  const result = inspectPhotoEvaluationLog(jsonl([prepared(), receipt([unexpected]), prediction([unexpected])]));
  expect(result.recordedCompletedCalls).toBe(1);
  expect(result.recordedCalls[0]!.cost!.minimumRates).toEqual({ cacheHitInputPerMillion: 0.02, cacheMissInputPerMillion: 1, outputPerMillion: 4 });
  expect(JSON.stringify(result)).not.toMatch(/DO-NOT-ECHO|credential|candidate|secret/);
});

it("runs the actual read-only entry point without approval or secrets and leaves source bytes and mode unchanged", async () => {
  const directory = await mkdtemp(join(tmpdir(), "exercise-evaluation-inspection-"));
  const path = join(directory, "existing-evaluation.jsonl");
  const entry = resolve(import.meta.dirname, "../entrypoints/inspect-photo-evaluation.ts");
  const bytes = jsonl([started(), prepared(), receipt([call()]), prediction([call()])]);
  try {
    await writeFile(path, bytes, { mode: 0o400 });
    const environment = { ...process.env };
    for (const name of ["PHOTO_EVALUATION_APPROVED", "DEEPSEEK_API_KEY", "DEEPSEEK_API_KEY_FILE", "DEEPSEEK_BASE_URL", "DEEPSEEK_VISION_MODEL"]) delete environment[name];
    const result = await promisify(execFile)(process.execPath, ["--import", "tsx", entry, path], { env: environment });
    expect(JSON.parse(result.stdout)).toMatchObject({ readOnly: true, recordedCompletedCalls: 1, estimatedCostCny: { maximum: 0.00018 } });
    expect(result.stdout).not.toContain("DO-NOT-ECHO");
    expect(await readFile(path)).toEqual(bytes);
    expect((await stat(path)).mode & 0o777).toBe(0o400);
    await expect(promisify(execFile)(process.execPath, ["--import", "tsx", entry, "relative.jsonl"], { env: environment }))
      .rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("inspection_requires_one_absolute_jsonl_path") });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
