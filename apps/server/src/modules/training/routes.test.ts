import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { buildApp } from "../../app.js";
import { createTestConfig } from "../../testing/test-config.js";
import { MemoryIdentityRepository } from "../identity/memory-repository.js";
import { IdentityService } from "../identity/service.js";
import { MemoryPlanningRepository } from "../planning/memory-repository.js";
import { PlanningService } from "../planning/service.js";
import { MemoryTrainingRepository } from "./memory-repository.js";
import { TrainingService } from "./service.js";

const config = createTestConfig({
  sessionSecret: "a-training-route-test-secret-long-enough",
  webDistDirectory: "/directory-that-does-not-exist",
});
const password = "correct horse battery staple";
const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

function cookieFrom(response: { headers: Record<string, unknown> }): string {
  const header = response.headers["set-cookie"];
  if (typeof header !== "string") throw new Error("expected cookie");
  return header.split(";", 1)[0] ?? "";
}

async function createApp() {
  const identityService = new IdentityService({
    repository: new MemoryIdentityRepository(),
    sessionSecret: config.sessionSecret,
    sessionTtlHours: config.sessionTtlHours,
  });
  const trainingRepository = new MemoryTrainingRepository();
  const planningService = new PlanningService(new MemoryPlanningRepository());
  const trainingService = new TrainingService({ repository: trainingRepository, planningService });
  const app = await buildApp({
    config,
    checkDatabase: async () => undefined,
    identityService,
    planningService,
    trainingService,
  });
  apps.push(app);
  const first = await app.inject({ method: "POST", url: "/api/v1/auth/register", payload: { username: "first", password } });
  const second = await app.inject({ method: "POST", url: "/api/v1/auth/register", payload: { username: "second", password } });
  return { app, firstCookie: cookieFrom(first), secondCookie: cookieFrom(second) };
}

const templatePayload = {
  name: "全身简易",
  note: null,
  items: [
    {
      exerciseName: "深蹲",
      targetSets: 3,
      targetRepsMin: 8,
      targetRepsMax: 12,
      targetWeightKg: null,
      targetDurationSeconds: null,
      targetDistanceMeters: null,
      note: null,
    },
  ],
};

describe("training routes", () => {
  it("saves and replaces whole post-workout records, protects retries and deletion across accounts", async () => {
    const { app, firstCookie, secondCookie } = await createApp();
    const id = randomUUID();
    const url = `/api/v1/training/records/${id}`;
    const set = { reps: 10, weightKg: "0", durationSeconds: null, distanceMeters: null, note: null };
    const input = { revision: 0, localDate: "2026-09-10", timeZone: "Asia/Shanghai", recordedTime: null, note: null,
      items: [{ id: randomUUID(), exerciseName: "深蹲", measurement: "sets", actualNote: null, sets: [set, set, { ...set, reps: null }] },
        { id: randomUUID(), exerciseName: "跑步", measurement: "activity", actualNote: null, sets: [{ ...set, reps: null, weightKg: null, durationSeconds: 1800, distanceMeters: "2500.001" }] },
        { id: randomUUID(), exerciseName: "拉伸", measurement: "unknown", actualNote: "只记得做过", sets: [] }] };
    expect((await app.inject({ method: "PUT", url, payload: input })).statusCode).toBe(401);
    const save = (data: unknown, cookie = firstCookie) => app.inject({ method: "PUT", url, payload: data as object, headers: { cookie } });
    const created = await save(input);
    expect(created.statusCode, created.body).toBe(200);
    const first = created.json();
    expect(first).toMatchObject({ revision: 1, status: "completed", recordedTime: null, recordingMode: "batch" });
    expect(first).not.toHaveProperty("recordWrite"); expect(first).not.toHaveProperty("userId");
    expect(first.items).toHaveLength(3); expect(first.items[0].sets).toHaveLength(3);
    expect(first.items[0].sets[2].reps).toBeNull(); expect(first.items[2].sets).toEqual([]);
    expect((await save(input)).json()).toEqual(first);
    expect((await save({ ...input, note: "changed retry" })).statusCode).toBe(409);
    expect((await save(input, secondCookie)).statusCode).toBe(404);
    const editedInput = { ...input, revision: 1, localDate: "2026-09-09", recordedTime: "18:30", note: "补记",
      items: [{ ...input.items[1], id: first.items[1].id }, { ...input.items[0], id: first.items[0].id, exerciseName: "徒手深蹲", sets: [set] }] };
    const edited = await save(editedInput); expect(edited.statusCode, edited.body).toBe(200);
    expect(edited.json()).toMatchObject({ revision: 2, localDate: "2026-09-09", recordedTime: "18:30" });
    expect(edited.json().items.filter((i: { status: string }) => i.status === "completed")).toHaveLength(2);
    expect((await save(editedInput)).json()).toEqual(edited.json());
    const revisions = await app.inject({ method: "GET", url: `/api/v1/training/sessions/${id}/item-revisions`, headers: { cookie: firstCookie } });
    expect(revisions.json()).toHaveLength(3);
    const del = (revision: number, cookie = firstCookie) => app.inject({ method: "DELETE", url, payload: { revision }, headers: { cookie } });
    expect((await del(2, secondCookie)).statusCode).toBe(404);
    expect((await del(1)).statusCode).toBe(409);
    expect((await del(2)).statusCode).toBe(204); expect((await del(2)).statusCode).toBe(204);
    expect((await save(editedInput)).statusCode).toBe(404);
    expect((await save({ ...editedInput, revision: 0 })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/api/v1/training/sessions/${id}`, headers: { cookie: firstCookie } })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/api/v1/training/sessions", headers: { cookie: firstCookie } })).json()).toEqual([]);
    expect((await app.inject({ method: "PUT", url: `/api/v1/training/sessions/${id}`, payload: { revision: 3, localDate: "2026-09-10", note: null }, headers: { cookie: firstCookie } })).statusCode).toBe(404);
  });

  it("rejects malformed batch quantities atomically without guessing unknown values", async () => {
    const { app, firstCookie } = await createApp();
    const input = { revision: 0, localDate: "2026-09-10", timeZone: "Asia/Shanghai", recordedTime: null, note: null,
      items: [{ id: randomUUID(), exerciseName: "动作", measurement: "sets", actualNote: null, sets: [{ reps: 1, weightKg: "0", durationSeconds: null, distanceMeters: null, note: null }] }] };
    const id = randomUUID(); const save = (data: object) => app.inject({ method: "PUT", url: `/api/v1/training/records/${id}`, payload: data, headers: { cookie: firstCookie } });
    for (const patch of [{ localDate: "2026-02-30" }, { timeZone: "bad-zone" }, { recordedTime: "24:00" }, { items: [] }, { items: [input.items[0], input.items[0]] },
      { items: [{ ...input.items[0], exerciseName: " " }] }, { items: [{ ...input.items[0], measurement: "unknown" }] },
      { items: [{ ...input.items[0], sets: [{ ...input.items[0]!.sets[0], weightKg: "1.1234" }] }] },
      { items: [{ ...input.items[0], sets: [{ ...input.items[0]!.sets[0], reps: -1 }] }] }]) {
      const result = await save({ ...input, ...patch }); expect(result.statusCode, result.body).toBe(400);
    }
    expect((await app.inject({ method: "GET", url: "/api/v1/training/sessions", headers: { cookie: firstCookie } })).json()).toEqual([]);
    expect((await save(input)).statusCode).toBe(200);
  });

  it("serves attributed guidance to a signed-in account", async () => {
    const { app, firstCookie } = await createApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/training/guidance?exerciseName=%E6%9D%A0%E9%93%83%E5%8D%A7%E6%8E%A8",
      headers: { cookie: firstCookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      exerciseName: "卧推",
      license: "MIT",
      reviewStatus: "draft",
    });
    const movementPattern = await app.inject({
      method: "GET",
      url: "/api/v1/training/guidance?exerciseName=%E6%B0%B4%E5%B9%B3%E6%8B%89%EF%BC%88%E5%88%92%E8%88%B9%E7%B1%BB%EF%BC%89",
      headers: { cookie: firstCookie },
    });
    expect(movementPattern.statusCode).toBe(200);
    expect(movementPattern.json()).toMatchObject({ exerciseName: "划船", reviewStatus: "draft" });
  });

  it("serves the official expenditure catalog and stores an explicit unavailable assessment", async () => {
    const { app, firstCookie } = await createApp();
    const catalog = await app.inject({ method: "GET", url: "/api/v1/training/expenditure-catalog", headers: { cookie: firstCookie } });
    expect(catalog.statusCode, catalog.body).toBe(200);
    expect(catalog.json()).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "barbell_bench_25rm", met: 4.9, description: "5 组 × 25 次，组间休息 1 分钟" }),
    ]));
    const started = await app.inject({
      method: "POST",
      url: "/api/v1/training/sessions",
      headers: { cookie: firstCookie },
      payload: { templateId: null, timeZone: "Asia/Shanghai" },
    });
    const session = started.json<{ id: string; revision: number }>();
    const finished = await app.inject({
      method: "POST",
      url: `/api/v1/training/sessions/${session.id}/finish`,
      headers: { cookie: firstCookie },
      payload: { revision: session.revision, status: "completed" },
    });
    const completed = finished.json<{ revision: number }>();
    const assessed = await app.inject({
      method: "PUT",
      url: `/api/v1/training/sessions/${session.id}/expenditure`,
      headers: { cookie: firstCookie },
      payload: { revision: completed.revision, activityCode: null, durationMinutes: null },
    });
    expect(assessed.statusCode, assessed.body).toBe(200);
    expect(assessed.json()).toMatchObject({ expenditureAssessment: { status: "unavailable", grossEnergyKcal: null } });
  });

  it("persists a plan-based workout with completed and extra actions", async () => {
    const { app, firstCookie } = await createApp();
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/training/templates",
      headers: { cookie: firstCookie },
      payload: templatePayload,
    });
    expect(created.statusCode, created.body).toBe(201);
    const template = created.json<{ id: string }>();

    const started = await app.inject({
      method: "POST",
      url: "/api/v1/training/sessions",
      headers: { cookie: firstCookie },
      payload: { templateId: template.id, timeZone: "Asia/Shanghai" },
    });
    expect(started.statusCode).toBe(201);
    let session = started.json<{ id: string; revision: number; items: { id: string }[] }>();

    const completed = await app.inject({
      method: "PUT",
      url: `/api/v1/training/sessions/${session.id}/items/${session.items[0]?.id}`,
      headers: { cookie: firstCookie },
      payload: {
        revision: session.revision,
        status: "completed",
        performedExerciseName: "深蹲",
        actualNote: null,
        sets: [{ reps: 10, weightKg: "60", durationSeconds: null, distanceMeters: null, note: null }],
      },
    });
    expect(completed.statusCode).toBe(200);
    session = completed.json<typeof session>();

    const extra = await app.inject({
      method: "POST",
      url: `/api/v1/training/sessions/${session.id}/items`,
      headers: { cookie: firstCookie },
      payload: { revision: session.revision, exerciseName: "平板支撑", actualNote: "收尾", sets: [] },
    });
    expect(extra.statusCode).toBe(201);
    expect(extra.json<{ items: { origin: string; exerciseName: string }[] }>().items).toEqual(
      expect.arrayContaining([expect.objectContaining({ origin: "extra", exerciseName: "平板支撑" })]),
    );
  });

  it("does not expose another account's templates or sessions", async () => {
    const { app, firstCookie, secondCookie } = await createApp();
    const created = await app.inject({ method: "POST", url: "/api/v1/training/templates", headers: { cookie: firstCookie }, payload: templatePayload });
    const template = created.json<{ id: string }>();
    const started = await app.inject({ method: "POST", url: "/api/v1/training/sessions", headers: { cookie: firstCookie }, payload: { templateId: template.id, timeZone: "Asia/Shanghai" } });
    const session = started.json<{ id: string }>();

    const templates = await app.inject({ method: "GET", url: "/api/v1/training/templates", headers: { cookie: secondCookie } });
    const foreignSession = await app.inject({ method: "GET", url: `/api/v1/training/sessions/${session.id}`, headers: { cookie: secondCookie } });
    const foreignRevisions = await app.inject({ method: "GET", url: `/api/v1/training/sessions/${session.id}/item-revisions`, headers: { cookie: secondCookie } });
    const foreignSessionRevisions = await app.inject({ method: "GET", url: `/api/v1/training/sessions/${session.id}/revisions`, headers: { cookie: secondCookie } });

    expect(templates.json()).toEqual([]);
    expect(foreignSession.statusCode).toBe(404);
    expect(foreignRevisions.statusCode).toBe(404);
    expect(foreignSessionRevisions.statusCode).toBe(404);
  });

  it("keeps cycle programs private to their account", async () => {
    const { app, firstCookie, secondCookie } = await createApp();
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/training/programs",
      headers: { cookie: firstCookie },
      payload: { name: "四周计划", note: null, weekCount: 4 },
    });
    expect(created.statusCode, created.body).toBe(201);

    const ownPrograms = await app.inject({
      method: "GET",
      url: "/api/v1/training/programs",
      headers: { cookie: firstCookie },
    });
    const otherPrograms = await app.inject({
      method: "GET",
      url: "/api/v1/training/programs",
      headers: { cookie: secondCookie },
    });

    expect(ownPrograms.json<{ name: string }[]>()).toEqual([
      expect.objectContaining({ name: "四周计划" }),
    ]);
    expect(otherPrograms.json()).toEqual([]);
  });

  it("keeps dated schedules private and links one schedule to one workout", async () => {
    const { app, firstCookie, secondCookie } = await createApp();
    const createdTemplate = await app.inject({
      method: "POST",
      url: "/api/v1/training/templates",
      headers: { cookie: firstCookie },
      payload: templatePayload,
    });
    const template = createdTemplate.json<{ id: string }>();
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/training/schedules",
      headers: { cookie: firstCookie },
      payload: {
        localDate: "2026-08-26",
        timeZone: "Asia/Shanghai",
        title: "",
        note: null,
        sourceTemplateId: template.id,
        sourceProgramId: null,
        sourceProgramUnitId: null,
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const schedule = created.json<{ id: string }>();

    const own = await app.inject({ method: "GET", url: "/api/v1/training/schedules?dateFrom=2026-08-26&dateTo=2026-08-26", headers: { cookie: firstCookie } });
    const other = await app.inject({ method: "GET", url: "/api/v1/training/schedules?dateFrom=2026-08-26&dateTo=2026-08-26", headers: { cookie: secondCookie } });
    expect(own.json<{ title: string }[]>()).toEqual([expect.objectContaining({ title: "全身简易" })]);
    expect(other.json()).toEqual([]);

    const started = await app.inject({ method: "POST", url: `/api/v1/training/schedules/${schedule.id}/start`, headers: { cookie: firstCookie } });
    const repeated = await app.inject({ method: "POST", url: `/api/v1/training/schedules/${schedule.id}/start`, headers: { cookie: firstCookie } });
    const foreign = await app.inject({ method: "POST", url: `/api/v1/training/schedules/${schedule.id}/start`, headers: { cookie: secondCookie } });
    expect(started.statusCode, started.body).toBe(201);
    expect(started.json()).toMatchObject({ sourceScheduleId: schedule.id, localDate: "2026-08-26" });
    expect(repeated.statusCode).toBe(409);
    expect(foreign.statusCode).toBe(404);
  });
});
