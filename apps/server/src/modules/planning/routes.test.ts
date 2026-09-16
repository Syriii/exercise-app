import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { buildContractApp } from "../../testing/contract-app.js";
import { emptyProfile, defaultStrategy } from "./service.js";

it("authenticates setup and body endpoints, validates checkpoints and rejects cross-account or deleted retries", async () => {
  const app = await buildContractApp();
  try {
    async function register(username: string) { const response = await app.inject({ method: "POST", url: "/api/v1/auth/register", payload: { username, password: "fake planning route password" } }); expect(response.statusCode).toBe(201); return { cookie: String(response.headers["set-cookie"]).split(";", 1)[0] }; }
    const owner = await register("planning-owner"), other = await register("planning-other");
    expect((await app.inject({ url: "/api/v1/planning/setup" })).statusCode).toBe(401);
    const step = (value: string, measurementUnknown = false) => app.inject({ method: "PUT", url: "/api/v1/planning/setup", headers: owner, payload: { step: value, measurementUnknown } });
    expect((await step("finish")).statusCode).toBe(400);
    expect((await step("start")).json()).toMatchObject({ completed: false, profile: false });
    const { revision: _profileRevision, updatedAt: _profileDate, ...profile } = emptyProfile;
    expect((await app.inject({ method: "PUT", url: "/api/v1/planning/profile", headers: owner, payload: { revision: 1, ...profile } })).statusCode).toBe(200);
    expect((await step("profile")).statusCode).toBe(200);
    expect((await step("measurement")).statusCode).toBe(400);
    expect((await step("measurement", true)).statusCode).toBe(200);
    const { revision: _strategyRevision, updatedAt: _strategyDate, ...strategy } = defaultStrategy;
    expect((await app.inject({ method: "PUT", url: "/api/v1/planning/strategy", headers: owner, payload: { revision: 0, ...strategy } })).statusCode).toBe(200);
    expect((await step("strategy")).json()).toMatchObject({ strategy: true, completed: false });
    expect((await step("finish")).json()).toMatchObject({ completed: true });
    const id = randomUUID(), url = `/api/v1/planning/measurements/${id}`;
    const payload = { revision: 0, measuredAt: "2026-09-01T08:30:20Z", localDate: "2026-09-01", timeZone: "Asia/Shanghai", weightKg: 70, waistCm: null, note: null };
    for (let n = 0; n < 2; n++) expect((await app.inject({ method: "PUT", url, headers: owner, payload })).json()).toMatchObject({ id, revision: 1 });
    expect((await app.inject({ method: "DELETE", url, headers: other, payload: { revision: 1 } })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url, headers: owner, payload: { revision: 0 } })).statusCode).toBe(400);
    expect((await app.inject({ method: "DELETE", url, headers: owner, payload: { revision: 1 } })).statusCode).toBe(204);
    expect((await app.inject({ method: "DELETE", url, headers: owner, payload: { revision: 1 } })).statusCode).toBe(204);
    expect((await app.inject({ method: "PUT", url, headers: owner, payload })).statusCode).toBe(404);
    expect((await app.inject({ url: "/api/v1/planning/measurements", headers: owner })).json()).toEqual([]);
    expect((await app.inject({ url: "/api/v1/planning/setup", headers: other })).json()).toMatchObject({ completed: false });
  } finally { await app.close(); }
});
