import type { MealContribution, NutrientValues } from "./types.js";
import { NutritionError, type NutritionErrorCode } from "./errors.js";

export type IntakeQuantitySource = "measured" | "merchant" | "user_estimate" | "photo_estimate";
type QuantityNotes = { fraction?: number; note?: string };
export type IntakeQuantityInput =
  | ({ kind: "net_weight"; grams: number; excludedGrams?: number; source?: IntakeQuantitySource } & QuantityNotes)
  | ({ kind: "gross_tare"; grossGrams: number; tareGrams: number; excludedGrams?: number } & QuantityNotes)
  | ({ kind: "before_after"; beforeGrams: number; afterGrams: number; sameContainer: true; discardedGrams?: number } & QuantityNotes)
  | ({ kind: "count"; amount: number; unit: string; source?: IntakeQuantitySource } & QuantityNotes)
  | ({ kind: "photo_estimate"; amount: number; unit: string; reference: string } & QuantityNotes)
  | ({ kind: "dimensions"; shape: "box"; lengthCm: number; widthCm: number; heightCm: number; densityGramsPerMl: number; reference: string } & QuantityNotes)
  | ({ kind: "dimensions"; shape: "cylinder"; diameterCm: number; heightCm: number; densityGramsPerMl: number; reference: string } & QuantityNotes);
export type IntakeBasisInput =
  | { kind: "current_record" }
  | { kind: "label"; amount: number; unit: string; energyUnit: "kcal" | "kJ"; energy: number | null; proteinGrams: number | null; carbohydrateGrams: number | null; fatGrams: number | null; source: string };
export interface IntakeInput { mealRevision: number; contributionRevision: number; quantity: IntakeQuantityInput; basis: IntakeBasisInput }
export interface IntakeBasisSnapshot extends NutrientValues { kind: "current_record" | "label"; amount: number; unit: string; source: string }
export interface IntakeEquation { label: string; expression: string; result: number | null; unit: string }
export interface IntakeEvidence {
  version: "intake-v1";
  input: { quantity: IntakeQuantityInput; basis: IntakeBasisInput };
  amount: number;
  unit: string;
  quantitySource: IntakeQuantitySource;
  basis: IntakeBasisSnapshot;
  nutrients: NutrientValues;
  equations: IntakeEquation[];
  warnings: string[];
  recordedAt: string;
}
export type IntakePreview = IntakeEvidence;

const keys = ["energyKcal", "proteinGrams", "carbohydrateGrams", "fatGrams"] as const;
const fail = (message: string, code: NutritionErrorCode = "invalid_intake_input"): never => { throw new NutritionError(code, message, 400); };
const finite = (value: number, name: string, maximum = 100000): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > maximum) fail(`${name}必须是0–${maximum}的数字`);
  return value;
};
const positive = (value: number, name: string, maximum = 100000) => { finite(value, name, maximum); if (value === 0) fail(`${name}必须大于0`); return value; };
const text = (value: string, name: string, maximum = 1000) => { if (typeof value !== "string" || !value.trim() || value.length > maximum) fail(`请填写${name}`); return value.trim(); };
const round = (value: number) => Math.round(value * 1000) / 1000;
const unit = (value: string) => {
  const cleaned = text(value, "份量单位", 30);
  return ["克", "公克", "g"].includes(cleaned) ? "g" : ["毫升", "ml", "mL"].includes(cleaned) ? "ml" : cleaned;
};

/** Run before AJV coercion so a missing/unknown measurement can never become a measured zero. */
export function validateIntakeInput(input: unknown): asserts input is IntakeInput {
  if (!input || typeof input !== "object") fail("请填写食入依据");
  const data = input as Record<string, unknown>;
  for (const key of ["mealRevision", "contributionRevision"]) if (typeof data[key] !== "number" || !Number.isInteger(data[key]) || (data[key] as number) < 1) fail("请刷新餐食后重试");
  if (!data.quantity || typeof data.quantity !== "object" || !data.basis || typeof data.basis !== "object") fail("请填写份量和营养依据");
  const q = data.quantity as Record<string, unknown>, basis = data.basis as Record<string, unknown>;
  const required: Record<string, string[]> = { net_weight: ["grams"], gross_tare: ["grossGrams", "tareGrams"], before_after: ["beforeGrams", "afterGrams"], count: ["amount"], photo_estimate: ["amount"], dimensions: q.shape === "box" ? ["lengthCm", "widthCm", "heightCm", "densityGramsPerMl"] : ["diameterCm", "heightCm", "densityGramsPerMl"] };
  const fields = typeof q.kind === "string" ? required[q.kind] : undefined;
  if (!fields) return fail("不支持的份量依据");
  for (const key of fields) finite(q[key] as number, key);
  for (const key of ["excludedGrams", "discardedGrams", "fraction"]) if (q[key] !== undefined) finite(q[key] as number, key, key === "fraction" ? 1 : 100000);
  if (q.source !== undefined && !["measured", "merchant", "user_estimate", "photo_estimate"].includes(q.source as string)) fail("不支持的份量来源");
  if (basis.kind === "label") {
    positive(basis.amount as number, "营养基准量");
    for (const key of ["energy", "proteinGrams", "carbohydrateGrams", "fatGrams"]) if (basis[key] !== null) finite(basis[key] as number, key, 418400);
  } else if (basis.kind !== "current_record") fail("不支持的营养依据");
}

/** Deterministic quantity arithmetic; image dimensions/density remain explicit estimates. */
export function calculateIntake(item: MealContribution, input: Pick<IntakeInput, "quantity" | "basis">, at = new Date()): IntakeEvidence {
  const q = input.quantity;
  const equations: IntakeEquation[] = [], warnings: string[] = [];
  const fraction = q.fraction === undefined ? 1 : finite(q.fraction, "吃入比例", 1);
  if (q.note !== undefined && (typeof q.note !== "string" || q.note.length > 1000)) fail("补充说明不能超过1000字");
  let amount: number, outputUnit = "g", quantitySource: IntakeQuantitySource;
  switch (q.kind) {
    case "net_weight": {
      const grams = finite(q.grams, "净重"), excluded = finite(q.excludedGrams ?? 0, "未食用部分");
      amount = grams - excluded;
      quantitySource = q.source ?? "measured";
      equations.push({ label: "可食入重量", expression: `${grams} − ${excluded}`, result: amount, unit: "g" });
      break;
    }
    case "gross_tare": {
      const gross = finite(q.grossGrams, "含容器重量"), tare = finite(q.tareGrams, "容器重量"), excluded = finite(q.excludedGrams ?? 0, "未食用部分");
      amount = gross - tare - excluded; quantitySource = "measured";
      equations.push({ label: "可食入重量", expression: `${gross} − ${tare} − ${excluded}`, result: amount, unit: "g" });
      warnings.push("容器与未食用部分各扣除一次；未称量的皮核等不能假称实测。");
      break;
    }
    case "before_after": {
      if (q.sameContainer !== true) fail("餐前后差值需要相同容器和称量口径");
      const before = finite(q.beforeGrams, "餐前重量"), after = finite(q.afterGrams, "餐后重量"), discarded = finite(q.discardedGrams ?? 0, "另外倒掉或移走的重量");
      amount = before - after - discarded; quantitySource = "measured";
      equations.push({ label: "实际吃入重量", expression: `${before} − ${after} − ${discarded}`, result: amount, unit: "g" });
      warnings.push("相同容器重量已经抵消，餐后剩余已经扣除，不再重复扣皮重或剩汁。若只称整餐，总量不证明各食材重量。");
      break;
    }
    case "count":
      amount = finite(q.amount, "食物数量"); outputUnit = unit(q.unit); quantitySource = q.source ?? "user_estimate";
      equations.push({ label: "取用数量", expression: String(q.amount), result: amount, unit: outputUnit });
      break;
    case "photo_estimate":
      amount = finite(q.amount, "估计份量"); outputUnit = unit(q.unit); quantitySource = "photo_estimate";
      text(q.reference, "估计依据");
      equations.push({ label: "照片主估份量", expression: String(q.amount), result: amount, unit: outputUnit });
      warnings.push("照片份量为工作估值；参照、厚度及隐藏部分不能据此视为实测。");
      break;
    case "dimensions": {
      text(q.reference, "尺寸参照");
      const height = positive(q.heightCm, "平均厚度", 1000), density = positive(q.densityGramsPerMl, "估计密度", 30);
      let volume: number, expression: string;
      if (q.shape === "box") {
        const length = positive(q.lengthCm, "长度", 1000), width = positive(q.widthCm, "宽度", 1000);
        volume = length * width * height; expression = `${length} × ${width} × ${height}`;
      } else if (q.shape === "cylinder") {
        const diameter = positive(q.diameterCm, "直径", 1000);
        volume = Math.PI * (diameter / 2) ** 2 * height; expression = `π × (${diameter} ÷ 2)² × ${height}`;
      } else return fail("不支持的形状");
      amount = volume * density; quantitySource = "photo_estimate";
      equations.push({ label: "估计体积", expression, result: round(volume), unit: "ml" }, { label: "估计重量", expression: `${round(volume)} × ${density}`, result: round(amount), unit: "g" });
      warnings.push("尺寸参照、平均厚度和密度均为显式估计参数，计算小数不代表测量精度。");
      break;
    }
    default: return fail("不支持的份量依据");
  }
  if (amount < 0) fail("扣除后的食入量不能为负，请核对餐前后、皮重和未食用部分");
  const beforeFraction = amount;
  amount = round(finite(amount * fraction, "实际吃入量"));
  if (fraction !== 1) equations.push({ label: "按吃入比例", expression: `${round(beforeFraction)} × ${fraction}`, result: amount, unit: outputUnit });
  let basis: IntakeBasisSnapshot;
  if (input.basis.kind === "label") {
    const label = input.basis;
    const basisAmount = positive(label.amount, "营养基准量"), basisUnit = unit(label.unit);
    text(label.source, "营养来源");
    if (label.energyUnit !== "kcal" && label.energyUnit !== "kJ") fail("能量单位必须为kcal或kJ");
    const energy = label.energy === null ? null : finite(label.energy, "标签能量", label.energyUnit === "kJ" ? 418400 : 100000);
    const values = { energyKcal: energy === null ? null : label.energyUnit === "kJ" ? energy / 4.184 : energy,
      proteinGrams: label.proteinGrams, carbohydrateGrams: label.carbohydrateGrams, fatGrams: label.fatGrams };
    for (const k of keys) if (values[k] !== null) finite(values[k]!, k, k === "energyKcal" ? 100000 : 10000);
    basis = { kind: "label", amount: basisAmount, unit: basisUnit, source: label.source.trim(), ...values };
    if (label.energyUnit === "kJ" && energy !== null) equations.push({ label: "千焦换算千卡", expression: `${energy} ÷ 4.184`, result: round(values.energyKcal!), unit: "kcal" });
    warnings.push("标签数值由用户录入；基准量、每份/每100克及实际配方需保持一致。");
  } else if (input.basis.kind === "current_record") {
    const saved = item.foodSnapshot;
    const earlier = item.intakeEvidence?.basis;
    basis = saved && saved.basisAmount && saved.basisUnit
      ? { kind: "current_record", amount: saved.basisAmount, unit: unit(saved.basisUnit), source: saved.sourceName, energyKcal: saved.energyKcal, proteinGrams: saved.proteinGrams, carbohydrateGrams: saved.carbohydrateGrams, fatGrams: saved.fatGrams }
      : earlier ? structuredClone(earlier)
      : item.portionAmount !== null && item.portionAmount > 0 && item.portionUnit
        ? { kind: "current_record", amount: item.portionAmount, unit: unit(item.portionUnit), source: item.basisDescription || (item.source === "model_adopted" ? "当前照片估算记录" : "当前食物记录"), energyKcal: item.energyKcal, proteinGrams: item.proteinGrams, carbohydrateGrams: item.carbohydrateGrams, fatGrams: item.fatGrams }
        : fail("当前食物没有可换算的份量基准，请填写标签基准或先选择有依据的食物", "intake_basis_required");
    positive(basis.amount, "当前营养基准量");
  } else return fail("不支持的营养依据");
  if (basis.unit !== outputUnit) fail(`当前基准为${basis.unit}，食入量为${outputUnit}；缺少换算依据，请填写相同单位的标签或选择对应食物`, "intake_unit_mismatch");
  const nutrients = Object.fromEntries(keys.map(k => {
    const value = basis[k] === null ? null : round(basis[k]! * amount / basis.amount);
    if (value !== null) finite(value, k, k === "energyKcal" ? 100000 : 10000);
    equations.push({ label: k === "energyKcal" ? "能量" : k === "proteinGrams" ? "蛋白质" : k === "carbohydrateGrams" ? "碳水" : "脂肪", expression: basis[k] === null ? "基准未知，保持未知" : `${round(amount)} × ${round(basis[k]!)} ÷ ${basis.amount}`, result: value, unit: k === "energyKcal" ? "kcal" : "g" });
    return [k, value];
  })) as unknown as NutrientValues;
  if (item.mode !== "item" && keys.every(k => nutrients[k] === null)) fail("整餐需要至少一项已知营养；可以保留为单项食物再补充");
  if (item.source === "model_adopted" || quantitySource === "photo_estimate") warnings.push("重量来源与营养来源分开；照片或混合成品的用油和配方仍是估计，不重复另加油汁。");
  return { version: "intake-v1", input: structuredClone(input), amount: round(amount), unit: outputUnit, quantitySource, basis,
    nutrients, equations, warnings, recordedAt: at.toISOString() };
}
