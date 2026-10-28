import type { ImageAnalyzerCall, ImageAnalyzerCallPreparation, ImageAnalyzerObserver } from "../modules/image-analysis/analyzer.js";

export interface EvaluationLogWriter {
  writeFile(record: string): Promise<void>;
  sync(): Promise<void>;
}

export type EvaluationProviderLogRecord =
  | ({ type: "provider_request_prepared"; id: string; dispatchState: "unconfirmed" } & ImageAnalyzerCallPreparation)
  | { type: "provider_calls_recorded"; id: string; callId: string | null; calls: readonly ImageAnalyzerCall[] };

/** A bounded observer wait may fail before the underlying I/O rejects. */
export function shouldStopEvaluationForLogFailure(error: unknown, writerFailure: Error | null): boolean {
  if (writerFailure) return true;
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return code === "deepseek_call_preparation_failed" || code === "deepseek_call_recording_failed";
}

/** Both callbacks must be durable before the analyzer may continue. */
export function createEvaluationProviderObserver(writer: EvaluationLogWriter, sampleId: string) {
  let failure: Error | null = null;
  async function record(value: EvaluationProviderLogRecord) {
    if (failure) throw failure;
    try {
      await writer.writeFile(JSON.stringify(value) + "\n");
      await writer.sync();
    } catch {
      failure = new Error("evaluation_provider_log_failed");
      throw failure;
    }
  }
  const observer: ImageAnalyzerObserver = {
    async beforeRequest(preparation) {
      const { callId, preparedAt, configuredModel } = preparation;
      await record({ type: "provider_request_prepared", id: sampleId, callId, preparedAt, configuredModel, dispatchState: "unconfirmed" });
      return true;
    },
    async afterRequest(calls) {
      await record({ type: "provider_calls_recorded", id: sampleId, callId: calls.at(-1)?.callId ?? null, calls });
    },
  };
  return { observer, get failure() { return failure; } };
}

/** Read-only recovery aid: a prepared intent alone proves neither dispatch nor billing. */
export function unresolvedEvaluationProviderRequests(records: readonly unknown[]) {
  const prepared = new Map<string, ImageAnalyzerCallPreparation & { id: string }>();
  const recorded = new Set<string>();
  const key = (sampleId: string, callId: string) => JSON.stringify([sampleId, callId]);
  for (const entry of records) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.id !== "string") continue;
    if (record.type === "provider_request_prepared" && typeof record.callId === "string"
      && typeof record.preparedAt === "string" && typeof record.configuredModel === "string") {
      prepared.set(key(record.id, record.callId), {
        id: record.id, callId: record.callId, preparedAt: record.preparedAt, configuredModel: record.configuredModel,
      });
    }
  }
  // Preparation and cumulative completion records may be delivered out of order.
  for (const entry of records) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    if (record.type !== "provider_calls_recorded" || typeof record.id !== "string" || !Array.isArray(record.calls)) continue;
    for (const entry of record.calls) {
      if (typeof entry !== "object" || entry === null) continue;
      const call = entry as Record<string, unknown>;
      if (typeof call.callId !== "string") continue;
      const id = key(record.id, call.callId), preparation = prepared.get(id);
      if (preparation && completeCallMatchesPreparation(call, preparation)) recorded.add(id);
    }
  }
  return [...prepared].filter(([id]) => !recorded.has(id)).map(([, record]) => ({
    id: record.id, callId: record.callId, preparedAt: record.preparedAt, configuredModel: record.configuredModel,
    dispatchState: "unconfirmed" as const, outcome: "unknown" as const, usage: null, cost: null,
  }));
}

function completeCallMatchesPreparation(call: Record<string, unknown>, preparation: ImageAnalyzerCallPreparation): boolean {
  const nullableText = (value: unknown) => value === null || typeof value === "string";
  const nullableRecord = (value: unknown) => value === null || (typeof value === "object" && !Array.isArray(value));
  return call.configuredModel === preparation.configuredModel
    && typeof call.startedAt === "string" && Number.isFinite(Date.parse(call.startedAt))
    && typeof call.durationMs === "number" && Number.isFinite(call.durationMs) && call.durationMs >= 0
    && typeof call.status === "string" && (call.status === "succeeded" || /^deepseek_[a-z0-9_]+$/.test(call.status))
    && nullableText(call.providerModel) && nullableText(call.providerRequestId)
    && nullableRecord(call.usage) && nullableRecord(call.cost);
}
