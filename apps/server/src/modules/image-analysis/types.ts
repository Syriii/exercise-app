export type ImageAnalysisStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled";
export type AnalysisAttemptStatus = "running" | "succeeded" | "failed";

export interface ImageNutritionCandidate {
  readonly title: string;
  readonly observedFoods: readonly { readonly label: string; readonly estimatedPortion: string | null; readonly note: string | null }[];
  readonly energyKcal: number | null;
  readonly proteinGrams: number | null;
  readonly carbohydrateGrams: number | null;
  readonly fatGrams: number | null;
  readonly confidence: "low" | "medium" | "high";
  readonly assumptions: readonly string[];
  readonly uncertaintyNote: string;
}

export interface ImageAnalysisAttempt {
  readonly id: string;
  readonly sequence: number;
  readonly status: AnalysisAttemptStatus;
  readonly providerRequestId: string | null;
  readonly errorCode: string | null;
  readonly startedAt: Date;
  readonly finishedAt: Date | null;
}

export interface MealImageAnalysis {
  readonly id: string;
  readonly mealId: string;
  readonly status: ImageAnalysisStatus;
  readonly model: string;
  readonly promptVersion: string;
  readonly candidate: ImageNutritionCandidate | null;
  readonly lastErrorCode: string | null;
  readonly imageAvailable: boolean;
  readonly adoptedAt: Date | null;
  readonly revision: number;
  readonly attempts: readonly ImageAnalysisAttempt[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface AnalysisWorkItem extends MealImageAnalysis {
  readonly userId: string;
  readonly mediaId: string;
  readonly objectKey: string;
  readonly contentType: string;
}
