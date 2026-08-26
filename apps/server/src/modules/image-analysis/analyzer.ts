import type { ImageNutritionCandidate } from "./types.js";

export interface ImageAnalyzerResult {
  readonly candidate: ImageNutritionCandidate;
  readonly providerRequestId: string | null;
}

export interface ImageAnalyzer {
  readonly model: string;
  analyze(contentType: string, image: Buffer): Promise<ImageAnalyzerResult>;
}
