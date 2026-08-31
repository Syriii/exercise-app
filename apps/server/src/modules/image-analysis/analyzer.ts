import type { ImageNutritionCandidate } from "./types.js";

export interface ImageAnalyzerUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

export interface ImageAnalyzerResult {
  readonly candidate: ImageNutritionCandidate;
  readonly providerRequestId: string | null;
  readonly providerModel?: string | null;
  readonly finishReason?: string | null;
  readonly usage?: ImageAnalyzerUsage | null;
  readonly durationMs?: number;
}

export interface ImageAnalyzer {
  readonly model: string;
  analyze(contentType: string, image: Buffer): Promise<ImageAnalyzerResult>;
}
