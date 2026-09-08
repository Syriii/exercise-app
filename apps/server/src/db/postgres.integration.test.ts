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
import { PostgresUserDataExporter } from "../modules/portability/postgres-exporter.js";
import { NutritionService } from "../modules/nutrition/service.js";
import { builtinFoods } from "../modules/nutrition/food-catalog.js";
import { FixedPublicFoodProvider } from "../modules/nutrition/public-food-provider.js";
import type { ContributionInput } from "../modules/nutrition/repository.js";
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

  it("atomically saves completion drafts, rolls back late failures, and safely retries", async () => {
    const identity = new IdentityService({
      repository: new PostgresIdentityRepository(database.database),
      sessionSecret: "a-completion-integration-session-secret-long-enough",
      sessionTtlHours: 1, maxAccounts: 100,
    });
    const account = (await identity.register(`complete_${randomUUID().replaceAll("-", "")}`.slice(0,32), "an isolated integration password")).account;
    const repository = new PostgresTrainingRepository(database.database);
    const training = new TrainingService({repository});
    const target = {targetSets:null,targetRepsMin:null,targetRepsMax:null,targetWeightKg:null,targetDurationSeconds:null,targetDistanceMeters:null,note:null};
    const template = await training.createTemplate(account.id, {name:"完整保存测试",note:null,items:[
      {...target,exerciseName:"深蹲"},{...target,exerciseName:"卧推"},
    ]});
    const other = await training.startSession(account.id,template.id,"Asia/Shanghai");
    await training.finishSession(account.id,other.id,other.revision,"completed");
    const session = await training.startSession(account.id,template.id,"Asia/Shanghai");
    const sets = [{reps:10,weightKg:"40",durationSeconds:null,distanceMeters:null,note:null}];
    const draft = {items:session.items.map(item=>({id:item.id,status:"completed" as const,performedExerciseName:item.exerciseName,actualNote:null,sets})),
      extra:{id:randomUUID(),exerciseName:"拉伸",actualNote:null,sets:[]}};
    // This PK conflict happens after item updates inside the transaction, proving rollback.
    await expect(repository.finishSession(account.id,session.id,session.revision,"completed",new Date(),{
      ...draft,extra:{...draft.extra,id:other.items[0]!.id},
    })).rejects.toThrow();
    const unchanged = await training.getSession(account.id,session.id);
    expect(unchanged.revision).toBe(session.revision);
    expect(unchanged.items.every(item=>item.status === "pending" && item.sets.length === 0)).toBe(true);
    await expect(training.listSessionItemRevisions(account.id,session.id)).resolves.toEqual([]);
    await expect(training.finishSession(randomUUID(),session.id,session.revision,"completed",draft)).rejects.toMatchObject({statusCode:404});
    const completed = await training.finishSession(account.id,session.id,session.revision,"completed",draft);
    expect(completed.revision).toBe(session.revision+1);
    expect(completed.items).toHaveLength(3);
    expect(completed.items.slice(0,2).every(item=>item.sets[0]?.reps === 10)).toBe(true);
    const retried = await training.finishSession(account.id,session.id,session.revision,"completed",draft);
    expect(retried.revision).toBe(completed.revision);
    expect(retried.items).toHaveLength(3);
    await expect(training.listSessionItemRevisions(account.id,session.id)).resolves.toHaveLength(2);
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

  it("atomically persists individual photo foods, protects deleted edits and preserves unknown templates", async () => {
    const rows = await database.pool.query<{ id: string }>("insert into users (username, normalized_username) values ($1, $1) returning id", [`photo-items-${randomUUID()}`]);
    const userId = rows.rows[0]!.id;
    const nutrition = new NutritionService(new PostgresNutritionRepository(database.database));
    const images = new PostgresImageAnalysisRepository(database.database);
    const input = { occurredAt: "2026-08-26T04:00:00.000Z", localDate: "2026-08-26", timeZone: "Asia/Shanghai", name: "单项照片", note: null };
    const foods = [
      { label: "鸡蛋", portionAmount: 2, portionUnit: "个", note: null, energyKcal: 140, proteinGrams: 12, carbohydrateGrams: 2, fatGrams: 10 },
      { label: "未知配菜", portionAmount: null, portionUnit: null, note: null, energyKcal: null, proteinGrams: null, carbohydrateGrams: null, fatGrams: null },
    ];
    const candidate = { title: "早餐", foods, observedFoods: [], energyKcal: null, proteinGrams: null, carbohydrateGrams: null, fatGrams: null, confidence: "low" as const, assumptions: [], uncertaintyNote: "照片估算" };
    const initial = await nutrition.createMeal(userId, input);
    const analysis = await images.create(userId, initial.id, "image/png", { objectKey: `integration/${randomUUID()}.png`, byteSize: 128, sha256: "c".repeat(64) }, new Date("2026-08-27T00:00:00Z"), "test", "food-items-v2");
    const attempt = await images.beginAttempt(analysis.id);
    if (typeof attempt === "string") throw new Error("expected attempt");
    const results = await Promise.all([images.succeed(analysis.id, attempt.attemptId, candidate, "test-1"), images.succeed(analysis.id, attempt.attemptId, candidate, "test-2")]);
    expect(results).toEqual(expect.arrayContaining([{ status: "succeeded", tentativeHandled: true }, "not_running"]));
    let meal = await nutrition.getMeal(userId, initial.id);
    expect(meal.revision).toBe(initial.revision + 1);
    expect(meal.contributions).toHaveLength(2);
    const eggs = meal.contributions.find((item) => item.label === "鸡蛋")!;
    meal = await nutrition.changePortion(userId, meal.id, eggs.id, meal.revision, eggs.revision, 1);
    expect(meal.contributions.find((item) => item.id === eggs.id)).toMatchObject({ energyKcal: 70, portionAmount: 1 });
    const unknown = meal.contributions.find((item) => item.label === "未知配菜")!;
    const template = await nutrition.createFoodTemplate(userId, unknown);
    expect(template).toMatchObject({ energyKcal: null, proteinGrams: null });
    for (const item of [...meal.contributions]) {
      meal = await nutrition.deleteContribution(userId, meal.id, item.id, meal.revision, item.revision);
    }
    const retry = await images.create(userId, meal.id, "image/png", { objectKey: `integration/${randomUUID()}.png`, byteSize: 128, sha256: "d".repeat(64) }, new Date("2026-08-27T00:00:00Z"), "test", "food-items-v2");
    const retryAttempt = await images.beginAttempt(retry.id);
    if (typeof retryAttempt === "string") throw new Error("expected attempt");
    await images.succeed(retry.id, retryAttempt.attemptId, candidate, "test-late");
    expect((await nutrition.getMeal(userId, meal.id)).contributions).toHaveLength(0);
  });

  it("atomically replaces complete photo results, rolls back late failures and protects undo with RLS", async () => {
    const accounts = await database.pool.query<{ id: string }>("insert into users (username, normalized_username) values ($1, $1), ($2, $2) returning id", [`replace-a-${randomUUID()}`, `replace-b-${randomUUID()}`]);
    const userId = accounts.rows[0]!.id, otherId = accounts.rows[1]!.id;
    const context = new DatabaseUserContext();
    const restricted = createDatabase(apiRoleDatabaseUrl(), context);
    const repository = new PostgresNutritionRepository(restricted.database);
    const nutrition = new NutritionService(repository);
    const images = new PostgresImageAnalysisRepository(restricted.database);
    const foods = [
      { label: "照片鸡蛋", portionAmount: 2, portionUnit: "个", note: null, energyKcal: 140, proteinGrams: 12, carbohydrateGrams: 2, fatGrams: 10 },
      { label: "照片配菜", portionAmount: null, portionUnit: null, note: null, energyKcal: null, proteinGrams: null, carbohydrateGrams: null, fatGrams: null },
    ];
    const candidate = { title: "替换照片", foods, observedFoods: [], energyKcal: null, proteinGrams: null, carbohydrateGrams: null, fatGrams: null, confidence: "low" as const, assumptions: [], uncertaintyNote: "测试估算" };
    try {
      await context.run(userId, async () => {
        let meal = await nutrition.createMeal(userId, { occurredAt: "2026-09-08T00:00:00Z", localDate: "2026-09-08", timeZone: "UTC", name: "替换验收", note: null });
        const manual = { mode: "item" as const, portionAmount: 100, portionUnit: "g", basisDescription: null, energyKcal: 100, proteinGrams: null, carbohydrateGrams: null, fatGrams: null };
        meal = await nutrition.addContribution(userId, meal.id, meal.revision, { ...manual, label: "原主食" }, false);
        meal = await nutrition.addContribution(userId, meal.id, meal.revision, { ...manual, label: "保留豆浆" }, false);
        const original = meal;
        const analysis = await images.create(userId, meal.id, "image/png", { objectKey: `integration/${randomUUID()}.png`, byteSize: 128, sha256: "e".repeat(64) }, new Date(Date.now() + 86_400_000), "fixed-test", "food-items-v2");
        const attempt = await images.beginAttempt(analysis.id);
        if (typeof attempt === "string") throw new Error("expected attempt");
        await images.succeed(analysis.id, attempt.attemptId, candidate, "test-replacement");
        expect(await nutrition.getMeal(userId, meal.id)).toEqual(original);
        const input = { operationId: randomUUID(), mealRevision: meal.revision, analysisRevision: (await images.get(userId, analysis.id))!.revision, replaceIds: [meal.contributions.find(item => item.label === "原主食")!.id] };
        // Scoped fault injection only in the explicitly isolated _test database: the second food fails after the first was inserted.
        await database.pool.query(`alter table meal_contributions add constraint integration_photo_late_failure check (meal_id <> '${meal.id}'::uuid or label <> '照片配菜')`);
        try {
          await expect(nutrition.replaceImageFoods(userId, meal.id, analysis.id, input, candidate, false)).rejects.toBeDefined();
          expect(await nutrition.getMeal(userId, meal.id)).toEqual(original);
          expect(await repository.imageReplacement(userId, analysis.id)).toBeNull();
          expect(await nutrition.listContributionRevisions(userId, meal.id)).toHaveLength(0);
        } finally { await database.pool.query("alter table meal_contributions drop constraint integration_photo_late_failure"); }
        const [saved, retry] = await Promise.all([nutrition.replaceImageFoods(userId, meal.id, analysis.id, input, candidate, false), nutrition.replaceImageFoods(userId, meal.id, analysis.id, input, candidate, false)]);
        expect(saved).toEqual(retry);
        expect(saved.revision).toBe(original.revision + 1);
        expect(saved.contributions.map(item => item.label).sort()).toEqual(["保留豆浆", "照片配菜", "照片鸡蛋"].sort());
        await expect(nutrition.replaceImageFoods(userId, meal.id, analysis.id, { ...input, replaceIds: [] }, candidate, false)).rejects.toMatchObject({ statusCode: 409 });
        await expect(nutrition.replaceImageFoods(otherId, meal.id, analysis.id, input, candidate, false)).rejects.toMatchObject({ statusCode: 404 });
        await context.run(otherId, async () => {
          expect(await images.get(otherId, analysis.id)).toBeNull();
          expect(await repository.imageReplacement(userId, analysis.id)).toBeNull();
          await expect(nutrition.replaceImageFoods(userId, meal.id, analysis.id, input, candidate, false)).rejects.toMatchObject({ statusCode: 404 });
        });
        const exported = await new PostgresUserDataExporter(restricted.database).exportUserData(userId, new Date());
        expect(exported.data.meal_image_analyses).toEqual(expect.arrayContaining([expect.objectContaining({ id: analysis.id, replacement_state: expect.objectContaining({ operationId: input.operationId }) })]));
        expect(exported.data.photo_analysis_settings).toEqual([expect.objectContaining({ automatic: false })]);
        const undo = { ...input, mealRevision: saved.revision, analysisRevision: (await images.get(userId, analysis.id))!.revision };
        const restored = await nutrition.replaceImageFoods(userId, meal.id, analysis.id, undo, candidate, true);
        expect(restored.contributions.map(item => ({ id: item.id, label: item.label, energyKcal: item.energyKcal }))).toEqual(original.contributions.map(item => ({ id: item.id, label: item.label, energyKcal: item.energyKcal })));
        expect(await nutrition.replaceImageFoods(userId, meal.id, analysis.id, undo, candidate, true)).toEqual(restored);
        // A new explicit preview after undo is allowed; old operation IDs cannot be reused.
        const again = { ...input, operationId: randomUUID(), mealRevision: restored.revision, analysisRevision: (await images.get(userId, analysis.id))!.revision };
        const reapplied = await nutrition.replaceImageFoods(userId, meal.id, analysis.id, again, candidate, false);
        expect(reapplied.contributions.filter(item => item.sourceAnalysisId === analysis.id).map(item => item.id).sort()).toEqual(saved.contributions.filter(item => item.sourceAnalysisId === analysis.id).map(item => item.id).sort());
        const egg = reapplied.contributions.find(item => item.label === "照片鸡蛋")!;
        meal = await nutrition.changePortion(userId, meal.id, egg.id, reapplied.revision, egg.revision, 1);
        await expect(nutrition.replaceImageFoods(userId, meal.id, analysis.id, { ...again, mealRevision: meal.revision, analysisRevision: (await images.get(userId, analysis.id))!.revision }, candidate, true)).rejects.toMatchObject({ statusCode: 409 });
        await expect(nutrition.replaceImageFoods(userId, meal.id, analysis.id, input, candidate, false)).rejects.toMatchObject({ statusCode: 409 });
        expect((await nutrition.getMeal(userId, meal.id)).contributions.find(item => item.id === egg.id)!.energyKcal).toBe(70);
        await nutrition.deleteMeal(userId, meal.id, meal.revision);
        await expect(nutrition.replaceImageFoods(userId, meal.id, analysis.id, again, candidate, false)).rejects.toMatchObject({ statusCode: 404 });
      });
    } finally { await restricted.close(); }
  });

  it("persists photo consent without submitting old photos and isolates reanalysis and expired originals", async () => {
    const accounts = await database.pool.query<{ id: string }>("insert into users (username, normalized_username) values ($1, $1), ($2, $2) returning id", [`photo-control-a-${randomUUID()}`, `photo-control-b-${randomUUID()}`]);
    const userId = accounts.rows[0]!.id, otherId = accounts.rows[1]!.id;
    const images = new PostgresImageAnalysisRepository(database.database);
    const nutrition = new NutritionService(new PostgresNutritionRepository(database.database));
    const meal = await nutrition.createMeal(userId, { occurredAt: "2026-09-08T00:00:00Z", localDate: "2026-09-08", timeZone: "UTC", name: "手动识别", note: null });
    expect(await images.getSettings(userId)).toEqual({ automatic: false, consentAt: null, revision: 1 });
    const media = { objectKey: `integration/${randomUUID()}.png`, byteSize: 128, sha256: "f".repeat(64) };
    const waiting = await images.create(userId, meal.id, "image/png", media, new Date(Date.now() + 86_400_000), "fixed-test", "food-items-v2", false);
    expect(await images.beginAttempt(waiting.id)).toBe("not_ready");
    expect(await images.saveSettings(userId, 1, true, true)).toMatchObject({ automatic: true, revision: 2, consentAt: expect.any(Date) });
    expect(await images.saveSettings(userId, 1, false, false)).toBe("revision_conflict");
    expect(await images.getSettings(otherId)).toMatchObject({ automatic: false, consentAt: null });
    expect((await images.get(userId, waiting.id))!.status).toBe("waiting");
    expect(await images.retry(otherId, waiting.id, waiting.revision)).toBe("not_found");
    expect(await images.retry(userId, waiting.id, waiting.revision)).toMatchObject({ status: "pending" });
    expect(await images.retry(userId, waiting.id, waiting.revision)).toBe("revision_conflict");
    const attempt = await images.beginAttempt(waiting.id);
    if (typeof attempt === "string") throw new Error("expected attempt");
    const candidate = { title: "固定测试结果", observedFoods: [], foods: [{ label: "鸡蛋", portionAmount: 1, portionUnit: "个", note: null, energyKcal: 70, proteinGrams: 6, carbohydrateGrams: 1, fatGrams: 5 }], energyKcal: 70, proteinGrams: 6, carbohydrateGrams: 1, fatGrams: 5, confidence: "low" as const, assumptions: [], uncertaintyNote: "固定测试" };
    await images.succeed(waiting.id, attempt.attemptId, candidate, "fixed-test");
    const completed = (await images.get(userId, waiting.id))!;
    const again = await images.reanalyze(userId, completed.id, completed.revision);
    if (typeof again === "string") throw new Error("expected new analysis");
    expect(again.id).not.toBe(completed.id);
    expect(again).toMatchObject({ status: "pending", candidate: null });
    expect((await images.get(userId, completed.id))!.candidate).toEqual(candidate);
    expect(await images.reanalyze(userId, completed.id, completed.revision)).toBe("revision_conflict");
    expect((await images.getUsage(userId)).temporaryMediaBytes).toBe(128);
    const work = await images.getWorkItem(completed.id);
    await database.pool.query("update temporary_media set expires_at = now() - interval '1 second' where id = $1", [work!.mediaId]);
    expect((await images.get(userId, completed.id))!.imageAvailable).toBe(false);
    expect(await images.reanalyze(userId, completed.id, (await images.get(userId, completed.id))!.revision)).toBe("not_ready");
    const expired = await images.create(userId, meal.id, "image/png", { ...media, objectKey: `integration/${randomUUID()}.png` }, new Date(Date.now() - 1000), "fixed-test", "food-items-v2", false);
    expect(await images.retry(userId, expired.id, expired.revision)).toBe("not_failed");
    const reattempt = await images.beginAttempt(again.id);
    if (typeof reattempt === "string") throw new Error("expected reanalysis attempt");
    await images.markMediaStatus(work!.mediaId, "deleted");
    expect(await images.succeed(again.id, reattempt.attemptId, candidate, "deleted-late-result")).toBe("not_running");
    expect(await images.get(userId, again.id)).toMatchObject({ status: "cancelled", candidate: null });
    expect((await images.get(userId, completed.id))!.candidate).toEqual(candidate);
  });

  it("persists catalog preferences and immutable food snapshots with atomic batch retries and RLS", async () => {
    const accounts = await database.pool.query<{ id: string }>("insert into users (username, normalized_username) values ($1, $1), ($2, $2) returning id", [`catalog-a-${randomUUID()}`, `catalog-b-${randomUUID()}`]);
    const userId = accounts.rows[0]!.id, otherId = accounts.rows[1]!.id;
    const repository = new PostgresNutritionRepository(database.database);
    const service = new NutritionService(repository);
    const egg = builtinFoods.find((food) => food.id === "usda:173424")!;
    await Promise.all([service.setFoodFavorite(userId, egg.id, true), service.setFoodFavorite(userId, egg.id, true)]);
    expect((await repository.listFoodTemplates(userId)).filter((food) => food.catalogKey === egg.id)).toHaveLength(1);
    expect((await service.getFoodCatalog(userId)).items[0]).toMatchObject({ id: egg.id, isFavorite: true });
    expect((await service.getFoodCatalog(otherId, "鸡蛋")).items[0]!.isFavorite).toBe(false);
    const personal = await service.createPersonalFood(userId, { mode: "item", label: "未知配菜", portionAmount: 100, portionUnit: "g", basisDescription: null, category: "vegetables", energyKcal: null, proteinGrams: null, carbohydrateGrams: null, fatGrams: null });
    const input = { occurredAt: "2026-09-07T00:00:00Z", localDate: "2026-09-07", timeZone: "UTC", name: "目录验收", note: null };
    const meal = await service.createMeal(userId, input);
    const choices = [{ foodId: egg.id, version: egg.version, amount: 200 }, { foodId: personal.id, version: personal.version, amount: 50 }];
    const submission = randomUUID();
    const [saved, retry] = await Promise.all([service.addFoodSelections(userId, meal.id, 1, submission, choices), service.addFoodSelections(userId, meal.id, 1, submission, choices)]);
    expect(saved.contributions).toHaveLength(2);
    expect(retry).toEqual(saved);
    await expect(service.addFoodSelections(userId, meal.id, saved.revision, submission, choices.slice(0, 1))).rejects.toMatchObject({ statusCode: 409 });
    expect(saved.contributions.find((c) => c.foodSnapshot?.id === egg.id)).toMatchObject({ energyKcal: 310, foodSnapshot: { basisAmount: 100, energyKcal: 155 } });
    expect(saved.contributions.find((c) => c.foodSnapshot?.id === personal.id)!.energyKcal).toBeNull();
    await expect(service.addFoodSelections(otherId, meal.id, 1, submission, choices)).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.setFoodFavorite(otherId, personal.id, true)).rejects.toMatchObject({ statusCode: 404 });
    const item = saved.contributions.find((c) => c.foodSnapshot?.id === egg.id)!;
    const changed = await service.changePortion(userId, meal.id, item.id, saved.revision, item.revision, 50);
    expect(changed.contributions.find((c) => c.id === item.id)!.energyKcal).toBe(77.5);
    expect((await service.listContributionRevisions(userId, meal.id))[0]!.foodSnapshot).toEqual(item.foodSnapshot);
    await service.setFoodFavorite(userId, egg.id, false);
    expect((await service.getMeal(userId, meal.id)).contributions).toEqual(changed.contributions);
    await expect(service.addFoodSelections(userId, meal.id, 1, submission, choices)).rejects.toMatchObject({ statusCode: 409 });

    // A late PK collision must roll back the earlier entry and parent revision.
    const empty = await service.createMeal(userId, input);
    const firstId = randomUUID();
    const contribution: ContributionInput = { mode: "item", source: "manual", reviewStatus: "confirmed", sourceAnalysisId: null, label: "事务测试", portionAmount: 1, portionUnit: "份", basisDescription: null, energyKcal: null, proteinGrams: null, carbohydrateGrams: null, fatGrams: null, foodSnapshot: null };
    await expect(repository.addSelectedFoods(userId, empty.id, 1, [{ ...contribution, id: firstId }, { ...contribution, id: item.id }], randomUUID())).rejects.toBeDefined();
    expect(await service.getMeal(userId, empty.id)).toMatchObject({ revision: 1, contributions: [] });
    expect((await database.pool.query("select id from meal_contributions where id = $1", [firstId])).rowCount).toBe(0);

    const client = await database.pool.connect();
    try {
      await client.query("begin"); await client.query("set local role exercise_api");
      await client.query("select set_config('exercise.user_id', $1, true)", [otherId]);
      expect((await client.query("select catalog_metadata from personal_food_templates where user_id = $1", [userId])).rowCount).toBe(0);
      expect((await client.query("select food_snapshot from meal_contributions where meal_id = $1", [meal.id])).rowCount).toBe(0);
      expect((await client.query("update personal_food_templates set is_favorite = true where user_id = $1", [userId])).rowCount).toBe(0);
      await client.query("rollback");
    } finally { client.release(); }
  });

  it("deduplicates personal food creation and packaged favorites while rejecting changed and deleted retries", async () => {
    const accounts = await database.pool.query<{ id: string }>("insert into users (username, normalized_username) values ($1, $1), ($2, $2) returning id", [`food-retry-a-${randomUUID()}`, `food-retry-b-${randomUUID()}`]);
    const owner = accounts.rows[0]!.id, other = accounts.rows[1]!.id;
    const repository = new PostgresNutritionRepository(database.database);
    const service = new NutritionService(repository, new FixedPublicFoodProvider([
      { id: "open_food_facts:12345678", provider: "open_food_facts", label: "隔离测试豆奶", brand: null, barcode: "12345678", basisAmount: 100, basisUnit: "g", energyKcal: 60, proteinGrams: 4, carbohydrateGrams: null, fatGrams: null, sourceUrl: "https://world.openfoodfacts.org/product/12345678" },
    ]));
    const input = { submissionId: randomUUID(), mode: "item" as const, label: "防重复配菜", category: "vegetables" as const, portionAmount: 100.00049, portionUnit: "g", basisDescription: null, energyKcal: 12.34567, proteinGrams: null, carbohydrateGrams: null, fatGrams: null };
    const [first, retry] = await Promise.all([service.createPersonalFood(owner, input), service.createPersonalFood(owner, input)]);
    expect(retry).toEqual(first);
    expect(first).toMatchObject({ basisAmount: 100, energyKcal: 12.346 });
    expect((await service.getFoodCatalog(owner, input.label)).total).toBe(1);
    expect((await service.createPersonalFood(other, input)).id).not.toBe(first.id);
    await service.setFoodFavorite(owner, first.id, true);
    expect(await service.createPersonalFood(owner, input)).toMatchObject({ id: first.id, isFavorite: true });
    await expect(service.createPersonalFood(owner, { ...input, energyKcal: 10 })).rejects.toMatchObject({ statusCode: 409 });
    const original = (await repository.listFoodTemplates(owner)).find(food => `personal:${food.id}` === first.id)!;
    const edited = await repository.updateFoodTemplate(owner, original.id, 1, { ...original, label: "已修正的配菜" });
    expect(typeof edited).toBe("object");
    await expect(service.createPersonalFood(owner, input)).rejects.toMatchObject({ statusCode: 409 });
    await repository.deleteFoodTemplate(owner, original.id, 2);
    await expect(service.createPersonalFood(owner, input)).rejects.toMatchObject({ statusCode: 409 });
    expect((await service.getFoodCatalog(owner, input.label)).total).toBe(0);
    const food = (await service.searchFoodCatalog(owner, "隔离测试豆奶")).items[0]!;
    const records = [];
    for (const amount of [100, 250]) {
      const meal = await service.createMeal(owner, { occurredAt: "2026-09-08T00:00:00Z", localDate: "2026-09-08", timeZone: "UTC", name: "回存常用", note: null });
      records.push(await service.addFoodSelections(owner, meal.id, 1, randomUUID(), [{ foodId: food.id, version: food.version, amount }]));
    }
    const cold = new NutritionService(repository);
    await Promise.all(records.map(meal => cold.favoriteMealFood(owner, meal.id, meal.contributions[0]!.id)));
    const favorites = await cold.getFoodCatalog(owner, "隔离测试豆奶");
    expect(favorites.total).toBe(1);
    expect(favorites.items[0]).toMatchObject({ id: food.id, version: food.version, basisAmount: 100, energyKcal: 60 });
    for (const meal of records) expect(await cold.getMeal(owner, meal.id)).toEqual(meal);
    await expect(cold.favoriteMealFood(other, records[0]!.id, records[0]!.contributions[0]!.id)).rejects.toMatchObject({ statusCode: 404 });
    const client = await database.pool.connect();
    try {
      await client.query("begin"); await client.query("set local role exercise_api");
      await client.query("select set_config('exercise.user_id', $1, true)", [other]);
      expect((await client.query("select id from personal_food_templates where user_id=$1", [owner])).rowCount).toBe(0);
      expect((await client.query("update personal_food_templates set is_favorite=true where user_id=$1", [owner])).rowCount).toBe(0);
      await client.query("rollback");
    } finally { client.release(); }
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
