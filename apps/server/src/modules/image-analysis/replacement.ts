import type { MealContribution } from "../nutrition/types.js";

export interface ImageReplacementState {
  operationId: string;
  mealRevision: number;
  undone: boolean;
}
export interface StoredImageReplacement extends ImageReplacementState {
  previousOperationIds?: string[];
  replaceIds: string[];
  before: readonly MealContribution[];
  addedIds: string[];
}
export function startsNewReplacement(value: StoredImageReplacement | null | undefined, input: ImageReplacementInput, undo: boolean) {
  return !!value?.undone && !undo && value.operationId !== input.operationId && !value.previousOperationIds?.includes(input.operationId);
}
export interface ImageReplacementInput {
  operationId: string;
  analysisRevision: number;
  mealRevision: number;
  replaceIds: string[];
}
export function publicReplacement(value: StoredImageReplacement | null): ImageReplacementState | null {
  return value === null ? null : { operationId: value.operationId, mealRevision: value.mealRevision, undone: value.undone };
}
export function sameReplacement(value: StoredImageReplacement, input: ImageReplacementInput) {
  return value.operationId === input.operationId && JSON.stringify([...value.replaceIds].sort()) === JSON.stringify([...input.replaceIds].sort());
}
