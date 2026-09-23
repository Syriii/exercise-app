import type { ImageNutritionCandidate } from "./types.js";

export interface ImageAnalyzerUsage {
  readonly promptTokens: number | null;
  readonly completionTokens: number | null;
  readonly totalTokens: number | null;
  readonly promptCacheHitTokens?: number | null;
  readonly promptCacheMissTokens?: number | null;
}

export interface ImageAnalyzerCall {
  readonly startedAt: string;
  readonly configuredModel: string;
  readonly providerModel: string | null;
  readonly providerRequestId: string | null;
  readonly status: string;
  readonly usage: ImageAnalyzerUsage | null;
  readonly cost: import("./deepseek-pricing.js").DeepSeekCostEstimate | null;
  readonly durationMs: number;
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
  analyze(contentType: string, image: Buffer): Promise<ImageAnalyzerResult>;
}
