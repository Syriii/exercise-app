import { TrainingError } from "./errors.js";
import type { TrainingPlanLink, TrainingRecordInput, TrainingSchedule, TrainingSession } from "./types.js";

export function scheduleSnapshot(schedule: TrainingSchedule) {
  return { revision: schedule.revision, localDate: schedule.localDate, title: schedule.title,
    note: schedule.note, items: schedule.items ?? null };
}

/** Run against locked, account-scoped schedules, after checking the record replay gate. */
export function resolvePlanLinks(input: TrainingRecordInput, existing: TrainingSession | null,
  schedules: readonly TrainingSchedule[]): Map<string, TrainingPlanLink> {
  const links = new Map<string, TrainingPlanLink>();
  for (const action of input.items) {
    const requested = action.planLink;
    if (!requested) continue;
    const prior = existing?.items.find(item => item.id === action.id)?.planLink;
    // Editing a historical fact retains its original context, even after cancellation/removal.
    // A date change detaches it permanently; moving back must not silently revive the link.
    if (prior && prior.scheduleId === requested.scheduleId && prior.itemId === requested.itemId
        && prior.revision === requested.revision) {
      if (input.localDate === prior.localDate && existing?.localDate === prior.localDate
          && action.exerciseName === prior.item.exerciseName) links.set(action.id, prior);
      continue;
    }
    const schedule = schedules.find(value => value.id === requested.scheduleId);
    if (!schedule) throw new TrainingError("training_schedule_not_found", "关联的日期计划不可用，请保留输入并取消关联后保存。", 404);
    const item = schedule.items?.find(value => value.id === requested.itemId);
    if (schedule.cancelledAt || schedule.localDate !== input.localDate || schedule.revision !== requested.revision || !item) {
      throw new TrainingError("training_revision_conflict", "日期计划已修改、改期或取消。输入已保留，请核对计划或取消关联后保存。", 409);
    }
    if (action.exerciseName === item.exerciseName) links.set(action.id, { ...requested, localDate: schedule.localDate, title: schedule.title, item });
  }
  return links;
}

export function scheduleProgress(schedule: TrainingSchedule, sessions: readonly TrainingSession[]): import("./types.js").TrainingItemProgress[] {
  return (schedule.items ?? []).map(plan => {
    const unit = plan.progressUnit;
    const target = unit === "sets" ? plan.targetSets : unit === "seconds" ? plan.targetDurationSeconds
      : unit === "meters" && plan.targetDistanceMeters !== null ? Number(plan.targetDistanceMeters) : null;
    const actions = sessions.filter(session => !session.deletedAt && session.localDate === schedule.localDate)
      .flatMap(session => session.items.filter(action => action.status === "completed"
        && (action.performedExerciseName ?? action.exerciseName) === plan.exerciseName
        && action.planLink?.scheduleId === schedule.id && action.planLink.itemId === plan.id
        && action.planLink.localDate === schedule.localDate));
    const unique = [...new Map(actions.map(action => [action.id, action])).values()];
    const values = unique.flatMap(action => {
      if (unit === "sets") return action.sets.length && (action.measurement === "sets" || action.measurement == null)
        ? [action.sets.length] : [];
      if (unit === "none") return [];
      return action.sets.flatMap(set => {
        const value = unit === "seconds" ? set.durationSeconds : set.distanceMeters;
        return value === null ? [] : [Number(value)];
      });
    });
    const actual = values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) * 1000) / 1000 : null;
    const status = schedule.cancelledAt || target === null ? "unknown" : !unique.length ? "unrecorded"
      : actual === null ? "unknown" : actual >= target ? "complete" : "partial";
    return { itemId: plan.id, unit, target, actual,
      remaining: target === null ? null : Math.max(0, Math.round((target - (actual ?? 0)) * 1000) / 1000), status };
  });
}
