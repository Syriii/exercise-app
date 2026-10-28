import type { IntakeEvidence, IntakeInput, IntakeQuantityInput, IntakeQuantitySource, Meal, MealContribution } from "../../api/nutrition";

export type IntakeMethod = "net_weight" | "gross_tare" | "before_after" | "count" | "photo_estimate" | "dimensions";
type Field = string | number;
export interface IntakeFields {
  method: IntakeMethod; netGrams: Field; grossGrams: Field; tareGrams: Field; beforeGrams: Field; afterGrams: Field; excludedGrams: Field; discardedGrams: Field;
  countAmount: Field; estimateAmount: Field; unit: string; fractionPercent: Field; source: IntakeQuantitySource; reference: string; note: string;
  sameContainer: boolean; shape: "box" | "cylinder"; lengthCm: Field; widthCm: Field; heightCm: Field; diameterCm: Field; density: Field;
  basisKind: "current_record" | "label"; labelAmount: Field; labelUnit: string; energyUnit: "kcal" | "kJ"; labelEnergy: Field; labelProtein: Field; labelCarbs: Field; labelFat: Field; labelSource: string;
}
export interface IntakeDraft { meal: Meal; item: MealContribution; fields: IntakeFields; preview: IntakeEvidence | null; previewKey: string | null; error: string; }
export const intakeMethodLabels: Record<IntakeMethod, string> = { net_weight: "已称净重", gross_tare: "含盒重量减皮重", before_after: "餐前、餐后差值", count: "按数量或生活份量", photo_estimate: "照片估计份量", dimensions: "尺寸与体积估计" };

export function newIntakeDraft(meal: Meal, item: MealContribution): IntakeDraft {
  const amount = item.portionAmount?.toString() ?? "";
  const draft: IntakeDraft = { meal, item, preview: null, previewKey: null, error: "", fields: {
    method: item.source === "model_adopted" ? "photo_estimate" : "count", netGrams: "", grossGrams: "", tareGrams: "", beforeGrams: "", afterGrams: "", excludedGrams: "", discardedGrams: "",
    countAmount: amount, estimateAmount: amount, unit: item.portionUnit ?? "g", fractionPercent: "100", source: "user_estimate", reference: item.basisDescription ?? "", note: "",
    sameContainer: false, shape: "box", lengthCm: "", widthCm: "", heightCm: "", diameterCm: "", density: "",
    basisKind: "current_record", labelAmount: "100", labelUnit: "g", energyUnit: "kcal", labelEnergy: "", labelProtein: "", labelCarbs: "", labelFat: "", labelSource: "",
  } };
  const input = item.intakeEvidence?.input;
  if (!input) return draft;
  const f = draft.fields; const q = input.quantity;
  f.method = q.kind; f.fractionPercent = String((q.fraction ?? 1) * 100); f.note = q.note ?? '';
  if (q.kind === 'net_weight') { f.netGrams = q.grams; f.excludedGrams = q.excludedGrams ?? ''; }
  if (q.kind === 'gross_tare') { f.grossGrams = q.grossGrams; f.tareGrams = q.tareGrams; f.excludedGrams = q.excludedGrams ?? ''; }
  if (q.kind === 'before_after') { f.beforeGrams = q.beforeGrams; f.afterGrams = q.afterGrams; f.sameContainer = q.sameContainer; f.discardedGrams = q.discardedGrams ?? ''; }
  if (q.kind === 'count') { f.countAmount = q.amount; f.unit = q.unit; f.source = q.source ?? 'user_estimate'; }
  if (q.kind === 'photo_estimate') { f.estimateAmount = q.amount; f.unit = q.unit; f.reference = q.reference; }
  if (q.kind === 'dimensions') {
    f.shape = q.shape; f.heightCm = q.heightCm; f.density = q.densityGramsPerMl; f.reference = q.reference;
    if (q.shape === 'box') { f.lengthCm = q.lengthCm; f.widthCm = q.widthCm; } else f.diameterCm = q.diameterCm;
  }
  const b = input.basis;
  if (b.kind === 'label') {
    f.basisKind = 'label'; f.labelAmount = b.amount; f.labelUnit = b.unit; f.energyUnit = b.energyUnit; f.labelEnergy = b.energy ?? '';
    f.labelProtein = b.proteinGrams ?? ''; f.labelCarbs = b.carbohydrateGrams ?? ''; f.labelFat = b.fatGrams ?? ''; f.labelSource = b.source;
  }
  return draft;
}

export function retainedIntakeInputs(draft: IntakeDraft): Array<{ label: string; value: string }> {
  const f = draft.fields; const rows: Array<{ label: string; value: string }> = [];
  const add = (label: string, value: Field, unit = '') => rows.push({ label, value: String(value).trim() === '' ? '未填写' : `${value}${unit ? ` ${unit}` : ''}` });
  if (f.method === 'net_weight') add('食物净重', f.netGrams, 'g');
  if (f.method === 'gross_tare') { add('含盒重量', f.grossGrams, 'g'); add('容器重量', f.tareGrams, 'g'); }
  if (f.method === 'before_after') { add('餐前重量', f.beforeGrams, 'g'); add('餐后重量', f.afterGrams, 'g'); add('同一容器确认', f.sameContainer ? '已确认' : '未确认'); add('另外倒掉', f.discardedGrams, 'g'); }
  if (f.method === 'count') add('取用数量', f.countAmount, f.unit);
  if (f.method === 'photo_estimate') { add('照片估计份量', f.estimateAmount, f.unit); add('估计依据', f.reference); }
  if (f.method === 'dimensions') {
    if (f.shape === 'box') { add('长度', f.lengthCm, 'cm'); add('宽度', f.widthCm, 'cm'); } else add('直径', f.diameterCm, 'cm');
    add('平均厚度', f.heightCm, 'cm'); add('估计密度', f.density, 'g/ml'); add('尺寸和密度依据', f.reference);
  }
  if (f.method === 'net_weight' || f.method === 'gross_tare') add('另外未食用', f.excludedGrams, 'g');
  add('实际吃入比例', f.fractionPercent, '%');
  if (f.note) add('补充说明', f.note);
  if (f.basisKind === 'label') {
    add('标签基准量', f.labelAmount, f.labelUnit); add('标签能量', f.labelEnergy, f.energyUnit);
    add('标签蛋白质', f.labelProtein, 'g'); add('标签碳水', f.labelCarbs, 'g'); add('标签脂肪', f.labelFat, 'g'); add('标签来源', f.labelSource);
  } else add('营养依据', '这项食物已有的营养基准');
  return rows;
}

/** Only converts visible input units; quantity and nutrient calculations remain on the server. */
export function intakeInput(draft: IntakeDraft): IntakeInput {
  const f = draft.fields;
  const number = (value: Field, name: string): number => {
    if (String(value).trim() === "" || !Number.isFinite(Number(value))) throw new Error(`请填写${name}`);
    return Number(value);
  };
  const optional = (value: Field) => String(value).trim() === "" ? undefined : number(value, "数值");
  const nullable = (value: Field) => String(value).trim() === "" ? null : number(value, "标签数值");
  const notes = { fraction: number(f.fractionPercent, "实际吃入比例") / 100, ...(f.note.trim() ? { note: f.note.trim() } : {}) };
  let quantity: IntakeQuantityInput;
  switch (f.method) {
    case "net_weight": quantity = { kind: f.method, grams: number(f.netGrams, "食物净重"), excludedGrams: optional(f.excludedGrams), source: "measured", ...notes }; break;
    case "gross_tare": quantity = { kind: f.method, grossGrams: number(f.grossGrams, "含盒重量"), tareGrams: number(f.tareGrams, "容器重量"), excludedGrams: optional(f.excludedGrams), ...notes }; break;
    case "before_after":
      if (!f.sameContainer) throw new Error("请确认餐前、餐后使用相同容器和称量口径");
      quantity = { kind: f.method, beforeGrams: number(f.beforeGrams, "餐前重量"), afterGrams: number(f.afterGrams, "餐后重量"), sameContainer: true, discardedGrams: optional(f.discardedGrams), ...notes }; break;
    case "count": quantity = { kind: f.method, amount: number(f.countAmount, "取用数量"), unit: f.unit.trim(), source: f.source, ...notes }; break;
    case "photo_estimate": quantity = { kind: f.method, amount: number(f.estimateAmount, "照片估计份量"), unit: f.unit.trim(), reference: f.reference.trim(), ...notes }; break;
    case "dimensions": quantity = f.shape === "box"
      ? { kind: f.method, shape: "box", lengthCm: number(f.lengthCm, "长度"), widthCm: number(f.widthCm, "宽度"), heightCm: number(f.heightCm, "平均厚度"), densityGramsPerMl: number(f.density, "估计密度"), reference: f.reference.trim(), ...notes }
      : { kind: f.method, shape: "cylinder", diameterCm: number(f.diameterCm, "直径"), heightCm: number(f.heightCm, "平均厚度"), densityGramsPerMl: number(f.density, "估计密度"), reference: f.reference.trim(), ...notes }; break;
  }
  return { mealRevision: draft.meal.revision, contributionRevision: draft.item.revision, quantity,
    basis: f.basisKind === "current_record" ? { kind: "current_record" } : { kind: "label", amount: number(f.labelAmount, "标签基准量"), unit: f.labelUnit.trim(), energyUnit: f.energyUnit,
      energy: nullable(f.labelEnergy), proteinGrams: nullable(f.labelProtein), carbohydrateGrams: nullable(f.labelCarbs), fatGrams: nullable(f.labelFat), source: f.labelSource.trim() } };
}
