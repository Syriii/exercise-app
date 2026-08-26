import type { ImageAnalyzer, ImageAnalyzerResult } from "./analyzer.js";
import type { ImageNutritionCandidate } from "./types.js";

export const imageAnalysisPromptVersion = "meal-image-estimate-2026-08-26.1";

export class DeepSeekImageAnalyzer implements ImageAnalyzer {
  public constructor(private readonly options: { apiKey: string; baseUrl: string; model: string; timeoutMs: number }) {}
  public get model() { return this.options.model; }

  public async analyze(contentType: string, image: Buffer): Promise<ImageAnalyzerResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await fetch(`${this.options.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: { authorization: `Bearer ${this.options.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: this.options.model,
          stream: false,
          response_format: { type: "json_object" },
          messages: [{ role: "user", content: [
            { type: "text", text: "估算这顿饭可见食物和营养。只输出 JSON：title 字符串；observedFoods 数组（label、estimatedPortion、note，可未知为 null）；energyKcal、proteinGrams、carbohydrateGrams、fatGrams 为非负数字或 null；confidence 为 low/medium/high；assumptions 为字符串数组；uncertaintyNote 字符串。无法从照片判断的值必须为 null，不要伪造精确重量。" },
            { type: "image_url", image_url: { url: `data:${contentType};base64,${image.toString("base64")}`, detail: "auto" } },
          ] }],
        }),
      });
      if (!response.ok) throw new Error(`deepseek_http_${response.status}`);
      const body = await response.json() as { id?: unknown; choices?: Array<{ message?: { content?: unknown } }> };
      const content = body.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new Error("deepseek_missing_content");
      return { candidate: validateCandidate(JSON.parse(content)), providerRequestId: typeof body.id === "string" ? body.id : null };
    } finally { clearTimeout(timeout); }
  }
}

function validateCandidate(value: unknown): ImageNutritionCandidate {
  if (typeof value !== "object" || value === null) throw new Error("deepseek_invalid_candidate");
  const data = value as Record<string, unknown>;
  const nutrient = (name: string) => data[name] === null ? null : typeof data[name] === "number" && Number.isFinite(data[name]) && data[name] >= 0 ? data[name] : (() => { throw new Error("deepseek_invalid_candidate"); })();
  if (typeof data.title !== "string" || !["low", "medium", "high"].includes(String(data.confidence)) || typeof data.uncertaintyNote !== "string" || !Array.isArray(data.assumptions) || !data.assumptions.every((item) => typeof item === "string") || !Array.isArray(data.observedFoods)) throw new Error("deepseek_invalid_candidate");
  const observedFoods = data.observedFoods.map((item) => { if (typeof item !== "object" || item === null) throw new Error("deepseek_invalid_candidate"); const food = item as Record<string, unknown>; if (typeof food.label !== "string" || !(food.estimatedPortion === null || typeof food.estimatedPortion === "string") || !(food.note === null || typeof food.note === "string")) throw new Error("deepseek_invalid_candidate"); return { label: food.label, estimatedPortion: food.estimatedPortion, note: food.note }; });
  return { title: data.title, observedFoods, energyKcal: nutrient("energyKcal"), proteinGrams: nutrient("proteinGrams"), carbohydrateGrams: nutrient("carbohydrateGrams"), fatGrams: nutrient("fatGrams"), confidence: data.confidence as "low" | "medium" | "high", assumptions: data.assumptions as string[], uncertaintyNote: data.uncertaintyNote };
}
