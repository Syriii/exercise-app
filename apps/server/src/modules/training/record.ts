import { randomUUID } from "node:crypto";
import type { TrainingRecordInput, TrainingSession, TrainingSessionItem, TrainingTarget } from "./types.js";

const emptyTarget: TrainingTarget = { targetSets: null, targetRepsMin: null, targetRepsMax: null,
  targetWeightKg: null, targetDurationSeconds: null, targetDistanceMeters: null, note: null };

/** Same decision for PG and memory; callers serialize before reading the current revision. */
export function recordGate(existing: TrainingSession | null, input: TrainingRecordInput, hash: string) {
  if (existing?.deletedAt) return "missing";
  if (existing === null) return input.revision === 0 ? "write" : "missing";
  if (existing.recordWrite?.hash === hash && existing.recordWrite.baseRevision === input.revision
      && existing.revision === input.revision + 1) return "replay";
  return existing.revision === input.revision ? "write" : "conflict";
}

export function recordedSession(userId: string, id: string, existing: TrainingSession | null,
  input: TrainingRecordInput, hash: string, now: Date): TrainingSession {
  const prior = new Map(existing?.items.map(item => [item.id, item]) ?? []);
  const kept = new Set(input.items.map(item => item.id));
  const items: TrainingSessionItem[] = input.items.map((item, sortOrder) => {
    const old = prior.get(item.id);
    return { id: old?.id ?? randomUUID(), sourceTemplateItemId: old?.sourceTemplateItemId ?? null,
      origin: old?.origin ?? "extra", status: "completed", sortOrder,
      exerciseName: old?.exerciseName ?? item.exerciseName, performedExerciseName: item.exerciseName,
      target: old?.target ?? { ...emptyTarget }, actualNote: item.actualNote, measurement: item.measurement ?? "mixed",
      sets: item.sets.map((set, index) => ({ ...set, id: randomUUID(), sequence: index + 1 })) };
  });
  // Keep old rows and their revision history; removed actions no longer contribute facts.
  for (const item of existing?.items ?? []) if (!kept.has(item.id)) {
    items.push({ ...item, status: "skipped", sets: [], sortOrder: items.length });
  }
  return { id, userId, sourceScheduleId: existing?.sourceScheduleId ?? null,
    sourceScheduleTitle: existing?.sourceScheduleTitle ?? null, sourceTemplateId: existing?.sourceTemplateId ?? null,
    sourceTemplateName: existing?.sourceTemplateName ?? null, sourceProgramId: existing?.sourceProgramId ?? null,
    sourceProgramName: existing?.sourceProgramName ?? null, sourceProgramUnitId: existing?.sourceProgramUnitId ?? null,
    sourceWeekNumber: existing?.sourceWeekNumber ?? null, sourceTrainingDayName: existing?.sourceTrainingDayName ?? null,
    status: "completed", revision: input.revision + 1, localDate: input.localDate, timeZone: input.timeZone,
    recordedTime: input.recordedTime, recordWrite: { hash, baseRevision: input.revision,
      modes: Object.fromEntries(items.map(item => [item.id, item.measurement])) }, deletedAt: null,
    startedAt: existing?.startedAt ?? now, endedAt: existing?.endedAt ?? now, note: input.note,
    expenditureAssessment: null, createdAt: existing?.createdAt ?? now, updatedAt: now, items };
}
