import { mkdtemp, open, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import type { ImageAnalyzerCall, ImageAnalyzerCallPreparation } from "../modules/image-analysis/analyzer.js";
import { createEvaluationProviderObserver, shouldStopEvaluationForLogFailure, unresolvedEvaluationProviderRequests, type EvaluationProviderLogRecord } from "./photo-evaluation-log.js";

const preparation = (callId: string): ImageAnalyzerCallPreparation => ({
  callId, preparedAt: "2026-10-28T02:00:00Z", configuredModel: "deepseek-flash",
});
const completedCall = (callId: string, status = "succeeded"): ImageAnalyzerCall => ({
  callId, startedAt: "2026-10-28T02:00:01Z", configuredModel: "deepseek-flash",
  providerModel: "deepseek-flash", providerRequestId: `provider-${callId}`,
  status, usage: null, cost: null, durationMs: 10,
});

it("does not approve dispatch until the prepared request has been written and synced", async () => {
  const events: string[] = [];
  let releaseSync!: () => void;
  const sync = new Promise<void>(resolve => { releaseSync = resolve; });
  const writer = {
    writeFile: vi.fn(async (record: string) => { events.push(JSON.parse(record).type); }),
    sync: vi.fn(async () => { events.push("sync"); await sync; }),
  };
  const log = createEvaluationProviderObserver(writer, "sample-a");
  const sending = log.observer.beforeRequest(preparation("call-a")).then(approved => {
    if (approved) events.push("send");
  });
  await Promise.resolve();
  expect(events).toEqual(["provider_request_prepared", "sync"]);
  releaseSync();
  await sending;
  expect(events).toEqual(["provider_request_prepared", "sync", "send"]);
  expect(JSON.parse(writer.writeFile.mock.calls[0]![0])).toMatchObject({
    id: "sample-a", callId: "call-a", dispatchState: "unconfirmed",
  });
  expect(log.failure).toBeNull();
});

it("syncs each completed cumulative snapshot before allowing the next request", async () => {
  const events: string[] = [];
  const records: EvaluationProviderLogRecord[] = [];
  const writer = {
    writeFile: vi.fn(async (record: string) => {
      const parsed = JSON.parse(record) as EvaluationProviderLogRecord;
      records.push(parsed); events.push(parsed.type);
    }),
    sync: vi.fn(async () => { events.push("sync"); }),
  };
  const log = createEvaluationProviderObserver(writer, "sample-a");
  const first = completedCall("call-a", "deepseek_overloaded"), second = completedCall("call-b");
  await log.observer.beforeRequest(preparation("call-a"));
  events.push("send-a", "response-a");
  await log.observer.afterRequest([first]);
  await log.observer.beforeRequest(preparation("call-b"));
  events.push("send-b", "response-b");
  await log.observer.afterRequest([first, second]);
  expect(events).toEqual([
    "provider_request_prepared", "sync", "send-a", "response-a", "provider_calls_recorded", "sync",
    "provider_request_prepared", "sync", "send-b", "response-b", "provider_calls_recorded", "sync",
  ]);
  expect(records.at(-1)).toEqual({ type: "provider_calls_recorded", id: "sample-a", callId: "call-b", calls: [first, second] });
  expect(unresolvedEvaluationProviderRequests(records)).toEqual([]);
});

it("preserves an interrupted prepared intent as unknown when a private log is reopened", async () => {
  const directory = await mkdtemp(join(tmpdir(), "exercise-evaluation-log-"));
  const path = join(directory, "evaluation.jsonl");
  try {
    const file = await open(path, "wx", 0o600);
    try {
      await file.write(JSON.stringify({ type: "request_started", id: "sample-a", at: "2026-10-28T01:59:59Z" }) + "\n");
      const log = createEvaluationProviderObserver(file, "sample-a");
      await log.observer.beforeRequest(preparation("call-a"));
      // The process can stop here before dispatch or after dispatch; neither is inferred.
    } finally { await file.close(); }
    const records: unknown[] = (await readFile(path, "utf8")).trim().split("\n").map(line => JSON.parse(line));
    expect(records[0]).toMatchObject({ type: "request_started", id: "sample-a" });
    expect(unresolvedEvaluationProviderRequests(records)).toEqual([{
      id: "sample-a", ...preparation("call-a"), dispatchState: "unconfirmed", outcome: "unknown", usage: null, cost: null,
    }]);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    await expect(open(path, "wx", 0o600)).rejects.toMatchObject({ code: "EEXIST" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it("matches terminal call IDs within a sample and does not double count cumulative or repeated records", () => {
  const first = completedCall("call-a"), second = completedCall("call-b");
  const records: unknown[] = [
    { type: "metadata", dataset: "test-only" },
    { type: "provider_calls_recorded", id: "sample-a", callId: "call-a", calls: [first] },
    { type: "provider_request_prepared", id: "sample-a", ...preparation("call-a"), dispatchState: "unconfirmed" },
    { type: "provider_request_prepared", id: "sample-a", ...preparation("call-b"), dispatchState: "unconfirmed" },
    { type: "provider_request_prepared", id: "sample-b", ...preparation("call-a"), dispatchState: "unconfirmed" },
    { type: "provider_calls_recorded", id: "sample-a", callId: "call-b", calls: [first, second] },
    { type: "provider_calls_recorded", id: "sample-a", callId: "call-b", calls: [first, second] },
    { type: "prediction", id: "sample-b", calls: [first] },
    { type: "provider_calls_recorded", id: "sample-b", calls: [{ callId: "call-a" }] },
  ];
  expect(unresolvedEvaluationProviderRequests(records)).toEqual([{
    id: "sample-b", ...preparation("call-a"), dispatchState: "unconfirmed", outcome: "unknown", usage: null, cost: null,
  }]);
});

it("keeps corrupt, nonterminal or mismatched completion fragments unknown until a complete matching call arrives", () => {
  const intent: EvaluationProviderLogRecord = {
    type: "provider_request_prepared", id: "sample-a", ...preparation("call-a"), dispatchState: "unconfirmed",
  };
  const complete = completedCall("call-a");
  const withoutBilling = Object.fromEntries(Object.entries(complete).filter(([key]) => !["usage", "cost"].includes(key)));
  const invalidCalls = [
    { callId: "call-a", status: "succeeded" },
    { ...complete, configuredModel: "different-model" },
    { ...complete, startedAt: "not-a-date" },
    { ...complete, durationMs: -1 },
    { ...complete, durationMs: Infinity },
    { ...complete, status: "pending" },
    { ...complete, status: "prepared" },
    { ...complete, status: "" },
    withoutBilling,
  ];
  for (const call of invalidCalls) {
    const records: unknown[] = [intent, { type: "provider_calls_recorded", id: "sample-a", callId: "call-a", calls: [call] }];
    expect(unresolvedEvaluationProviderRequests(records)).toMatchObject([{ id: "sample-a", callId: "call-a", outcome: "unknown" }]);
    // A real completion with unknown billing is still terminal, even when received before its preparation.
    records.unshift({ type: "provider_calls_recorded", id: "sample-a", callId: "call-a", calls: [complete] });
    expect(unresolvedEvaluationProviderRequests(records)).toEqual([]);
  }
});

it.each(["write", "sync"])("fails closed before dispatch when preparation %s fails", async failurePoint => {
  const writer = {
    writeFile: vi.fn(async () => { if (failurePoint === "write") throw new Error("disk unavailable"); }),
    sync: vi.fn(async () => { if (failurePoint === "sync") throw new Error("disk unavailable"); }),
  };
  const log = createEvaluationProviderObserver(writer, "sample-a");
  const send = vi.fn();
  await expect(log.observer.beforeRequest(preparation("call-a")).then(approved => { if (approved) send(); }))
    .rejects.toThrow("evaluation_provider_log_failed");
  expect(send).not.toHaveBeenCalled();
  expect(log.failure?.message).toBe("evaluation_provider_log_failed");
  expect(shouldStopEvaluationForLogFailure(new Error("wrapped provider failure"), log.failure)).toBe(true);
  await expect(log.observer.beforeRequest(preparation("call-b"))).rejects.toBe(log.failure);
  expect(writer.writeFile).toHaveBeenCalledTimes(1);
});

it("makes a completed-call sync failure sticky so this observer cannot approve another request", async () => {
  let syncCount = 0;
  const writer = {
    writeFile: vi.fn(async () => {}),
    sync: vi.fn(async () => { if (++syncCount === 2) throw new Error("disk unavailable"); }),
  };
  const log = createEvaluationProviderObserver(writer, "sample-a");
  await log.observer.beforeRequest(preparation("call-a"));
  await expect(log.observer.afterRequest([completedCall("call-a")])).rejects.toThrow("evaluation_provider_log_failed");
  await expect(log.observer.beforeRequest(preparation("call-b"))).rejects.toBe(log.failure);
  expect(writer.writeFile).toHaveBeenCalledTimes(2);
});

it.each(["deepseek_call_preparation_failed", "deepseek_call_recording_failed"])("stops for %s while observer I/O is still pending", async code => {
  let rejectWrite!: (error: Error) => void;
  const pendingWrite = new Promise<void>((_resolve, reject) => { rejectWrite = reject; });
  let blocked = code === "deepseek_call_preparation_failed";
  const writer = {
    writeFile: vi.fn(async () => { if (blocked) await pendingWrite; }),
    sync: vi.fn(async () => {}),
  };
  const log = createEvaluationProviderObserver(writer, "sample-a");
  if (!blocked) await log.observer.beforeRequest(preparation("call-a"));
  blocked = true;
  const observerWrite = code === "deepseek_call_preparation_failed"
    ? log.observer.beforeRequest(preparation("call-a"))
    : log.observer.afterRequest([completedCall("call-a")]);
  expect(log.failure).toBeNull();
  // The analyzer's bounded wait can expire before the filesystem operation settles.
  expect(shouldStopEvaluationForLogFailure({ code, retryable: false }, log.failure)).toBe(true);
  rejectWrite(new Error("late disk failure"));
  await expect(observerWrite).rejects.toThrow("evaluation_provider_log_failed");
});

it("keeps ordinary provider errors eligible for a failed prediction when the log is healthy", () => {
  for (const code of ["deepseek_timeout", "deepseek_rate_limited", "deepseek_invalid_candidate"])
    expect(shouldStopEvaluationForLogFailure({ code, retryable: false }, null)).toBe(false);
  expect(shouldStopEvaluationForLogFailure(new Error("other failure"), null)).toBe(false);
});
