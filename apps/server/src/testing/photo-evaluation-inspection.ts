import { createHash } from "node:crypto";
import type { ImageAnalyzerCall, ImageAnalyzerUsage } from "../modules/image-analysis/analyzer.js";
import type { DeepSeekCostEstimate } from "../modules/image-analysis/deepseek-pricing.js";
import { summarizeEvaluationCalls } from "./photo-evaluation.js";

type JsonObject = Record<string, unknown>;
interface LocatedRecord { line: number; value: JsonObject; }
interface Preparation { id: string; callId: string; preparedAt: string; configuredModel: string; lines: number[]; conflict: boolean; }
interface Observation { id: string; ordinal: number; line: number; call: ImageAnalyzerCall; fingerprint: string; identity: string; }
interface CallGroup { id: string; callId: string | null; ordinal: number | null; observations: Observation[]; conflict: boolean; }

const object = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 2_000;
const nullableText = (value: unknown): value is string | null => value === null || text(value);
const finiteNonnegative = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const token = (value: unknown): value is number | null => value === null || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
const time = (value: unknown): value is string => text(value) && Number.isFinite(Date.parse(value));
const key = (id: string, identity: string | number) => JSON.stringify([id, identity]);

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

function readUsage(value: unknown): ImageAnalyzerUsage | null | undefined {
  if (value === null) return null;
  if (!object(value) || !token(value.promptTokens) || !token(value.completionTokens) || !token(value.totalTokens)) return undefined;
  if (value.promptCacheHitTokens !== undefined && !token(value.promptCacheHitTokens)) return undefined;
  if (value.promptCacheMissTokens !== undefined && !token(value.promptCacheMissTokens)) return undefined;
  return { promptTokens: value.promptTokens, completionTokens: value.completionTokens, totalTokens: value.totalTokens,
    ...(value.promptCacheHitTokens === undefined ? {} : { promptCacheHitTokens: value.promptCacheHitTokens as number | null }),
    ...(value.promptCacheMissTokens === undefined ? {} : { promptCacheMissTokens: value.promptCacheMissTokens as number | null }),
  };
}

function readCost(value: unknown): DeepSeekCostEstimate | null | undefined {
  if (value === null) return null;
  if (!object(value) || value.currency !== "CNY" || !text(value.priceVersion) || !text(value.priceSource)
    || !["peak", "off_peak", "peak_or_off_peak"].includes(String(value.ratePeriod)) || value.billedModel !== "deepseek-flash"
    || !["provider_cache_split", "cache_split_unknown"].includes(String(value.basis))
    || !finiteNonnegative(value.minimumCny) || !finiteNonnegative(value.maximumCny) || value.minimumCny > value.maximumCny
    || !finiteNonnegative(value.cacheHitInputPerMillion) || !finiteNonnegative(value.cacheMissInputPerMillion) || !finiteNonnegative(value.outputPerMillion)) return undefined;
  let source: URL;
  try { source = new URL(value.priceSource); } catch { return undefined; }
  if (source.protocol !== "https:" || source.hostname !== "api-docs.deepseek.com" || source.username || source.password || source.search || source.hash) return undefined;
  if (value.ratePeriodReason !== undefined && value.ratePeriodReason !== "public_holiday_unverified") return undefined;
  if (value.minimumRates !== undefined && (!object(value.minimumRates)
    || !finiteNonnegative(value.minimumRates.cacheHitInputPerMillion) || !finiteNonnegative(value.minimumRates.cacheMissInputPerMillion)
    || !finiteNonnegative(value.minimumRates.outputPerMillion))) return undefined;
  const minimumRates = object(value.minimumRates) && finiteNonnegative(value.minimumRates.cacheHitInputPerMillion)
    && finiteNonnegative(value.minimumRates.cacheMissInputPerMillion) && finiteNonnegative(value.minimumRates.outputPerMillion)
    ? { cacheHitInputPerMillion: value.minimumRates.cacheHitInputPerMillion,
      cacheMissInputPerMillion: value.minimumRates.cacheMissInputPerMillion, outputPerMillion: value.minimumRates.outputPerMillion }
    : undefined;
  return { currency: "CNY", priceVersion: value.priceVersion, priceSource: value.priceSource,
    ratePeriod: value.ratePeriod as DeepSeekCostEstimate["ratePeriod"], billedModel: "deepseek-flash",
    cacheHitInputPerMillion: value.cacheHitInputPerMillion, cacheMissInputPerMillion: value.cacheMissInputPerMillion, outputPerMillion: value.outputPerMillion,
    minimumCny: value.minimumCny, maximumCny: value.maximumCny, basis: value.basis as DeepSeekCostEstimate["basis"],
    ...(value.ratePeriodReason === undefined ? {} : { ratePeriodReason: "public_holiday_unverified" as const }),
    ...(minimumRates === undefined ? {} : { minimumRates }),
  };
}

function readCall(value: unknown): ImageAnalyzerCall | null {
  if (!object(value) || !time(value.startedAt) || !text(value.configuredModel) || !nullableText(value.providerModel)
    || !nullableText(value.providerRequestId) || !finiteNonnegative(value.durationMs) || !text(value.status)
    || !(value.status === "succeeded" || /^deepseek_[a-z0-9_]+$/.test(value.status))) return null;
  if (value.callId !== undefined && !text(value.callId)) return null;
  const usage = readUsage(value.usage), cost = readCost(value.cost);
  if (usage === undefined || cost === undefined) return null;
  return { ...(value.callId === undefined ? {} : { callId: value.callId as string }),
    startedAt: value.startedAt, configuredModel: value.configuredModel, providerModel: value.providerModel,
    providerRequestId: value.providerRequestId, status: value.status, durationMs: value.durationMs, usage, cost };
}

/** Read existing journal bytes only. Never imports model execution, credentials or current prices. */
export function inspectPhotoEvaluationLog(bytes: Buffer) {
  const rawLines = bytes.toString("utf8").split("\n"), hasFinalNewline = bytes.length === 0 || bytes.at(-1) === 10;
  const completeLines = rawLines.slice(0, -1); // An unterminated final line is not completion evidence.
  const truncatedFinalLine = !hasFinalNewline && rawLines.at(-1)?.trim() ? rawLines.length : null;
  const malformedLines: number[] = [], invalidRecordLines = new Set<number>(), invalidCallLines = new Set<number>();
  const records: LocatedRecord[] = [];
  for (const [index, line] of completeLines.entries()) {
    if (!line.trim()) continue;
    try {
      const value: unknown = JSON.parse(line);
      if (!object(value)) invalidRecordLines.add(index + 1);
      else records.push({ line: index + 1, value });
    } catch { malformedLines.push(index + 1); }
  }

  const samples = new Set<string>(), started = new Set<string>(), predictions = new Map<string, string>();
  const metadataSampleCounts = new Set<number>();
  const predictionConflicts = new Set<string>(), preparations = new Map<string, Preparation>();
  const observations: Observation[] = [];
  for (const { line, value } of records) {
    if (value.type === "summary") continue;
    if (value.type === "metadata") {
      if (typeof value.sampleCount !== "number" || !Number.isSafeInteger(value.sampleCount) || value.sampleCount < 0) invalidRecordLines.add(line);
      else metadataSampleCounts.add(value.sampleCount);
      continue;
    }
    if (!text(value.id)) { invalidRecordLines.add(line); continue; }
    const id = value.id;
    samples.add(id);
    if (value.type === "request_started") {
      started.add(id);
      if (!time(value.at)) invalidRecordLines.add(line);
      continue;
    }
    if (value.type === "provider_request_prepared") {
      if (!text(value.callId) || !time(value.preparedAt) || !text(value.configuredModel) || value.dispatchState !== "unconfirmed") {
        invalidRecordLines.add(line); continue;
      }
      const identity = key(id, value.callId), prior = preparations.get(identity);
      if (prior) {
        prior.lines.push(line);
        if (prior.preparedAt !== value.preparedAt || prior.configuredModel !== value.configuredModel) prior.conflict = true;
      } else preparations.set(identity, { id, callId: value.callId, preparedAt: value.preparedAt, configuredModel: value.configuredModel, lines: [line], conflict: false });
      continue;
    }
    if (value.type !== "provider_calls_recorded" && value.type !== "prediction") { invalidRecordLines.add(line); continue; }
    if (value.type === "prediction") {
      if (!(value.error === null || text(value.error)) || !(value.prediction === null || object(value.prediction)) || !Object.hasOwn(value, "prediction")) invalidRecordLines.add(line);
      else {
        const fingerprint = canonical({ error: value.error, prediction: value.prediction, truth: value.truth ?? null });
        const prior = predictions.get(id);
        if (prior !== undefined && prior !== fingerprint) predictionConflicts.add(id);
        else predictions.set(id, fingerprint);
      }
      // Earlier logs may have a prediction without per-request billing evidence.
      if (value.calls === undefined) continue;
    }
    if (!Array.isArray(value.calls)) { invalidRecordLines.add(line); continue; }
    for (const [ordinal, candidate] of value.calls.entries()) {
      const call = readCall(candidate);
      if (!call || (value.type === "provider_calls_recorded" && !call.callId)) { invalidCallLines.add(line); continue; }
      const { callId: _callId, ...snapshot } = call;
      observations.push({ id, ordinal, line, call, fingerprint: canonical(snapshot),
        identity: canonical([call.startedAt, call.configuredModel, call.providerModel, call.providerRequestId]) });
    }
  }

  const explicit = new Map<string, CallGroup>(), legacy = new Map<string, CallGroup>();
  for (const observation of observations) {
    const callId = observation.call.callId ?? null, groups = callId === null ? legacy : explicit;
    const identity = key(observation.id, callId ?? observation.ordinal), prior = groups.get(identity);
    if (prior) {
      prior.observations.push(observation);
      if (prior.observations[0]!.fingerprint !== observation.fingerprint || prior.observations[0]!.identity !== observation.identity) prior.conflict = true;
    } else groups.set(identity, { id: observation.id, callId, ordinal: callId === null ? observation.ordinal : null, observations: [observation], conflict: false });
  }
  for (const group of explicit.values()) {
    const prepared = preparations.get(key(group.id, group.callId!));
    if (prepared && (prepared.conflict || prepared.configuredModel !== group.observations[0]!.call.configuredModel)) group.conflict = true;
  }
  const aliasedLegacy = new Set<CallGroup>();
  for (const group of legacy.values()) {
    const matches = [...explicit.values()].filter(other => other.id === group.id && other.observations.some(item => item.ordinal === group.ordinal));
    if (!matches.length) continue;
    if (matches.length === 1 && !group.conflict && !matches[0]!.conflict
      && group.observations[0]!.identity === matches[0]!.observations[0]!.identity
      && group.observations[0]!.fingerprint === matches[0]!.observations[0]!.fingerprint) aliasedLegacy.add(group);
    else { group.conflict = true; for (const match of matches) match.conflict = true; }
  }
  const groups = [...explicit.values(), ...legacy.values()].filter(group => !aliasedLegacy.has(group));
  const completed = groups.filter(group => !group.conflict);
  const completedKeys = new Set(completed.filter(group => group.callId !== null).map(group => key(group.id, group.callId!)));
  const unresolvedPreparations = [...preparations.values()].filter(prepared => prepared.conflict || !completedKeys.has(key(prepared.id, prepared.callId)))
    .map(({ id, callId, preparedAt, configuredModel }) => ({ id, callId, preparedAt, configuredModel, dispatchState: "unconfirmed", outcome: "unknown", usage: null, cost: null }));
  const conflicts = groups.filter(group => group.conflict).map(group => ({ id: group.id, callId: group.callId, ordinal: group.ordinal,
    lines: [...new Set(group.observations.map(item => item.line))].sort((a, b) => a - b), outcome: "unknown" }));
  const completedSamples = new Set(completed.map(group => group.id)), preparedSamples = new Set([...preparations.values()].map(item => item.id));
  const unknownSampleIntents = [...new Set([...started, ...predictions.keys()])].filter(id => !preparedSamples.has(id) && !completedSamples.has(id));
  const orphanedCompletedCalls = completed.filter(group => group.callId !== null && !preparations.has(key(group.id, group.callId!)))
    .map(group => ({ id: group.id, callId: group.callId }));
  const samplesMissingPrediction = [...samples].filter(id => !predictions.has(id) || predictionConflicts.has(id));
  const callsMissingPrediction = completed.filter(group => samplesMissingPrediction.includes(group.id))
    .map(group => ({ id: group.id, callId: group.callId, ordinal: group.ordinal }));
  const callSummary = summarizeEvaluationCalls(completed.map(group => group.observations[0]!.call));
  const metadataSampleCountConflict = metadataSampleCounts.size > 1;
  const expectedSampleCount = metadataSampleCounts.size === 1 ? [...metadataSampleCounts][0]! : null;
  const unobservedSampleCount = expectedSampleCount === null ? null : Math.max(0, expectedSampleCount - samples.size);
  const sampleCountExceeded = expectedSampleCount !== null && samples.size > expectedSampleCount;
  const evaluationIncomplete = metadataSampleCountConflict || sampleCountExceeded || samplesMissingPrediction.length > 0
    || (unobservedSampleCount !== null && unobservedSampleCount > 0);
  const emptyLog = records.length === 0;
  const uncertainEvidence = emptyLog || malformedLines.length > 0 || invalidRecordLines.size > 0 || invalidCallLines.size > 0 || truncatedFinalLine !== null
    || unresolvedPreparations.length > 0 || unknownSampleIntents.length > 0 || conflicts.length > 0 || orphanedCompletedCalls.length > 0 || predictionConflicts.size > 0
    || metadataSampleCountConflict || sampleCountExceeded || (unobservedSampleCount !== null && unobservedSampleCount > 0);
  return {
    readOnly: true, inputSha256: createHash("sha256").update(bytes).digest("hex"), inputBytes: bytes.length,
    expectedSampleCount, observedSampleCount: samples.size, unobservedSampleCount, evaluationIncomplete,
    recordedCompletedCalls: completed.length, pricedCompletedCalls: callSummary.pricedRequests,
    unknownPriceCompletedCalls: callSummary.estimatedCostCny.unknownRequests,
    recordedCalls: completed.map(group => ({ id: group.id, ordinal: group.ordinal, ...group.observations[0]!.call })),
    unresolvedPreparations, unknownSampleIntents, samplesMissingPrediction, callsMissingPrediction,
    estimatedCostCny: { ...callSummary.estimatedCostCny, maximum: uncertainEvidence ? null : callSummary.estimatedCostCny.maximum },
    issues: { emptyLog, malformedLines, truncatedFinalLine, invalidRecordLines: [...invalidRecordLines].sort((a, b) => a - b),
      invalidCallLines: [...invalidCallLines].sort((a, b) => a - b), conflictingCalls: conflicts, orphanedCompletedCalls, predictionConflicts: [...predictionConflicts],
      metadataSampleCountConflict, sampleCountExceeded },
    manualReviewRequired: uncertainEvidence || evaluationIncomplete || callSummary.estimatedCostCny.unknownRequests > 0,
    notes: [
      "次数仅表示去重后的完成记录；准备意图不能证明请求已经发送或产生费用。",
      "费用仅汇总日志中既有历史快照，未重新估价；已知小计不等于存在未知记录时的整批费用。",
      "未出现记录的预期样本只表示评测不完整，不能据此推断额外请求或费用。",
      "此工具只读核对，不恢复、不重发模型请求。",
    ],
  };
}
