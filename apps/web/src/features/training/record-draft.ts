import type { TrainingRecordInput, TrainingSession, TrainingSessionItem, TrainingSetInput, TrainingTemplateItem } from "../../api/training";
import { submissionId } from "../../support/submission-id";

export type Measurement = "sets" | "activity" | "count" | "unknown" | "mixed";
export interface SetDraft { reps: string; weightKg: string; durationSeconds: string; distanceMeters: string; note: string }
export interface ActionDraft { id: string; name: string; note: string; measurement: Measurement; count: string; expanded: boolean; sets: SetDraft[] }
export interface RecordDraft { id: string; revision: number; localDate: string; timeZone: string; time: string; note: string; items: ActionDraft[] }
export const blankSet = (): SetDraft => ({ reps: "", weightKg: "", durationSeconds: "", distanceMeters: "", note: "" });
export const blankAction = (name = ""): ActionDraft => ({ id: submissionId(), name, note: "", measurement: "sets", count: "", expanded: false, sets: [blankSet()] });
export function emptyRecord(date: string): RecordDraft {
  return { id: submissionId(), revision: 0, localDate: date, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", time: "", note: "", items: [] };
}
function setDraft(set: TrainingSetInput): SetDraft {
  return { reps: set.reps?.toString() ?? "", weightKg: set.weightKg === null ? "" : String(Number(set.weightKg)),
    durationSeconds: set.durationSeconds?.toString() ?? "", distanceMeters: set.distanceMeters === null ? "" : String(Number(set.distanceMeters)), note: set.note ?? "" };
}
export function actionFromActual(item: TrainingSessionItem): ActionDraft {
  const sets = item.sets.map(setDraft);
  const measurement = item.measurement ?? (sets.some(set => set.durationSeconds || set.distanceMeters) ? "mixed" : "sets");
  const same = sets.every(set => JSON.stringify(set) === JSON.stringify(sets[0]));
  return { id: item.id, name: item.performedExerciseName ?? item.exerciseName, note: item.actualNote ?? "",
    measurement: sets.length ? measurement : "unknown", count: sets.length ? String(sets.length) : "",
    expanded: !same || measurement === "mixed", sets: sets.length ? sets : [blankSet()] };
}
export function recordFromActual(session: TrainingSession): RecordDraft {
  return { id: session.id, revision: session.revision, localDate: session.localDate, timeZone: session.timeZone,
    time: session.recordedTime ?? "", note: session.note ?? "", items: session.items.filter(item => item.status === "completed").map(actionFromActual) };
}
export function actionFromPlan(item: TrainingTemplateItem): ActionDraft {
  const action = blankAction(item.exerciseName);
  action.measurement = item.targetDurationSeconds !== null || item.targetDistanceMeters !== null ? "activity" : "sets";
  action.count = item.targetSets?.toString() ?? "";
  const set = action.sets[0]!;
  // A range is not an actual count: only carry an exact target; otherwise leave it unknown.
  set.reps = item.targetRepsMin !== null && item.targetRepsMin === item.targetRepsMax ? String(item.targetRepsMin) : "";
  set.weightKg = item.targetWeightKg === null ? "" : String(Number(item.targetWeightKg));
  set.durationSeconds = item.targetDurationSeconds?.toString() ?? "";
  set.distanceMeters = item.targetDistanceMeters === null ? "" : String(Number(item.targetDistanceMeters));
  return action;
}
export function expandSets(item: ActionDraft) {
  if (item.expanded) return;
  const count = Number(item.count);
  if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error("请先填写 1–100 组，再调整各组差异。");
  item.sets = Array.from({ length: count }, () => ({ ...item.sets[0]! }));
  item.expanded = true;
}
function integer(value: string, label: string): number | null {
  if (!value.trim()) return null;
  const result = Number(value);
  if (!Number.isInteger(result) || result < 0) throw new Error(`${label}请填写非负整数，未知可留空。`);
  return result;
}
function decimal(value: string): string | null { return value.trim() || null; }
export function recordPayload(draft: RecordDraft): TrainingRecordInput {
  if (!draft.items.length) throw new Error("请至少添加一个实际做过的动作。");
  return { revision: draft.revision, localDate: draft.localDate, timeZone: draft.timeZone, recordedTime: draft.time || null,
    note: draft.note.trim() || null, items: draft.items.map(item => {
      if (!item.name.trim()) throw new Error("请为每个动作填写名称；输入已保留。");
      let sets: SetDraft[] = [];
      if (item.measurement !== "unknown") {
        if (item.measurement === "sets" && !item.expanded) {
          const count = integer(item.count, "组数");
          if (count === null) {
            if (Object.values(item.sets[0]!).some(Boolean)) throw new Error(`${item.name}：组数未知时可选择“只记次数”或“只记动作”。`);
          } else {
            if (count < 1 || count > 100) throw new Error("组数需为 1–100。");
            sets = Array.from({ length: count }, () => item.sets[0]!);
          }
        } else sets = item.sets;
      }
      return { id: item.id, exerciseName: item.name.trim(), actualNote: item.note.trim() || null, measurement: item.measurement,
        sets: sets.map(set => ({ reps: item.measurement === "activity" ? null : integer(set.reps, "次数"),
          weightKg: item.measurement === "activity" ? null : decimal(set.weightKg),
          durationSeconds: ["activity", "mixed"].includes(item.measurement) ? integer(set.durationSeconds, "秒数") : null,
          distanceMeters: ["activity", "mixed"].includes(item.measurement) ? decimal(set.distanceMeters) : null,
          note: set.note.trim() || null })) };
    }) };
}
export function actionSummary(item: TrainingSessionItem): string {
  if (!item.sets.length) return "数量未记录";
  const parts: string[] = [];
  if (item.measurement === "sets" || (!item.measurement && item.sets.every(set => set.durationSeconds === null && set.distanceMeters === null))) parts.push(`${item.sets.length} 组`);
  if (item.sets.some(set => set.reps !== null)) parts.push(`${item.sets.map(set => set.reps ?? "—").join(" / ")} 次`);
  if (item.sets.some(set => set.weightKg !== null)) parts.push(`${item.sets.map(set => set.weightKg === null ? "—" : Number(set.weightKg)).join(" / ")} kg`);
  if (item.sets.some(set => set.durationSeconds !== null)) parts.push(`${item.sets.map(set => set.durationSeconds ?? "—").join(" / ")} 秒`);
  if (item.sets.some(set => set.distanceMeters !== null)) parts.push(`${item.sets.map(set => set.distanceMeters === null ? "—" : Number(set.distanceMeters)).join(" / ")} 米`);
  return parts.join(" · ") || "数量未记录";
}
