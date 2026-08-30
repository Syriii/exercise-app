import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

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
const temporaryRoots: string[] = [];

function cookieFrom(response: { headers: Record<string, unknown> }): string {
  const header = response.headers["set-cookie"];
  if (typeof header !== "string") throw new Error("expected cookie");
  return header.split(";", 1)[0] ?? "";
}

async function createApp(exerciseMediaRoot: string | null = null) {
  const identityService = new IdentityService({
    repository: new MemoryIdentityRepository(),
    sessionSecret: config.sessionSecret,
    sessionTtlHours: config.sessionTtlHours,
  });
  const trainingRepository = new MemoryTrainingRepository();
  const planningService = new PlanningService(new MemoryPlanningRepository());
  const trainingService = new TrainingService({ repository: trainingRepository, planningService, exerciseMediaRoot });
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

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("training routes", () => {
  it("streams separately supplied exercise media only to signed-in accounts", async () => {
    const root = mkdtempSync(join(tmpdir(), "exercise-route-media-"));
    temporaryRoots.push(root);
    mkdirSync(join(root, "images"));
    mkdirSync(join(root, "videos"));
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const gif = Buffer.from("GIF89a", "ascii");
    writeFileSync(join(root, "images", "0001-test.jpg"), jpg);
    writeFileSync(join(root, "videos", "0001-test.gif"), gif);

    const { app, firstCookie } = await createApp(root);
    const anonymous = await app.inject({ method: "GET", url: "/api/v1/training/exercises/0001/media/image" });
    expect(anonymous.statusCode).toBe(401);

    const image = await app.inject({ method: "GET", url: "/api/v1/training/exercises/0001/media/image", headers: { cookie: firstCookie } });
    expect(image.statusCode).toBe(200);
    expect(image.headers["content-type"]).toContain("image/jpeg");
    expect(image.rawPayload).toEqual(jpg);

    const animation = await app.inject({ method: "GET", url: "/api/v1/training/exercises/0001/media/animation", headers: { cookie: firstCookie } });
    expect(animation.statusCode).toBe(200);
    expect(animation.headers["content-type"]).toContain("image/gif");
    expect(animation.rawPayload).toEqual(gif);
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
      videoUrl: null,
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
