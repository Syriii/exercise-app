import type { ImageNutritionCandidate } from "./types.js";

export interface ImageAnalyzerUsage {
  readonly promptTokens: number | null;
  readonly completionTokens: number | null;
  readonly totalTokens: number | null;
  readonly promptCacheHitTokens?: number | null;
  readonly promptCacheMissTokens?: number | null;
}

export interface ImageAnalyzerCall {
  /** Application-generated ID for one physical provider request; absent on legacy evidence. */
  readonly callId?: string;
  readonly startedAt: string;
  readonly configuredModel: string;
  readonly providerModel: string | null;
  readonly providerRequestId: string | null;
  readonly status: string;
  readonly usage: ImageAnalyzerUsage | null;
  readonly cost: import("./deepseek-pricing.js").DeepSeekCostEstimate | null;
  readonly durationMs: number;
}

/** A durable preparation is an intent, not proof that a request was sent or charged. */
export interface ImageAnalyzerCallPreparation {
  readonly callId: string;
  readonly preparedAt: string;
  readonly configuredModel: string;
}

export interface ImageAnalyzerObserver {
  /** Must finish before dispatch. False means the original business work is no longer active. */
  beforeRequest(preparation: ImageAnalyzerCallPreparation): Promise<boolean>;
  /** One execution's complete ordered terminal call snapshot, persisted before any retry. */
  afterRequest(calls: readonly ImageAnalyzerCall[]): Promise<void>;
}

export interface ImageAnalyzerResult {
  readonly candidate: ImageNutritionCandidate;
  readonly providerRequestId: string | null;
  readonly providerModel?: string | null;
  readonly finishReason?: string | null;
  readonly usage?: ImageAnalyzerUsage | null;
  readonly durationMs?: number;
  readonly calls?: readonly ImageAnalyzerCall[];
}

export interface ImageAnalyzer {
  readonly model: string;
  analyze(contentType: string, image: Buffer, observer?: ImageAnalyzerObserver): Promise<ImageAnalyzerResult>;
}
