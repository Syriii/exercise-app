import { afterEach, describe, expect, it, vi } from "vitest";

import { DeepSeekImageAnalyzer, DeepSeekImageAnalyzerError } from "./deepseek-analyzer.js";

afterEach(() => vi.unstubAllGlobals());

describe("DeepSeekImageAnalyzer", () => {
  it("derives totals only from non-overlapping food items and preserves unknowns", async () => {
    const foods = [
      { label: "鸡蛋", portionAmount: 2, portionUnit: "个", note: null, energyKcal: 140, proteinGrams: 12, carbohydrateGrams: 2, fatGrams: 10 },
      { label: "混合菜", portionAmount: 1, portionUnit: "碗", note: null, energyKcal: 200, proteinGrams: null, carbohydrateGrams: 15, fatGrams: 8 },
    ];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ title: "早餐", foods, energyKcal: 9999, proteinGrams: 999, confidence: "low", assumptions: [], uncertaintyNote: "" }) } }] }), { status: 200 })));
    const analyzer = new DeepSeekImageAnalyzer({ apiKey: "test-only", baseUrl: "https://api.deepseek.com", model: "test-model", timeoutMs: 1000 });
    const result = await analyzer.analyze("image/png", Buffer.from("test"));
    expect(result.candidate).toMatchObject({ foods, energyKcal: 340, proteinGrams: null, carbohydrateGrams: 17, fatGrams: 18 });
  });

  it.each([
    [],
    [{ label: "鸡蛋", portionAmount: 2, portionUnit: null, note: null, energyKcal: 140, proteinGrams: 12, carbohydrateGrams: 2, fatGrams: 10 }],
    [{ label: "鸡蛋", portionAmount: 0, portionUnit: "个", note: null, energyKcal: 140, proteinGrams: 12, carbohydrateGrams: 2, fatGrams: 10 }],
  ])("rejects invalid per-food structure %#", async (...entries) => {
    const foods = entries;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ title: "早餐", foods, confidence: "low", assumptions: [], uncertaintyNote: "" }) } }] }), { status: 200 })));
    const analyzer = new DeepSeekImageAnalyzer({ apiKey: "test-only", baseUrl: "https://api.deepseek.com", model: "test-model", timeoutMs: 1000, retryDelayMs: 0 });
    await expect(analyzer.analyze("image/png", Buffer.from("test"))).rejects.toThrow("deepseek_invalid_candidate");
  });

  it("uses the documented image_url content block and validates JSON output", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({
        model: "deepseek-v4-flash-vision-exp",
        stream: false,
        thinking: { type: "disabled" },
        temperature: 0.2,
        max_tokens: 6_000,
        response_format: { type: "json_object" },
      });
      const messages = body.messages as Array<{ content: Array<Record<string, unknown>> }>;
      expect(String(messages[0]?.content)).toContain("JSON 示例");
      expect(messages[1]?.content[1]).toEqual({
        type: "image_url",
        image_url: {
          url: `data:image/png;base64,${Buffer.from("image").toString("base64")}`,
          detail: "auto",
        },
      });
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer secret-key");
      return new Response(
        JSON.stringify({
          id: "provider-request",
          model: "deepseek-v4-flash-vision-exp",
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  title: "测试餐食",
                  foods: [{ label: "米饭", portionAmount: 200, portionUnit: "g", note: null, energyKcal: 300, proteinGrams: null, carbohydrateGrams: 60, fatGrams: null }],
                  observedFoods: [
                    { label: "米饭", estimatedPortion: null, note: null },
                  ],
                  energyKcal: 300,
                  proteinGrams: null,
                  carbohydrateGrams: 60,
                  fatGrams: null,
                  confidence: "low",
                  assumptions: [],
                  uncertaintyNote: "看不出烹调油。",
                }),
              },
            },
          ],
          usage: { prompt_tokens: 400, completion_tokens: 120, total_tokens: 520 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const analyzer = new DeepSeekImageAnalyzer({
      apiKey: "secret-key",
      baseUrl: "https://api.deepseek.com/",
      model: "deepseek-v4-flash-vision-exp",
      timeoutMs: 1_000,
    });

    const result = await analyzer.analyze("image/png", Buffer.from("image"));

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.deepseek.com/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result).toMatchObject({
      providerRequestId: "provider-request",
      providerModel: "deepseek-v4-flash-vision-exp",
      finishReason: "stop",
      usage: { promptTokens: 400, completionTokens: 120, totalTokens: 520 },
      candidate: { energyKcal: 300, proteinGrams: null, confidence: "low" },
    });
  });

  it("rejects malformed or negative nutrition values", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    title: "错误结果",
                    foods: [{ label: "米饭", portionAmount: 200, portionUnit: "g", note: null, energyKcal: -1, proteinGrams: null, carbohydrateGrams: null, fatGrams: null }],
                    observedFoods: [],
                    energyKcal: -1,
                    proteinGrams: null,
                    carbohydrateGrams: null,
                    fatGrams: null,
                    confidence: "high",
                    assumptions: [],
                    uncertaintyNote: "",
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    const analyzer = new DeepSeekImageAnalyzer({
      apiKey: "secret-key",
      baseUrl: "https://api.deepseek.com",
      model: "test-model",
      timeoutMs: 1_000,
    });

    await expect(analyzer.analyze("image/png", Buffer.from("image"))).rejects.toThrow(
      "deepseek_invalid_candidate",
    );
  });

  it("retries transient provider failures within one overall deadline", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("overloaded", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "request-after-retry",
        choices: [{
          finish_reason: "stop",
          message: { content: JSON.stringify({
            title: "重试成功",
            foods: [{ label: "未识别食物", portionAmount: null, portionUnit: null, note: null, energyKcal: null, proteinGrams: null, carbohydrateGrams: null, fatGrams: null }],
            observedFoods: [],
            energyKcal: null,
            proteinGrams: null,
            carbohydrateGrams: null,
            fatGrams: null,
            confidence: "low",
            assumptions: [],
            uncertaintyNote: "照片信息有限。",
          }) },
        }],
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const analyzer = new DeepSeekImageAnalyzer({
      apiKey: "secret-key",
      baseUrl: "https://api.deepseek.com",
      model: "test-model",
      timeoutMs: 1_000,
      retryDelayMs: 0,
    });

    const result = await analyzer.analyze("image/png", Buffer.from("image"));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.providerRequestId).toBe("request-after-retry");
  });

  it("does not retry configuration or account errors", async () => {
    const fetchMock = vi.fn(async () => new Response("unauthorized", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const analyzer = new DeepSeekImageAnalyzer({
      apiKey: "invalid-key",
      baseUrl: "https://api.deepseek.com",
      model: "test-model",
      timeoutMs: 1_000,
    });

    await expect(analyzer.analyze("image/png", Buffer.from("image"))).rejects.toMatchObject({
      code: "deepseek_authentication_failed",
      retryable: false,
    } satisfies Partial<DeepSeekImageAnalyzerError>);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("classifies an exhausted request deadline as a timeout", async () => {
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })));
    const analyzer = new DeepSeekImageAnalyzer({
      apiKey: "secret-key",
      baseUrl: "https://api.deepseek.com",
      model: "test-model",
      timeoutMs: 10,
    });

    await expect(analyzer.analyze("image/png", Buffer.from("image"))).rejects.toMatchObject({
      code: "deepseek_timeout",
    });
  });

  it("rejects truncated JSON output without retrying", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ finish_reason: "length", message: { content: "{\"title\":" } }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const analyzer = new DeepSeekImageAnalyzer({
      apiKey: "secret-key",
      baseUrl: "https://api.deepseek.com",
      model: "test-model",
      timeoutMs: 1_000,
    });

    await expect(analyzer.analyze("image/png", Buffer.from("image"))).rejects.toMatchObject({
      code: "deepseek_output_truncated",
      retryable: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
