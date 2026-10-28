import { apiRequest, uploadBinary } from "../../api/client";
import type { MealImageAnalysis } from "../../api/nutrition";

export type PhotoRole = "meal" | "before" | "after" | "label" | "detail";
export interface PhotoEvidenceDraft {
  busy: boolean;
  file: File | undefined;
  role: Exclude<PhotoRole, "meal">;
  note: string;
  primaryId: string;
  referenceIds: string[];
  consent: boolean;
}
export const photoRoleLabels: Record<PhotoRole, string> = { meal: "餐食", before: "餐前", after: "餐后剩余", label: "包装标签", detail: "食物细节" };
export function createPhotoEvidenceDraft(): PhotoEvidenceDraft { return { busy: false, file: undefined, role: "before", note: "", primaryId: "", referenceIds: [], consent: false }; }
export function hasPhotoEvidenceDraft(draft: PhotoEvidenceDraft): boolean { return Boolean(draft.busy || draft.file || draft.note.trim() || draft.referenceIds.length || draft.consent); }
export function clearPhotoEvidenceDraft(draft: PhotoEvidenceDraft): void { Object.assign(draft, createPhotoEvidenceDraft()); }
export function uploadPhotoEvidence(mealId: string, file: File, role: PhotoEvidenceDraft["role"], note: string, progress: (value: number) => void) {
  return uploadBinary<MealImageAnalysis>(`/api/v1/image-analyses?mealId=${encodeURIComponent(mealId)}`, file, progress, {
    "x-meal-photo-context": encodeURIComponent(JSON.stringify({ role, note: note.trim() || null, referenceAnalysisIds: [] })),
  });
}
export function analyzePhotoEvidence(primary: MealImageAnalysis, draft: PhotoEvidenceDraft) {
  return apiRequest<MealImageAnalysis>(`/api/v1/image-analyses/${primary.id}/${primary.status === "succeeded" ? "reanalyze" : "retry"}`, {
    method: "POST", body: JSON.stringify({ revision: primary.revision, consent: true, inputContext: {
      role: primary.inputContext?.role ?? "meal", note: draft.note.trim() || null, referenceAnalysisIds: draft.referenceIds.filter(id => id !== primary.id),
    } }),
  });
}
