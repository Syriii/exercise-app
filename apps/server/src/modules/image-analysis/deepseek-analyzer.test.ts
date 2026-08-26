import { afterEach, describe, expect, it, vi } from "vitest";

import { DeepSeekImageAnalyzer } from "./deepseek-analyzer.js";

afterEach(() => vi.unstubAllGlobals());

describe("DeepSeekImageAnalyzer", () => {
  it("uses the documented image_url content block and validates JSON output", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({
        model: "deepseek-v4-flash-vision-exp",
        stream: false,
        response_format: { type: "json_object" },
      });
      const messages = body.messages as Array<{ content: Array<Record<string, unknown>> }>;
      expect(messages[0]?.content[1]).toEqual({
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
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: "测试餐食",
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
});
