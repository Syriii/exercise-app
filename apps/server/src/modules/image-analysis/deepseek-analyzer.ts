import type { ImageAnalyzer, ImageAnalyzerResult, ImageAnalyzerUsage } from "./analyzer.js";
import type { ImageFoodCandidate, ImageNutritionCandidate } from "./types.js";

export const imageAnalysisPromptVersion = "meal-image-foods-2026-09-06.1";

const defaultRetryLimit = 2;
const defaultRetryDelayMs = 500;
const maximumOutputTokens = 6_000;

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

const nutritionAnalysisPrompt = `你是餐食图片营养估算助手。只返回 JSON，不输出 Markdown。按可辨认的单个食物、饮品或整道混合菜估算，条目互不重叠，不把整餐总值重复分配给每项。

JSON 示例：
{"title":"鸡蛋豆浆早餐","foods":[{"label":"鸡蛋","portionAmount":2,"portionUnit":"个","energyKcal":144,"proteinGrams":12.6,"carbohydrateGrams":0.8,"fatGrams":9.6,"note":"约两个普通大小鸡蛋"},{"label":"豆浆","portionAmount":1,"portionUnit":"碗","energyKcal":90,"proteinGrams":7,"carbohydrateGrams":6,"fatGrams":4,"note":"估计这一碗约250毫升，含糖量不明"}],"confidence":"low","assumptions":["按照片中可见盛取量估算"],"uncertaintyNote":"大小和含糖量无法从照片精确确定。"}

字段要求：
- title：简短餐名，最多100字；
- foods：1至30项，每项 label 最多100字；portionAmount 为大于0的估算数量，portionUnit 为 g、ml、个、碗等实际计量单位，两者无法估计时同时为 null；
- 每项 energyKcal、proteinGrams、carbohydrateGrams、fatGrams 表示该项所列份量的营养，不是每100克，也不是整餐。无法可靠判断的营养用 null，不能填0；能量不超过100000，其他营养不超过10000；
- 每项 note 可为 null，或简述份量基准和不确定因素；碗、杯等须说明估算容量或大小，不能将估计当精确测量；
- confidence：low、medium、high；assumptions：假设数组；uncertaintyNote：照片无法确认的因素。
能辨认的鸡蛋、豆浆分别记录；混合菜可整道记录，不臆造原料克数、品牌、精确配方或未拍到的内容。完全无法识别时保留一项“未识别食物”，份量与营养均为 null。整餐合计由应用计算，不要输出重复的整餐条目。`;

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
    || !Array.isArray(data.foods)
    || data.foods.length < 1
    || data.foods.length > 30
  ) {
    throw new DeepSeekImageAnalyzerError("deepseek_invalid_candidate", true);
  }

  const assumptions = data.assumptions.map((item) => {
    const assumption = boundedText(item, 1_000, false);
    if (assumption === null) throw new DeepSeekImageAnalyzerError("deepseek_invalid_candidate", true);
    return assumption;
  });
  const foods: ImageFoodCandidate[] = data.foods.map((item) => {
    if (typeof item !== "object" || item === null) throw new DeepSeekImageAnalyzerError("deepseek_invalid_candidate", true);
    const food = item as Record<string, unknown>;
    const label = boundedText(food.label, 100, false);
    const portionUnit = nullableBoundedText(food.portionUnit, 30);
    const portionAmount = food.portionAmount === null ? null : nutrient(food.portionAmount, 100000);
    const note = nullableBoundedText(food.note, 1000);
    if (label === null || portionUnit === undefined || note === undefined
      || (portionAmount === null) !== (portionUnit === null) || portionAmount === 0) {
      throw new DeepSeekImageAnalyzerError("deepseek_invalid_candidate", true);
    }
    return { label, portionAmount, portionUnit, note,
      energyKcal: nutrient(food.energyKcal, 100000), proteinGrams: nutrient(food.proteinGrams),
      carbohydrateGrams: nutrient(food.carbohydrateGrams), fatGrams: nutrient(food.fatGrams) };
  });
  const total = (key: "energyKcal" | "proteinGrams" | "carbohydrateGrams" | "fatGrams") =>
    foods.some((food) => food[key] === null) ? null : Math.round(foods.reduce((sum, food) => sum + food[key]!, 0) * 1000) / 1000;
  const observedFoods = foods.map((food) => ({ label: food.label, estimatedPortion: food.portionAmount === null ? null : `${food.portionAmount} ${food.portionUnit}`, note: food.note }));

  return {
    title,
    foods,
    observedFoods,
    energyKcal: total("energyKcal"),
    proteinGrams: total("proteinGrams"),
    carbohydrateGrams: total("carbohydrateGrams"),
    fatGrams: total("fatGrams"),
    confidence: data.confidence as "low" | "medium" | "high",
    assumptions,
    uncertaintyNote,
  };
}

function nutrient(value: unknown, maximum = 10000): number | null {
  if (value === null) return null;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= maximum) return Math.round(value * 1000) / 1000;
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
