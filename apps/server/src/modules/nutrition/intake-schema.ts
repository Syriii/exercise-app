const numeric = { type: "number", minimum: 0, maximum: 100000 } as const;
const nullableNutrient = { type: "number", nullable: true, minimum: 0, maximum: 418400 } as const;
const shortText = { type: "string", minLength: 1, maxLength: 1000 } as const;
const unit = { type: "string", minLength: 1, maxLength: 30 } as const;
const source = { type: "string", enum: ["measured", "merchant", "user_estimate", "photo_estimate"] } as const;
const choice = (kind: string, required: string[], properties = {}) => ({ type: "object", required: ["kind", ...required], properties: { kind: { const: kind }, ...properties } });
// Keep properties on the containing object: AJV removeAdditional must not strip another union branch's fields.
export const intakeQuantitySchema = { type: "object", additionalProperties: false, required: ["kind"], properties: {
  kind: { type: "string", enum: ["net_weight", "gross_tare", "before_after", "count", "photo_estimate", "dimensions"] },
  fraction: { type: "number", minimum: 0, maximum: 1 }, note: { type: "string", maxLength: 1000 }, source,
  grams: numeric, excludedGrams: numeric, grossGrams: numeric, tareGrams: numeric, beforeGrams: numeric, afterGrams: numeric,
  sameContainer: { type: "boolean", const: true }, discardedGrams: numeric, amount: numeric, unit, reference: shortText,
  shape: { type: "string", enum: ["box", "cylinder"] }, lengthCm: numeric, widthCm: numeric, heightCm: numeric,
  diameterCm: numeric, densityGramsPerMl: numeric,
}, anyOf: [choice("net_weight", ["grams"]), choice("gross_tare", ["grossGrams", "tareGrams"]),
  choice("before_after", ["beforeGrams", "afterGrams", "sameContainer"]), choice("count", ["amount", "unit"]),
  choice("photo_estimate", ["amount", "unit", "reference"]),
  choice("dimensions", ["shape", "lengthCm", "widthCm", "heightCm", "densityGramsPerMl", "reference"], { shape: { const: "box" } }),
  choice("dimensions", ["shape", "diameterCm", "heightCm", "densityGramsPerMl", "reference"], { shape: { const: "cylinder" } }),
] } as const;
export const intakeBasisSchema = { type: "object", additionalProperties: false, required: ["kind"], properties: {
  kind: { type: "string", enum: ["current_record", "label"] }, amount: numeric, unit,
  energyUnit: { type: "string", enum: ["kcal", "kJ"] }, energy: nullableNutrient, proteinGrams: nullableNutrient,
  carbohydrateGrams: nullableNutrient, fatGrams: nullableNutrient, source: shortText,
}, anyOf: [choice("current_record", []), choice("label", ["amount", "unit", "energyUnit", "energy", "proteinGrams", "carbohydrateGrams", "fatGrams", "source"])] } as const;
export const intakeInputSchema = { type: "object", additionalProperties: false, required: ["mealRevision", "contributionRevision", "quantity", "basis"], properties: {
  mealRevision: { type: "integer", minimum: 1 }, contributionRevision: { type: "integer", minimum: 1 }, quantity: intakeQuantitySchema, basis: intakeBasisSchema,
} } as const;
const nutrients = { energyKcal: nullableNutrient, proteinGrams: nullableNutrient, carbohydrateGrams: nullableNutrient, fatGrams: nullableNutrient };
export const intakeEvidenceSchema = { type: "object", additionalProperties: false,
  required: ["version", "input", "amount", "unit", "quantitySource", "basis", "nutrients", "equations", "warnings", "recordedAt"], properties: {
    version: { type: "string", const: "intake-v1" }, input: { type: "object", additionalProperties: false, required: ["quantity", "basis"], properties: { quantity: intakeQuantitySchema, basis: intakeBasisSchema } },
    amount: numeric, unit, quantitySource: source,
    basis: { type: "object", additionalProperties: false, required: ["kind", "amount", "unit", "source", ...Object.keys(nutrients)], properties: { kind: { type: "string", enum: ["current_record", "label"] }, amount: numeric, unit, source: shortText, ...nutrients } },
    nutrients: { type: "object", additionalProperties: false, required: Object.keys(nutrients), properties: nutrients },
    equations: { type: "array", items: { type: "object", additionalProperties: false, required: ["label", "expression", "result", "unit"], properties: { label: shortText, expression: shortText, result: { type: "number", nullable: true }, unit } } },
    warnings: { type: "array", items: { type: "string" } }, recordedAt: { type: "string", format: "date-time" },
  } } as const;
