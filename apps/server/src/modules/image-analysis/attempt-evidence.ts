import { isDeepStrictEqual } from "node:util";

import type { ImageAnalyzerCall, ImageAnalyzerCallPreparation, ImageAnalyzerUsage } from "./analyzer.js";
import type { AnalysisAttemptEvidence } from "./types.js";

/** Merge one execution's ordered call snapshot without changing its business outcome. */
export function mergeAttemptCalls(
  evidence: AnalysisAttemptEvidence | null | undefined,
  incoming: readonly ImageAnalyzerCall[] | undefined,
  strict = false,
): AnalysisAttemptEvidence | null {
  if (!incoming?.length) return evidence ?? null;
  const recorded = evidence?.calls ?? [];
  const conflict = () => {
    if (strict) throw new Error("image_analysis_call_evidence_conflict");
    return evidence ?? null;
  };
  const callIds = incoming.flatMap(call => call.callId === undefined ? [] : [call.callId]);
  if (strict && new Set(callIds).size !== callIds.length) return conflict();
  if (incoming.some(call => {
    const preparation = call.callId === undefined ? undefined : evidence?.preparedCalls?.find(value => value.callId === call.callId);
    return (strict && call.callId !== undefined && !preparation)
      || (preparation && preparation.configuredModel !== call.configuredModel);
  })) return conflict();
  // The ordinal identifies a request within this attempt's single analyzer execution.
  // Conflicting snapshots must not replace an already attributed provider request.
  if (recorded.some((call, index) => incoming[index] && !sameRequest(call, incoming[index]!))) return conflict();
  const calls = Array.from({ length: Math.max(recorded.length, incoming.length) }, (_, index) => {
    const previous = recorded[index], next = incoming[index];
    if (!previous) return next!;
    if (!next) return previous;
    return { ...previous,
      ...(previous.callId === undefined && next.callId !== undefined ? { callId: next.callId } : {}),
      providerModel: previous.providerModel ?? next.providerModel,
      providerRequestId: previous.providerRequestId ?? next.providerRequestId,
      usage: mergeUsage(previous.usage, next.usage), cost: previous.cost ?? next.cost };
  });
  // Older attempts may predate evidence capture; do not invent their model or prompt.
  const merged = { model: "unknown", promptVersion: "unknown", ...evidence, calls };
  return isDeepStrictEqual(evidence, merged) ? evidence! : merged;
}

/** Append an intent once; conflicting reuse of its id is never another approved send. */
export function mergePreparedCall(
  evidence: AnalysisAttemptEvidence | null | undefined,
  preparation: ImageAnalyzerCallPreparation,
): AnalysisAttemptEvidence | false {
  if (!preparation.callId || !preparation.preparedAt || !preparation.configuredModel) return false;
  const recorded = evidence?.preparedCalls ?? [];
  const previous = recorded.find(call => call.callId === preparation.callId);
  if (previous) return isDeepStrictEqual(previous, preparation) ? evidence! : false;
  if (evidence?.calls?.some(call => call.callId === preparation.callId
    && call.configuredModel !== preparation.configuredModel)) return false;
  return { model: "unknown", promptVersion: "unknown", ...evidence, preparedCalls: [...recorded, { ...preparation }] };
}

function sameRequest(previous: ImageAnalyzerCall, next: ImageAnalyzerCall): boolean {
  return previous.startedAt === next.startedAt && previous.configuredModel === next.configuredModel
    && (previous.callId === undefined || next.callId === undefined || previous.callId === next.callId)
    && (previous.providerRequestId === null || next.providerRequestId === null || previous.providerRequestId === next.providerRequestId)
    && !["promptTokens", "completionTokens", "totalTokens", "promptCacheHitTokens", "promptCacheMissTokens"].some(key => {
      const field = key as keyof ImageAnalyzerUsage;
      const recorded = previous.usage?.[field], incoming = next.usage?.[field];
      return recorded != null && incoming != null && recorded !== incoming;
    });
}

function mergeUsage(previous: ImageAnalyzerUsage | null, next: ImageAnalyzerUsage | null): ImageAnalyzerUsage | null {
  if (!previous) return next;
  if (!next) return previous;
  return { ...next, ...previous,
    promptTokens: previous.promptTokens ?? next.promptTokens,
    completionTokens: previous.completionTokens ?? next.completionTokens,
    totalTokens: previous.totalTokens ?? next.totalTokens,
    ...(previous.promptCacheHitTokens == null && next.promptCacheHitTokens !== undefined ? { promptCacheHitTokens: next.promptCacheHitTokens } : {}),
    ...(previous.promptCacheMissTokens == null && next.promptCacheMissTokens !== undefined ? { promptCacheMissTokens: next.promptCacheMissTokens } : {}) };
}
