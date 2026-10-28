import { afterEach, describe, expect, it, vi } from "vitest";

import type { ImageAnalyzerCall, ImageAnalyzerCallPreparation, ImageAnalyzerObserver } from "./analyzer.js";
import { DeepSeekImageAnalyzer, DeepSeekImageAnalyzerError } from "./deepseek-analyzer.js";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function response(status = 200) {
  return new Response(JSON.stringify({ id: "fake-provider-request", model: "deepseek-flash",
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ title: "假餐食",
      foods: [{ label: "米饭", portionAmount: 100, portionUnit: "g", note: null, energyKcal: 100, proteinGrams: null, carbohydrateGrams: 20, fatGrams: null }],
      confidence: "low", assumptions: [], uncertaintyNote: "本地假数据" }) } }],
  }), { status });
}
function analyzer(now?: () => number) {
  return new DeepSeekImageAnalyzer({ apiKey: "only-fake-recording-key", baseUrl: "https://example.invalid", model: "deepseek-flash",
    timeoutMs: 1000, retryDelayMs: 0, ...(now ? { now } : {}) });
}
function observer(): ImageAnalyzerObserver {
  return { beforeRequest: vi.fn(async () => true), afterRequest: vi.fn(async () => undefined) };
}

describe("physical model call recording", () => {
  it("waits for durable preparation and receipt and prices the actual dispatch time", async () => {
    let now = Date.parse("2026-10-28T00:59:59.900Z");
    const prepared = deferred<void>(), allowDispatch = deferred<void>(), received = deferred<void>(), allowCompletion = deferred<void>();
    let preparation!: ImageAnalyzerCallPreparation, receipt!: readonly ImageAnalyzerCall[], finished = false;
    const fetch = vi.fn(async () => response());
    vi.stubGlobal("fetch", fetch);
    const processing = analyzer(() => now).analyze("image/png", Buffer.from("fake image"), {
      async beforeRequest(value) { preparation = value; prepared.resolve(); await allowDispatch.promise; now += 200; return true; },
      async afterRequest(calls) { receipt = calls; received.resolve(); await allowCompletion.promise; },
    }).then(value => { finished = true; return value; });
    await prepared.promise;
    expect(fetch).not.toHaveBeenCalled();
    allowDispatch.resolve();
    await received.promise;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(finished).toBe(false);
    expect(receipt).toEqual([expect.objectContaining({ callId: preparation.callId, status: "succeeded", startedAt: "2026-10-28T01:00:00.100Z" })]);
    expect(preparation.preparedAt).toBe("2026-10-28T00:59:59.900Z");
    expect(receipt[0]?.cost).toMatchObject({ ratePeriod: "peak_or_off_peak", cacheMissInputPerMillion: 2 });
    allowCompletion.resolve();
    expect((await processing).calls).toEqual(receipt);
    expect(JSON.stringify(preparation)).not.toContain("fake image");
    expect(JSON.stringify(receipt)).not.toContain("only-fake-recording-key");
  });

  it.each(["failed", "inactive"] as const)("does not send or retry when preparation is %s", async outcome => {
    const fetch = vi.fn(async () => response()), recorder = observer();
    vi.stubGlobal("fetch", fetch);
    recorder.beforeRequest = vi.fn(async () => { if (outcome === "failed") throw Error("private diagnostic must not escape"); return false; });
    const error = await analyzer().analyze("image/png", Buffer.from("fake"), recorder).catch(value => value as DeepSeekImageAnalyzerError);
    expect(error).toMatchObject({ code: outcome === "failed" ? "deepseek_call_preparation_failed" : "deepseek_request_cancelled", retryable: false, calls: [] });
    expect(fetch).not.toHaveBeenCalled();
    expect(recorder.beforeRequest).toHaveBeenCalledTimes(1);
    expect(recorder.afterRequest).not.toHaveBeenCalled();
    expect((error as Error).message).not.toContain("private diagnostic");
  });

  it.each([200, 503])("stops after receipt persistence fails for HTTP %s and keeps the provider outcome", async status => {
    const fetch = vi.fn(async () => response(status)), recorder = observer();
    vi.stubGlobal("fetch", fetch);
    recorder.afterRequest = vi.fn(async () => { throw Error("only fake disk failure"); });
    const error = await analyzer().analyze("image/png", Buffer.from("fake"), recorder).catch(value => value as DeepSeekImageAnalyzerError);
    expect(error).toMatchObject({ code: "deepseek_call_recording_failed", retryable: false,
      calls: [expect.objectContaining({ status: status === 200 ? "succeeded" : "deepseek_overloaded", usage: expect.objectContaining({ promptTokens: 100, completionTokens: 20, totalTokens: 120 }) })] });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(recorder.beforeRequest).toHaveBeenCalledTimes(1);
    expect(recorder.afterRequest).toHaveBeenCalledTimes(1);
  });

  it("records each retry before allowing the next request and preserves distinct call IDs", async () => {
    const preparations: ImageAnalyzerCallPreparation[] = [], snapshots: ImageAnalyzerCall[][] = [];
    let requests = 0;
    const fetch = vi.fn(async () => { expect(snapshots.length).toBe(requests++); return response(requests === 1 ? 503 : 200); });
    vi.stubGlobal("fetch", fetch);
    const result = await analyzer().analyze("image/png", Buffer.from("fake"), {
      async beforeRequest(value) { preparations.push(value); return true; },
      async afterRequest(calls) { snapshots.push(structuredClone([...calls])); },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(preparations).toHaveLength(2);
    expect(new Set(preparations.map(value => value.callId)).size).toBe(2);
    expect(snapshots.map(value => value.length)).toEqual([1, 2]);
    expect(result.calls?.map(call => call.callId)).toEqual(preparations.map(value => value.callId));
  });

  it("includes preparation and receipt time in the retry budget", async () => {
    let now = Date.parse("2026-10-28T02:00:00Z");
    const fetch = vi.fn(async () => response(503));
    vi.stubGlobal("fetch", fetch);
    const before = observer();
    before.beforeRequest = async () => { now += 1001; return true; };
    await expect(analyzer(() => now).analyze("image/png", Buffer.from("fake"), before)).rejects.toMatchObject({ code: "deepseek_timeout", retryable: false, calls: [] });
    expect(fetch).not.toHaveBeenCalled();
    const after = observer();
    after.afterRequest = async () => { now += 1001; };
    await expect(analyzer(() => now).analyze("image/png", Buffer.from("fake"), after)).rejects.toMatchObject({ code: "deepseek_overloaded" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("bounds a stalled preparation without ever dispatching its request", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => response()), recorder = observer();
    vi.stubGlobal("fetch", fetch);
    recorder.beforeRequest = vi.fn(() => new Promise<boolean>(() => undefined));
    const processing = analyzer().analyze("image/png", Buffer.from("fake"), recorder).catch(value => value as DeepSeekImageAnalyzerError);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await processing).toMatchObject({ code: "deepseek_call_preparation_failed", retryable: false, calls: [] });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([200, 1001])("rechecks time after payload encoding takes %s ms", async encodingMs => {
    let now = Date.parse("2026-10-28T00:59:59.900Z");
    const image = Buffer.from("fake"), encode = image.toString.bind(image), recorder = observer();
    vi.spyOn(image, "toString").mockImplementationOnce(() => { now += encodingMs; return encode("base64"); });
    const fetch = vi.fn(async () => response());
    vi.stubGlobal("fetch", fetch);
    const processing = analyzer(() => now).analyze("image/png", image, recorder);
    if (encodingMs > 1000) {
      await expect(processing).rejects.toMatchObject({ code: "deepseek_timeout", retryable: false, calls: [] });
      expect(fetch).not.toHaveBeenCalled();
      expect(recorder.afterRequest).not.toHaveBeenCalled();
    } else {
      const result = await processing;
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(result.calls?.[0]).toMatchObject({ startedAt: "2026-10-28T01:00:00.100Z", cost: { cacheMissInputPerMillion: 2 } });
    }
  });

  it("bounds stalled receipt persistence and never sends a second paid request", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => response(503)), recorder = observer();
    vi.stubGlobal("fetch", fetch);
    recorder.afterRequest = vi.fn(() => new Promise<void>(() => undefined));
    const processing = analyzer().analyze("image/png", Buffer.from("fake"), recorder).catch(value => value as DeepSeekImageAnalyzerError);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await processing).toMatchObject({ code: "deepseek_call_recording_failed", retryable: false, calls: [expect.objectContaining({ status: "deepseek_overloaded" })] });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
