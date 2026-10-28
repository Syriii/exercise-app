import { ImageAnalysisError } from "./errors.js";
import type { MealImageInputContext } from "./types.js";

export const contextualImagePromptVersion = "meal-image-context-2026-10-28.1";
export const maximumReferencePhotos = 8;

/** Only explicitly supplied material for this meal belongs in model context. */
export function validateImageInputContext(value: unknown): MealImageInputContext | null {
  if (value === undefined || value === null) return null;
  const invalid = () => new ImageAnalysisError("invalid_image_context", "请核对照片用途、说明和参考照片", 400);
  if (typeof value !== "object" || Array.isArray(value)) throw invalid();
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some(key => !["role", "note", "referenceAnalysisIds"].includes(key))
    || !["meal", "before", "after", "label", "detail"].includes(String(raw.role))
    || !(raw.note === null || typeof raw.note === "string")
    || (typeof raw.note === "string" && raw.note.length > 2_000)
    || !Array.isArray(raw.referenceAnalysisIds) || raw.referenceAnalysisIds.length > maximumReferencePhotos
    || raw.referenceAnalysisIds.some(id => typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
    || new Set(raw.referenceAnalysisIds).size !== raw.referenceAnalysisIds.length) throw invalid();
  return { role: raw.role as MealImageInputContext["role"], note: typeof raw.note === "string" ? raw.note.trim() || null : null,
    referenceAnalysisIds: [...raw.referenceAnalysisIds] as string[] };
}

export function decodeImageContextHeader(value: string | string[] | undefined): MealImageInputContext | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || value.length > 24_000) throw new ImageAnalysisError("invalid_image_context", "照片说明格式不正确", 400);
  try { return validateImageInputContext(JSON.parse(decodeURIComponent(value))); }
  catch { throw new ImageAnalysisError("invalid_image_context", "照片说明格式不正确", 400); }
}
