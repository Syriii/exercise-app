export type ImageAnalysisErrorCode = "image_analysis_unavailable" | "invalid_image" | "image_too_large" | "image_analysis_capacity_reached" | "temporary_media_quota_reached" | "meal_not_found" | "analysis_not_found" | "analysis_not_ready" | "analysis_revision_conflict";
export class ImageAnalysisError extends Error {
  public constructor(public readonly code: ImageAnalysisErrorCode, message: string, public readonly statusCode: number) { super(message); }
}
