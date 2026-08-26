import type { StoredTemporaryMedia } from "../media/temporary-media-store.js";
import type { AnalysisWorkItem, ImageNutritionCandidate, MealImageAnalysis } from "./types.js";

export interface ImageAnalysisRepository {
  getUsage(userId: string): Promise<{ readonly activeAnalyses: number; readonly temporaryMediaBytes: number }>;
  create(userId: string, mealId: string, contentType: string, stored: StoredTemporaryMedia, expiresAt: Date, model: string, promptVersion: string): Promise<MealImageAnalysis>;
  list(userId: string, mealId: string): Promise<readonly MealImageAnalysis[]>;
  get(userId: string, analysisId: string): Promise<MealImageAnalysis | null>;
  getWorkItem(analysisId: string): Promise<AnalysisWorkItem | null>;
  beginAttempt(analysisId: string): Promise<{ work: AnalysisWorkItem; attemptId: string } | "not_found" | "not_ready">;
  succeed(analysisId: string, attemptId: string, candidate: ImageNutritionCandidate, providerRequestId: string | null): Promise<{ readonly status: "succeeded"; readonly tentativeHandled: boolean } | "not_running">;
  fail(analysisId: string, attemptId: string, errorCode: string): Promise<void>;
  retry(userId: string, analysisId: string, expectedRevision: number): Promise<MealImageAnalysis | "not_found" | "not_failed" | "revision_conflict">;
  markAdopted(userId: string, analysisId: string, expectedRevision: number): Promise<MealImageAnalysis | "not_found" | "not_ready" | "revision_conflict">;
  markMediaStatus(mediaId: string, status: "available" | "deletion_pending" | "deleted" | "missing"): Promise<void>;
}
