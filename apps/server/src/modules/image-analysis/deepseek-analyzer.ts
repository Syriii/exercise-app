import type { ImageAnalyzer, ImageAnalyzerResult, ImageAnalyzerUsage } from "./analyzer.js";
import type { ImageNutritionCandidate } from "./types.js";

export const imageAnalysisPromptVersion = "meal-image-estimate-2026-08-31.2";

const defaultRetryLimit = 2;
const defaultRetryDelayMs = 500;
const maximumOutputTokens = 1_200;

export class DeepSeekImageAnalyzerError extends Error {
  public constructor(
    public readonly code: string,
    public readonly retryable: boolean,
  ) {
    super(code);
    this.name = "DeepSeekImageAnalyzerError";
  }
}

interface DeepSeekImageAnalyzerOptions {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly model: string;
  /** Overall deadline across the first request and any transient retries. */
  readonly timeoutMs: number;
  readonly retryLimit?: number;
  readonly retryDelayMs?: number;
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

export class DeepSeekImageAnalyzer implements ImageAnalyzer {
  readonly #now: () => number;
  readonly #sleep: (milliseconds: number) => Promise<void>;

  public constructor(private readonly options: DeepSeekImageAnalyzerOptions) {
    this.#now = options.now ?? Date.now;
    this.#sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  public get model() {
    return this.options.model;
  }

  public async analyze(contentType: string, image: Buffer): Promise<ImageAnalyzerResult> {
    const deadline = this.#now() + this.options.timeoutMs;
    const retryLimit = this.options.retryLimit ?? defaultRetryLimit;
    const retryDelayMs = this.options.retryDelayMs ?? defaultRetryDelayMs;

    for (let retry = 0; ; retry += 1) {
      try {
        return await this.request(contentType, image, deadline);
      } catch (error) {
        if (!(error instanceof DeepSeekImageAnalyzerError) || !error.retryable || retry >= retryLimit) {
          throw error;
        }
        const delay = retryDelayMs * 2 ** retry;
        if (this.#now() + delay >= deadline) throw error;
        await this.#sleep(delay);
      }
    }
  }

  private async request(contentType: string, image: Buffer, deadline: number): Promise<ImageAnalyzerResult> {
    const remainingMs = deadline - this.#now();
    if (remainingMs <= 0) throw new DeepSeekImageAnalyzerError("deepseek_timeout", true);

    const startedAt = this.#now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), remainingMs);
    try {
      let response: Response;
      try {
        response = await fetch(`${this.options.baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          signal: controller.signal,
          headers: {
            authorization: `Bearer ${this.options.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: this.options.model,
            stream: false,
            thinking: { type: "disabled" },
            temperature: 0.2,
            max_tokens: maximumOutputTokens,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: nutritionAnalysisPrompt },
              {
                role: "user",
                content: [
                  { type: "text", text: "请分析这张餐食照片，并只返回符合上述格式的 JSON 对象。" },
                  {
                    type: "image_url",
                    image_url: {
                      url: `data:${contentType};base64,${image.toString("base64")}`,
                      detail: "auto",
                    },
                  },
                ],
              },
            ],
          }),
        });
      } catch {
        if (controller.signal.aborted) throw new DeepSeekImageAnalyzerError("deepseek_timeout", true);
        throw new DeepSeekImageAnalyzerError("deepseek_network_error", true);
      }

      if (!response.ok) throw classifyHttpError(response.status);

      let body: DeepSeekResponse;
      try {
        body = await response.json() as DeepSeekResponse;
      } catch {
        throw new DeepSeekImageAnalyzerError("deepseek_invalid_response", true);
      }

      const choice = body.choices?.[0];
      if (choice?.finish_reason === "length") {
        throw new DeepSeekImageAnalyzerError("deepseek_output_truncated", false);
      }
      const content = choice?.message?.content;
      if (typeof content !== "string" || content.trim().length === 0) {
        throw new DeepSeekImageAnalyzerError("deepseek_empty_content", true);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        throw new DeepSeekImageAnalyzerError("deepseek_invalid_json", true);
      }

      return {
        candidate: validateCandidate(parsed),
        providerRequestId: typeof body.id === "string" ? body.id : null,
        providerModel: typeof body.model === "string" ? body.model : null,
        finishReason: typeof choice?.finish_reason === "string" ? choice.finish_reason : null,
        usage: validateUsage(body.usage),
        durationMs: Math.max(0, this.#now() - startedAt),
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

interface DeepSeekResponse {
  readonly id?: unknown;
  readonly model?: unknown;
  readonly choices?: Array<{
    readonly finish_reason?: unknown;
    readonly message?: { readonly content?: unknown };
  }>;
  readonly usage?: unknown;
}

const nutritionAnalysisPrompt = `你是餐食图片营养估算助手。根据照片中可见内容估算食物、可见份量和整餐营养，只输出一个 JSON 对象，不要输出 Markdown 或解释文字。

JSON 示例：
{"title":"鸡蛋豆浆早餐","observedFoods":[{"label":"鸡蛋","estimatedPortion":"约 2 个","note":null},{"label":"豆浆","estimatedPortion":"约 1 碗","note":"是否加糖无法判断"}],"energyKcal":350,"proteinGrams":20,"carbohydrateGrams":25,"fatGrams":17,"confidence":"medium","assumptions":["按照片中可见盛取量估算"],"uncertaintyNote":"照片无法确认豆浆含糖量和未拍到的食物，请按实际情况修正。"}

字段要求：
- title：简短餐食名称；
- observedFoods：可见食物数组，每项包含 label、estimatedPortion、note，无法判断的后两项使用 null；
- energyKcal、proteinGrams、carbohydrateGrams、fatGrams：整餐非负数字，无法可靠判断时使用 null；
- confidence：只能是 low、medium、high；
- assumptions：估算所依赖的假设数组；
- uncertaintyNote：明确说明照片看不到或无法确认的因素。

只依据照片可见内容。不要臆造品牌、配方、精确重量或未拍到的食物；不确定时降低 confidence、使用 null，并在 uncertaintyNote 中说明。`;

function classifyHttpError(status: number): DeepSeekImageAnalyzerError {
  if (status === 400) return new DeepSeekImageAnalyzerError("deepseek_invalid_request", false);
  if (status === 401) return new DeepSeekImageAnalyzerError("deepseek_authentication_failed", false);
  if (status === 402) return new DeepSeekImageAnalyzerError("deepseek_insufficient_balance", false);
  if (status === 422) return new DeepSeekImageAnalyzerError("deepseek_invalid_parameters", false);
  if (status === 429) return new DeepSeekImageAnalyzerError("deepseek_rate_limited", true);
  if (status === 500) return new DeepSeekImageAnalyzerError("deepseek_server_error", true);
  if (status === 503) return new DeepSeekImageAnalyzerError("deepseek_overloaded", true);
  if (status >= 500) return new DeepSeekImageAnalyzerError("deepseek_server_unavailable", true);
  return new DeepSeekImageAnalyzerError(`deepseek_http_${status}`, false);
}

function validateUsage(value: unknown): ImageAnalyzerUsage | null {
  if (typeof value !== "object" || value === null) return null;
  const usage = value as Record<string, unknown>;
  const promptTokens = nonnegativeInteger(usage.prompt_tokens);
  const completionTokens = nonnegativeInteger(usage.completion_tokens);
  const totalTokens = nonnegativeInteger(usage.total_tokens);
  if (promptTokens === null || completionTokens === null || totalTokens === null) return null;
  return { promptTokens, completionTokens, totalTokens };
}

function nonnegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function validateCandidate(value: unknown): ImageNutritionCandidate {
  if (typeof value !== "object" || value === null) {
    throw new DeepSeekImageAnalyzerError("deepseek_invalid_candidate", true);
  }
  const data = value as Record<string, unknown>;
  const title = boundedText(data.title, 200, false);
  const uncertaintyNote = boundedText(data.uncertaintyNote, 2_000, true);
  if (
    title === null
    || uncertaintyNote === null
    || !["low", "medium", "high"].includes(String(data.confidence))
    || !Array.isArray(data.assumptions)
    || data.assumptions.length > 20
    || !Array.isArray(data.observedFoods)
    || data.observedFoods.length > 50
  ) {
    throw new DeepSeekImageAnalyzerError("deepseek_invalid_candidate", true);
  }

  const assumptions = data.assumptions.map((item) => {
    const assumption = boundedText(item, 1_000, false);
    if (assumption === null) throw new DeepSeekImageAnalyzerError("deepseek_invalid_candidate", true);
    return assumption;
  });
  const observedFoods = data.observedFoods.map((item) => {
    if (typeof item !== "object" || item === null) {
      throw new DeepSeekImageAnalyzerError("deepseek_invalid_candidate", true);
    }
    const food = item as Record<string, unknown>;
    const label = boundedText(food.label, 200, false);
    const estimatedPortion = nullableBoundedText(food.estimatedPortion, 200);
    const note = nullableBoundedText(food.note, 1_000);
    if (label === null || estimatedPortion === undefined || note === undefined) {
      throw new DeepSeekImageAnalyzerError("deepseek_invalid_candidate", true);
    }
    return { label, estimatedPortion, note };
  });

  return {
    title,
    observedFoods,
    energyKcal: nutrient(data.energyKcal),
    proteinGrams: nutrient(data.proteinGrams),
    carbohydrateGrams: nutrient(data.carbohydrateGrams),
    fatGrams: nutrient(data.fatGrams),
    confidence: data.confidence as "low" | "medium" | "high",
    assumptions,
    uncertaintyNote,
  };
}

function nutrient(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  throw new DeepSeekImageAnalyzerError("deepseek_invalid_candidate", true);
}

function boundedText(value: unknown, maximumLength: number, allowEmpty: boolean): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  return (allowEmpty || clean.length > 0) && clean.length <= maximumLength ? clean : null;
}

function nullableBoundedText(value: unknown, maximumLength: number): string | null | undefined {
  if (value === null) return null;
  const clean = boundedText(value, maximumLength, false);
  return clean === null ? undefined : clean;
}
