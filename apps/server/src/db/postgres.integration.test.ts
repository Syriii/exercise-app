import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase } from "./database.js";
import { DatabaseUserContext } from "./user-context.js";
import { ensureApiDatabaseRole, grantApiDatabaseRole } from "./runtime-role.js";
import { PostgresIdentityRepository } from "../modules/identity/postgres-repository.js";
import { IdentityService } from "../modules/identity/service.js";
import { PostgresImageAnalysisRepository } from "../modules/image-analysis/postgres-repository.js";
import { PostgresOperationsService } from "../modules/operations/service.js";
import { PostgresNutritionRepository } from "../modules/nutrition/postgres-repository.js";
import { NutritionService } from "../modules/nutrition/service.js";
import { PostgresPlanningRepository } from "../modules/planning/postgres-repository.js";
import { PlanningService } from "../modules/planning/service.js";
import { PostgresReminderRepository } from "../modules/reminders/postgres-repository.js";
import { ReminderService } from "../modules/reminders/service.js";
import { migratePgBoss, PgBossTaskQueue } from "../modules/tasks/pgboss-task-queue.js";
import { PostgresTrainingRepository } from "../modules/training/postgres-repository.js";
import { TrainingService } from "../modules/training/service.js";
import { loadTestDatabaseUrl } from "../testing/test-database-url.js";
import { readSecretValue } from "../config/environment.js";

const databaseUrl = loadTestDatabaseUrl();
const database = createDatabase(databaseUrl);
const queue = new PgBossTaskQueue({
  databaseUrl,
  applicationName: "exercise-app-integration-test",
  superviseIntervalSeconds: 1,
  monitorIntervalSeconds: 1,
});
const transactionQueueName = "exercise-integration-transaction";
const crashQueueName = "exercise-integration-crash";
const apiRolePassword =
  process.env.TEST_API_DATABASE_PASSWORD === undefined &&
  process.env.TEST_API_DATABASE_PASSWORD_FILE === undefined
    ? "integration-only-api-role-password"
    : readSecretValue("TEST_API_DATABASE_PASSWORD", process.env, (path) =>
        readFileSync(path, "utf8"),
      );

function apiRoleDatabaseUrl(): string {
  const url = new URL(databaseUrl);
  url.username = "exercise_api";
  url.password = apiRolePassword;
  return url.toString();
}

function waitForWorkerStart(child: ChildProcess): Promise<string> {
  return new Promise((resolveStart, rejectStart) => {
    const timeout = setTimeout(() => {
      cleanup();
      rejectStart(new Error("crash-test worker did not claim the job"));
    }, 10_000);
    const onMessage = (message: unknown) => {
      if (
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        message.type === "started" &&
        "taskId" in message &&
        typeof message.taskId === "string"
      ) {
        cleanup();
        resolveStart(message.taskId);
      }
    };
    const onExit = () => {
      cleanup();
      rejectStart(new Error("crash-test worker exited before claiming the job"));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      child.off("message", onMessage);
      child.off("exit", onExit);
    };
    child.on("message", onMessage);
    child.on("exit", onExit);
  });
}

async function waitForCompletedJob(jobId: string): Promise<number> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const result = await database.pool.query<{ state: string; retry_count: number }>(
      "select state, retry_count from pgboss.job where id = $1",
      [jobId],
    );
    if (result.rows[0]?.state === "completed") {
      return result.rows[0].retry_count;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error("recovered job did not reach completed state");
}

beforeAll(async () => {
  await ensureApiDatabaseRole(database.pool, apiRolePassword, {
    preserveExistingPassword: true,
  });
  await migrate(database.database, {
    migrationsFolder: resolve(import.meta.dirname, "../../drizzle"),
  });
  await migratePgBoss(databaseUrl);
  await grantApiDatabaseRole(database.pool);
  await queue.start();
  await queue.ensureQueue({
    name: transactionQueueName,
    retryLimit: 0,
    retryDelaySeconds: 1,
    retryBackoff: false,
    expireInSeconds: 30,
    heartbeatSeconds: 10,
    deleteAfterSeconds: 60,
  });
  await queue.ensureQueue({
    name: crashQueueName,
    retryLimit: 1,
    retryDelaySeconds: 1,
    retryBackoff: false,
    expireInSeconds: 120,
    heartbeatSeconds: 10,
    deleteAfterSeconds: 60,
  });
});

afterAll(async () => {
  await queue.stop();
  await database.close();
});

describe("PostgreSQL integration", () => {
  it("enforces API row security for direct and child health records", async () => {
    const suffix = randomUUID();
    const accounts = await database.pool.query<{ id: string }>(
      `insert into users (username, normalized_username)
       values ($1, $1), ($2, $2)
       returning id`,
      [`rls-a-${suffix}`, `rls-b-${suffix}`],
    );
    const userA = accounts.rows[0]?.id;
    const userB = accounts.rows[1]?.id;
    expect(userA).toBeDefined();
    expect(userB).toBeDefined();
    const mealA = await database.pool.query<{ id: string }>(
      `insert into meals (user_id, occurred_at, local_date, time_zone, name)
       values ($1, now(), current_date, 'UTC', 'A meal') returning id`,
      [userA],
    );
    const mealB = await database.pool.query<{ id: string }>(
      `insert into meals (user_id, occurred_at, local_date, time_zone, name)
       values ($1, now(), current_date, 'UTC', 'B meal') returning id`,
      [userB],
    );
    await database.pool.query(
      `insert into meal_contributions (meal_id, mode, label, energy_kcal)
       values ($1, 'item', 'A food', 100), ($2, 'item', 'B food', 200)`,
      [mealA.rows[0]?.id, mealB.rows[0]?.id],
    );
    await database.pool.query(
      `insert into training_suggestions (user_id, method_version, evidence_ids, input_snapshot, candidate)
       values ($1, 'integration-v1', '["E-013"]', '{}', '{"title":"A suggestion"}'),
              ($2, 'integration-v1', '["E-013"]', '{}', '{"title":"B suggestion"}')`,
      [userA, userB],
    );

    const client = await database.pool.connect();
    try {
      await client.query("begin");
      await client.query("set local role exercise_api");
      const withoutContext = await client.query<{ count: number }>(
        "select count(*)::int as count from meals",
      );
      expect(withoutContext.rows[0]?.count).toBe(0);
      await client.query("rollback");

      await client.query("begin");
      await client.query("set local role exercise_api");
      await client.query("select set_config('exercise.user_id', $1, true)", [userA]);
      const visibleMeals = await client.query<{ id: string }>("select id from meals");
      const visibleContributions = await client.query<{ label: string }>(
        "select label from meal_contributions",
      );
      const visibleSuggestions = await client.query<{ title: string }>(
        "select candidate->>'title' as title from training_suggestions",
      );
      const otherUpdate = await client.query("update meals set note = 'blocked' where id = $1", [
        mealB.rows[0]?.id,
      ]);

      expect(visibleMeals.rows).toEqual([{ id: mealA.rows[0]?.id }]);
      expect(visibleContributions.rows).toEqual([{ label: "A food" }]);
      expect(visibleSuggestions.rows).toEqual([{ title: "A suggestion" }]);
      expect(otherUpdate.rowCount).toBe(0);
      await expect(
        client.query(
          `insert into meals (user_id, occurred_at, local_date, time_zone, name)
           values ($1, now(), current_date, 'UTC', 'forbidden')`,
          [userB],
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await client.query("rollback");
    } finally {
      client.release();
    }
  });

  it("persists only Argon2id credentials through the real repository", async () => {
    const identity = new IdentityService({
      repository: new PostgresIdentityRepository(database.database),
      sessionSecret: "an-integration-test-session-secret-that-is-long-enough",
      sessionTtlHours: 1,
      maxAccounts: 100,
    });
    const username = `test_${randomUUID().replaceAll("-", "")}`.slice(0, 32);

    await identity.register(username, "an integration-only secure password");

    const result = await database.pool.query<{ password_hash: string }>(
      `select c.password_hash
       from credentials c
       join users u on u.id = c.user_id
       where u.normalized_username = $1`,
      [username],
    );
    expect(result.rows[0]?.password_hash).toMatch(/^\$argon2id\$/);
    expect(result.rows[0]?.password_hash).not.toContain("integration-only secure password");
  });

  it("rejects a plaintext credential at the database boundary", async () => {
    const client = await database.pool.connect();
    try {
      await client.query("begin");
      const account = await client.query<{ id: string }>(
        `insert into users (username, normalized_username)
         values ($1, $2)
         returning id`,
        [`constraint-${randomUUID()}`, `constraint-${randomUUID()}`],
      );
      await expect(
        client.query("insert into credentials (user_id, password_hash) values ($1, $2)", [
          account.rows[0]?.id,
          "plaintext-password",
        ]),
      ).rejects.toThrow();
    } finally {
      await client.query("rollback");
      client.release();
    }
  });

  it("reports a fresh worker heartbeat from PostgreSQL", async () => {
    const operations = new PostgresOperationsService({
      database: database.database,
      checkDatabase: database.check,
      workerStaleAfterSeconds: 45,
    });
    await operations.recordWorkerHeartbeat("integration-worker", new Date());

    await expect(operations.getHealth()).resolves.toMatchObject({
      database: { status: "healthy" },
      worker: { status: "healthy" },
    });
  });

  it("persists an immutable training snapshot and actual sets through PostgreSQL", async () => {
    const identity = new IdentityService({
      repository: new PostgresIdentityRepository(database.database),
      sessionSecret: "a-training-integration-session-secret-long-enough",
      sessionTtlHours: 1,
      maxAccounts: 100,
    });
    const username = `training_${randomUUID().replaceAll("-", "")}`.slice(0, 32);
    const account = (await identity.register(username, "a training integration secure password")).account;
    const planning = new PlanningService(new PostgresPlanningRepository(database.database));
    await planning.updateProfile(account.id, 0, {
      birthDate: "2000-08-26",
      sexCategory: "male",
      heightCm: 175,
      pregnantOrBreastfeeding: false,
      medicalNutritionCondition: false,
      specialBodyComposition: false,
      palCategory: "low_active",
    });
    const weight = await planning.createMeasurement(account.id, {
      measuredAt: "2026-08-20T08:00:00.000Z",
      localDate: "2026-08-20",
      timeZone: "Asia/Shanghai",
      weightKg: 70,
      waistCm: null,
      note: null,
    });
    const training = new TrainingService({
      repository: new PostgresTrainingRepository(database.database),
      planningService: planning,
      now: () => new Date("2026-08-25T03:30:00.000Z"),
    });
    const emptyTarget = {
      targetSets: null,
      targetRepsMin: null,
      targetRepsMax: null,
      targetWeightKg: null,
      targetDurationSeconds: null,
      targetDistanceMeters: null,
      note: null,
    } as const;
    const template = await training.createTemplate(account.id, {
      name: "数据库训练方案",
      note: null,
      items: [{ ...emptyTarget, exerciseName: "杠铃卧推", targetSets: 3 }],
    });
    let session = await training.startSession(account.id, template.id, "Asia/Shanghai");
    const itemId = session.items[0]?.id;
    if (itemId === undefined) throw new Error("expected snapshot item");
    session = await training.updateSessionItem(account.id, session.id, itemId, session.revision, {
      status: "completed",
      performedExerciseName: "杠铃卧推",
      actualNote: null,
      sets: [{ reps: 8, weightKg: "62.5", durationSeconds: null, distanceMeters: null, note: null }],
    });
    await training.updateTemplate(account.id, template.id, template.revision, {
      name: "修改后的方案",
      note: null,
      items: [{ ...emptyTarget, exerciseName: "哑铃卧推", targetSets: 4 }],
    });

    const stored = await training.getSession(account.id, session.id);
    expect(stored).toMatchObject({
      sourceTemplateName: "数据库训练方案",
      localDate: "2026-08-25",
      items: [
        {
          exerciseName: "杠铃卧推",
          status: "completed",
          target: { targetSets: 3 },
          sets: [{ reps: 8, weightKg: "62.500" }],
        },
      ],
    });
    await expect(training.listSessionItemRevisions(account.id, session.id)).resolves.toEqual([
      expect.objectContaining({ sessionItemId: itemId, status: "pending", performedExerciseName: null, sets: [] }),
    ]);
    const moved = await training.updateSessionMetadata(account.id, session.id, session.revision, {
      localDate: "2026-08-24",
      note: "数据库中修正跨午夜归属",
    });
    expect(moved).toMatchObject({ localDate: "2026-08-24", timeZone: "Asia/Shanghai" });
    await expect(training.listSessionRevisions(account.id, session.id)).resolves.toEqual([
      expect.objectContaining({ localDate: "2026-08-25", timeZone: "Asia/Shanghai", note: null }),
    ]);
    let assessed = await training.finishSession(account.id, moved.id, moved.revision, "completed");
    assessed = await training.assessSessionExpenditure(account.id, assessed.id, assessed.revision, {
      activityCode: "barbell_bench_25rm",
      durationMinutes: 30,
    });
    expect(assessed.expenditureAssessment).toMatchObject({
      status: "estimated",
      grossEnergyKcal: 171.5,
      netEnergyKcal: 136.5,
      methodVersion: "training-expenditure-e003-v1",
      inputSnapshot: {
        localDate: "2026-08-24",
        profileRevision: 1,
        weightMeasurement: { id: weight.id, revision: 1, weightKg: 70 },
      },
    });
    assessed = await training.assessSessionExpenditure(account.id, assessed.id, assessed.revision, {
      activityCode: null,
      durationMinutes: null,
    });
    expect(assessed.expenditureAssessment).toMatchObject({ status: "unavailable", grossEnergyKcal: null });
    await expect(training.listSessionRevisions(account.id, assessed.id)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ expenditureAssessment: expect.objectContaining({ grossEnergyKcal: 171.5 }) }),
      expect.objectContaining({ expenditureAssessment: null }),
    ]));
  });

  it("persists a copied cycle unit, explicit refresh, and cycle workout snapshot", async () => {
    const identity = new IdentityService({
      repository: new PostgresIdentityRepository(database.database),
      sessionSecret: "a-cycle-integration-session-secret-long-enough",
      sessionTtlHours: 1,
      maxAccounts: 100,
    });
    const username = `cycle_${randomUUID().replaceAll("-", "")}`.slice(0, 32);
    const account = (await identity.register(username, "a cycle integration secure password")).account;
    const training = new TrainingService({
      repository: new PostgresTrainingRepository(database.database),
      now: () => new Date("2026-08-25T03:30:00.000Z"),
    });
    const emptyTarget = {
      targetSets: null,
      targetRepsMin: null,
      targetRepsMax: null,
      targetWeightKg: null,
      targetDurationSeconds: null,
      targetDistanceMeters: null,
      note: null,
    } as const;
    let template = await training.createTemplate(account.id, {
      name: "胸部 A",
      note: null,
      items: [{ ...emptyTarget, exerciseName: "杠铃卧推", targetSets: 3 }],
    });
    let program = await training.createProgram(account.id, {
      name: "两周训练",
      note: null,
      weekCount: 2,
    });
    program = await training.addProgramUnit(
      account.id,
      program.id,
      program.revision,
      { weekNumber: 2, name: "", note: null, items: [] },
      template.id,
    );
    template = await training.updateTemplate(account.id, template.id, template.revision, {
      name: "胸部 B",
      note: null,
      items: [{ ...emptyTarget, exerciseName: "哑铃卧推", targetSets: 4 }],
    });
    expect(program.units[0]).toMatchObject({
      name: "胸部 A",
      sourceTemplateRevision: 1,
      items: [{ exerciseName: "杠铃卧推", targetSets: 3 }],
    });

    program = await training.reimportProgramUnit(
      account.id,
      program.id,
      program.units[0]!.id,
      program.revision,
    );
    expect(program.units[0]).toMatchObject({
      name: "胸部 B",
      sourceTemplateRevision: template.revision,
      items: [{ exerciseName: "哑铃卧推", targetSets: 4 }],
    });

    const session = await training.startProgramSession(
      account.id,
      program.id,
      program.units[0]!.id,
      "Asia/Shanghai",
    );
    expect(session).toMatchObject({
      sourceTemplateId: null,
      sourceProgramName: "两周训练",
      sourceWeekNumber: 2,
      sourceTrainingDayName: "胸部 B",
      localDate: "2026-08-25",
      items: [{ exerciseName: "哑铃卧推", target: { targetSets: 4 } }],
    });
    await expect(training.getProgram(account.id, program.id)).resolves.toMatchObject({
      units: [{ started: true }],
    });
  });

  it("persists a dated schedule and creates its actual workout only once", async () => {
    const identity = new IdentityService({
      repository: new PostgresIdentityRepository(database.database),
      sessionSecret: "a-schedule-integration-session-secret-long-enough",
      sessionTtlHours: 1,
      maxAccounts: 100,
    });
    const username = `schedule_${randomUUID().replaceAll("-", "")}`.slice(0, 32);
    const account = (await identity.register(username, "a schedule integration secure password")).account;
    const training = new TrainingService({
      repository: new PostgresTrainingRepository(database.database),
      now: () => new Date("2026-08-25T03:30:00.000Z"),
    });
    const emptyTarget = {
      targetSets: null,
      targetRepsMin: null,
      targetRepsMax: null,
      targetWeightKg: null,
      targetDurationSeconds: null,
      targetDistanceMeters: null,
      note: null,
    } as const;
    const template = await training.createTemplate(account.id, {
      name: "周三力量训练",
      note: null,
      items: [{ ...emptyTarget, exerciseName: "硬拉", targetSets: 3 }],
    });
    const schedule = await training.createSchedule(account.id, {
      localDate: "2026-08-26",
      timeZone: "Asia/Shanghai",
      title: "",
      note: "晚饭前后都可以开始",
      sourceTemplateId: template.id,
      sourceProgramId: null,
      sourceProgramUnitId: null,
    });

    await expect(training.listSchedules(account.id, "2026-08-26", "2026-08-26")).resolves.toEqual([
      expect.objectContaining({ id: schedule.id, title: "周三力量训练", status: "scheduled" }),
    ]);
    const session = await training.startScheduledSession(account.id, schedule.id);
    expect(session).toMatchObject({
      sourceScheduleId: schedule.id,
      sourceScheduleTitle: "周三力量训练",
      sourceTemplateName: "周三力量训练",
      localDate: "2026-08-26",
      items: [{ exerciseName: "硬拉", target: { targetSets: 3 } }],
    });
    await expect(training.startScheduledSession(account.id, schedule.id)).rejects.toMatchObject({
      code: "training_schedule_unavailable",
    });
    await expect(
      training.listSessions(account.id, { dateFrom: "2026-08-26", dateTo: "2026-08-26" }),
    ).resolves.toEqual([expect.objectContaining({ id: session.id })]);
    await expect(training.listSchedules(account.id, "2026-08-26", "2026-08-26")).resolves.toEqual([
      expect.objectContaining({ status: "started", startedSessionId: session.id }),
    ]);
  });

  it("persists independent training reminder settings and daily snooze state", async () => {
    const identity = new IdentityService({
      repository: new PostgresIdentityRepository(database.database),
      sessionSecret: "a-reminder-integration-session-secret-long-enough",
      sessionTtlHours: 1,
      maxAccounts: 100,
    });
    const username = `reminder_${randomUUID().replaceAll("-", "")}`.slice(0, 32);
    const account = (await identity.register(username, "a reminder integration secure password")).account;
    const now = new Date("2026-08-26T11:00:00.000Z");
    const training = new TrainingService({ repository: new PostgresTrainingRepository(database.database), now: () => now });
    const reminders = new ReminderService({
      repository: new PostgresReminderRepository(database.database),
      trainingService: training,
      now: () => now,
    });
    await reminders.updateTrainingSettings(account.id, 0, { enabled: true, localTime: "18:00", timeZone: "Asia/Shanghai" });
    await training.createSchedule(account.id, {
      localDate: "2026-08-26",
      timeZone: "Asia/Shanghai",
      title: "提醒测试训练",
      note: null,
      sourceTemplateId: null,
      sourceProgramId: null,
      sourceProgramUnitId: null,
    });

    await expect(reminders.getTrainingStatus(account.id, "2026-08-26", "Asia/Shanghai")).resolves.toMatchObject({ state: "due", scheduleCount: 1 });
    await reminders.snoozeTraining(account.id, "2026-08-26", 60);
    await expect(reminders.getTrainingStatus(account.id, "2026-08-26", "Asia/Shanghai")).resolves.toMatchObject({ state: "snoozed" });
  });

  it("persists planning inputs, measurement revisions, and immutable daily references", async () => {
    const identity = new IdentityService({
      repository: new PostgresIdentityRepository(database.database),
      sessionSecret: "a-planning-integration-session-secret-long-enough",
      sessionTtlHours: 1,
      maxAccounts: 100,
    });
    const username = `planning_${randomUUID().replaceAll("-", "")}`.slice(0, 32);
    const account = (await identity.register(username, "a planning integration secure password")).account;
    const planning = new PlanningService(new PostgresPlanningRepository(database.database));
    const profileInput = {
      revision: 0,
      birthDate: "2004-08-26",
      sexCategory: "female",
      heightCm: 165,
      pregnantOrBreastfeeding: false,
      medicalNutritionCondition: false,
      specialBodyComposition: false,
      palCategory: "low_active",
    } as const;
    const strategyInput = {
      revision: 0,
      weightStrategy: "maintain",
      macroPreference: "balanced",
      regularExercise: false,
      trainingIntent: null,
      targetWeightKg: null,
      targetDate: null,
    } as const;
    await planning.updateProfile(account.id, profileInput.revision, profileInput);
    await planning.updateStrategy(account.id, strategyInput.revision, strategyInput);
    const measurement = await planning.createMeasurement(account.id, {
      measuredAt: "2026-08-26T00:00:00.000Z",
      localDate: "2026-08-26",
      timeZone: "Asia/Shanghai",
      weightKg: 63,
      waistCm: 72,
      note: null,
    });
    const first = await planning.getDailyReference(account.id, "2026-08-26", "Asia/Shanghai");
    expect(first).toMatchObject({ revision: 1, result: { maintenanceKcal: 2275, status: "ready" } });
    await planning.updateMeasurement(account.id, measurement.id, measurement.revision, {
      measuredAt: measurement.measuredAt.toISOString(),
      localDate: measurement.localDate,
      timeZone: measurement.timeZone,
      weightKg: 64,
      waistCm: 72,
      note: "修正误录",
    });
    await expect(planning.listMeasurementRevisions(account.id, measurement.id)).resolves.toEqual([
      expect.objectContaining({ measurementRevision: 1, weightKg: 63 }),
    ]);
    const second = await planning.getDailyReference(account.id, "2026-08-26", "Asia/Shanghai");
    expect(second.revision).toBe(2);
    expect(second.inputSnapshot.measurement?.weightKg).toBe(64);
    expect(first.inputSnapshot.measurement?.weightKg).toBe(63);
    await expect(planning.listMeasurements(randomUUID())).resolves.toEqual([]);
  });

  it("creates a needs-profile daily reference through the restricted API role", async () => {
    const identity = new IdentityService({
      repository: new PostgresIdentityRepository(database.database),
      sessionSecret: "a-restricted-planning-integration-secret-long-enough",
      sessionTtlHours: 1,
      maxAccounts: 100,
    });
    const username = `restricted_planning_${randomUUID().replaceAll("-", "")}`.slice(0, 32);
    const account = (await identity.register(username, "a restricted planning integration password")).account;
    const context = new DatabaseUserContext();
    const apiDatabase = createDatabase(apiRoleDatabaseUrl(), context);

    try {
      const planning = new PlanningService(new PostgresPlanningRepository(apiDatabase.database));
      const references = await context.run(account.id, () =>
        Promise.all([
          planning.getDailyReference(account.id, "2026-08-28", "Asia/Shanghai"),
          planning.getDailyReference(account.id, "2026-08-28", "Asia/Shanghai"),
        ]),
      );

      expect(references[0]).toMatchObject({
        revision: 1,
        result: {
          status: "needs_profile",
          localDate: "2026-08-28",
        },
      });
      expect(references[1]).toMatchObject({ id: references[0].id, revision: 1 });
      const stored = await database.pool.query<{ count: number; maximum_revision: number }>(
        `select count(*)::int as count, max(revision)::int as maximum_revision
         from daily_planning_references
         where user_id = $1 and local_date = $2`,
        [account.id, "2026-08-28"],
      );
      expect(stored.rows).toEqual([{ count: 1, maximum_revision: 1 }]);
    } finally {
      await apiDatabase.close();
    }
  });

  it("persists account-scoped meals, contribution corrections, coverage, and soft deletion", async () => {
    const identity = new IdentityService({
      repository: new PostgresIdentityRepository(database.database),
      sessionSecret: "a-nutrition-integration-session-secret-long-enough",
      sessionTtlHours: 1,
      maxAccounts: 100,
    });
    const username = `nutrition_${randomUUID().replaceAll("-", "")}`.slice(0, 32);
    const account = (await identity.register(username, "a nutrition integration secure password")).account;
    const nutrition = new NutritionService(new PostgresNutritionRepository(database.database));
    let meal = await nutrition.createMeal(account.id, {
      occurredAt: "2026-08-26T04:00:00.000Z",
      localDate: "2026-08-26",
      timeZone: "Asia/Shanghai",
      name: "午饭",
      note: null,
    });
    meal = await nutrition.addContribution(account.id, meal.id, meal.revision, {
      mode: "item",
      label: "米饭",
      portionAmount: 200,
      portionUnit: "g",
      basisDescription: "食堂一碗",
      energyKcal: 232,
      proteinGrams: 5.2,
      carbohydrateGrams: 51.8,
      fatGrams: null,
    }, false);
    const contribution = meal.contributions[0]!;
    meal = await nutrition.updateContribution(account.id, meal.id, contribution.id, meal.revision, contribution.revision, {
      mode: "item",
      label: "米饭",
      portionAmount: 200,
      portionUnit: "g",
      basisDescription: "修正后",
      energyKcal: 250,
      proteinGrams: 5.2,
      carbohydrateGrams: 51.8,
      fatGrams: null,
    }, false);
    await expect(nutrition.listContributionRevisions(account.id, meal.id)).resolves.toEqual([
      expect.objectContaining({ contributionRevision: 1, energyKcal: 232 }),
    ]);
    await nutrition.setCoverageConfirmed(account.id, "2026-08-26", true);
    await expect(nutrition.getDaySummary(account.id, "2026-08-26", { energyKcal: 2200, proteinGrams: 100, carbohydrateGrams: 300, fatGrams: 70 })).resolves.toMatchObject({ coverageConfirmed: true, energyKcal: { recorded: 250 }, fatGrams: { recorded: null } });
    const plan = await nutrition.createDietPlan(account.id, {
      dateFrom: "2026-08-24",
      dateTo: "2026-08-30",
      title: "数据库饮食安排",
      note: "只描述准备怎么吃",
      entries: [{ localDate: "2026-08-26", mealName: "午饭", foodPlan: "米饭半份、鸡腿一份", note: null }],
    });
    await expect(nutrition.listDietPlans(account.id, "2026-08-26", "2026-08-26")).resolves.toEqual([
      expect.objectContaining({ id: plan.id, title: "数据库饮食安排", entries: [expect.objectContaining({ mealName: "午饭" })] }),
    ]);
    await expect(nutrition.listDietPlans(randomUUID(), "2026-08-26", "2026-08-26")).resolves.toEqual([]);
    await expect(nutrition.listMeals(randomUUID(), "2026-08-26", "2026-08-26")).resolves.toEqual([]);
    await nutrition.deleteMeal(account.id, meal.id, meal.revision);
    await expect(nutrition.listMeals(account.id, "2026-08-26", "2026-08-26")).resolves.toEqual([]);
  });

  it("atomically creates one tentative photo estimate without replacing a manual meal", async () => {
    const identity = new IdentityService({
      repository: new PostgresIdentityRepository(database.database),
      sessionSecret: "an-image-integration-session-secret-long-enough",
      sessionTtlHours: 1,
      maxAccounts: 100,
    });
    const username = `image_${randomUUID().replaceAll("-", "")}`.slice(0, 32);
    const account = (await identity.register(username, "an image integration secure password")).account;
    const nutrition = new NutritionService(new PostgresNutritionRepository(database.database));
    const images = new PostgresImageAnalysisRepository(database.database);
    const candidate = {
      title: "食堂鸡腿套餐",
      observedFoods: [{ label: "米饭", estimatedPortion: "一碗", note: null }],
      energyKcal: 620,
      proteinGrams: 34,
      carbohydrateGrams: 72,
      fatGrams: 21,
      confidence: "medium" as const,
      assumptions: ["按照片可见盛取量估算"],
      uncertaintyNote: "烹调油和实际剩余量未知",
    };

    const emptyMeal = await nutrition.createMeal(account.id, { occurredAt: "2026-08-26T04:00:00.000Z", localDate: "2026-08-26", timeZone: "Asia/Shanghai", name: "照片午饭", note: null });
    const analysis = await images.create(account.id, emptyMeal.id, "image/jpeg", { objectKey: `integration/${randomUUID()}.jpg`, byteSize: 128, sha256: "a".repeat(64) }, new Date("2026-08-27T00:00:00.000Z"), "deepseek-vision", "nutrition-photo-v1");
    const attempt = await images.beginAttempt(analysis.id);
    if (attempt === "not_found" || attempt === "not_ready") throw new Error("expected image analysis attempt");
    await expect(images.succeed(analysis.id, attempt.attemptId, candidate, "provider-integration-1")).resolves.toEqual({ status: "succeeded", tentativeHandled: true });
    await expect(images.succeed(analysis.id, attempt.attemptId, candidate, "provider-integration-duplicate")).resolves.toBe("not_running");
    await expect(nutrition.listMeals(account.id, "2026-08-26", "2026-08-26")).resolves.toEqual([
      expect.objectContaining({ id: emptyMeal.id, contributions: [expect.objectContaining({ sourceAnalysisId: analysis.id, reviewStatus: "tentative", energyKcal: 620 })] }),
    ]);

    let manualMeal = await nutrition.createMeal(account.id, { occurredAt: "2026-08-26T10:00:00.000Z", localDate: "2026-08-26", timeZone: "Asia/Shanghai", name: "手工晚饭", note: null });
    manualMeal = await nutrition.addContribution(account.id, manualMeal.id, manualMeal.revision, { mode: "item", label: "手工米饭", portionAmount: 200, portionUnit: "g", basisDescription: null, energyKcal: 232, proteinGrams: null, carbohydrateGrams: null, fatGrams: null }, false);
    const manualAnalysis = await images.create(account.id, manualMeal.id, "image/jpeg", { objectKey: `integration/${randomUUID()}.jpg`, byteSize: 128, sha256: "b".repeat(64) }, new Date("2026-08-27T00:00:00.000Z"), "deepseek-vision", "nutrition-photo-v1");
    const manualAttempt = await images.beginAttempt(manualAnalysis.id);
    if (manualAttempt === "not_found" || manualAttempt === "not_ready") throw new Error("expected manual meal analysis attempt");
    await images.succeed(manualAnalysis.id, manualAttempt.attemptId, candidate, "provider-integration-2");
    await expect(nutrition.listMeals(account.id, "2026-08-26", "2026-08-26")).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: manualMeal.id, contributions: [expect.objectContaining({ label: "手工米饭", reviewStatus: "confirmed", energyKcal: 232 })] }),
    ]));
  });

  it("commits a transactional job and leaves no job after rollback", async () => {
    let committedJobId = "";
    await database.database.transaction(async (transaction) => {
      committedJobId = await queue.enqueueInTransaction(
        transactionQueueName,
        "committed-task",
        transaction,
      );
    });
    const committed = await database.pool.query<{ count: string }>(
      "select count(*) from pgboss.job where id = $1",
      [committedJobId],
    );
    expect(committed.rows[0]?.count).toBe("1");

    let rolledBackJobId = "";
    await expect(
      database.database.transaction(async (transaction) => {
        rolledBackJobId = await queue.enqueueInTransaction(
          transactionQueueName,
          "rolled-back-task",
          transaction,
        );
        throw new Error("force integration rollback");
      }),
    ).rejects.toThrow("force integration rollback");
    const rolledBack = await database.pool.query<{ count: string }>(
      "select count(*) from pgboss.job where id = $1",
      [rolledBackJobId],
    );
    expect(rolledBack.rows[0]?.count).toBe("0");
  });

  it(
    "recovers a heartbeat-protected job after its worker is killed",
    { timeout: 60_000 },
    async () => {
      const taskId = `crash-task-${randomUUID()}`;
      const jobId = await queue.enqueue(crashQueueName, taskId);
      const workerPath = resolve(import.meta.dirname, "../testing/queue-crash-worker.ts");
      const child = spawn(process.execPath, ["--import", "tsx", workerPath], {
        env: {
          ...process.env,
          TEST_QUEUE_NAME: crashQueueName,
        },
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      });

      try {
        await expect(waitForWorkerStart(child)).resolves.toBe(taskId);
        expect(child.kill("SIGKILL")).toBe(true);
        await once(child, "exit");
        expect(child.signalCode).toBe("SIGKILL");

        let resolveHandled: (value: string) => void = () => undefined;
        const handled = new Promise<string>((resolveTask) => {
          resolveHandled = resolveTask;
        });
        await queue.work(crashQueueName, async (recoveredTaskId) => {
          resolveHandled(recoveredTaskId);
        });

        await expect(handled).resolves.toBe(taskId);
        await expect(waitForCompletedJob(jobId)).resolves.toBe(1);
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
          await once(child, "exit");
        }
      }
    },
  );
});
