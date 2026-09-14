import type { TrainingItemProgress, TrainingSchedule } from "../../api/training";
export function progressSummary(plan: TrainingSchedule) {
  if (!plan.items) return "旧安排尚未保存独立内容，请先核对当天计划";
  if (!plan.items.length) return "仅安排主题，未设置动作目标";
  const progress = plan.progress ?? [];
  const complete = progress.filter(item => item.status === "complete").length;
  const partial = progress.filter(item => item.status === "partial").length;
  const unknown = progress.filter(item => item.status === "unknown").length;
  return `按计划量：${complete} 项完成，${partial} 项部分记录，${progress.length - complete - partial - unknown} 项未记录${unknown ? `，${unknown} 项数量不确定` : ""}`;
}
export function itemProgressText(value?: TrainingItemProgress) {
  if (!value) return "尚无进度信息";
  const unit = { sets: "组", seconds: "秒", meters: "米", none: "" }[value.unit];
  if (value.target === null) return "没有比较目标，只展示实际内容";
  if (value.status === "unknown") return `目标 ${value.target} ${unit}；实际数量未知`;
  return `已记录 ${value.actual ?? 0}／${value.target} ${unit} · 剩余 ${value.remaining} ${unit}`;
}
