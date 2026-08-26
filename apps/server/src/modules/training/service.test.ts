import { describe, expect, it } from "vitest";

import { MemoryPlanningRepository } from "../planning/memory-repository.js";
import { PlanningService } from "../planning/service.js";
import { TrainingError } from "./errors.js";
import { MemoryTrainingRepository } from "./memory-repository.js";
import { TrainingService } from "./service.js";

const emptyTarget = {
  targetSets: null,
  targetRepsMin: null,
  targetRepsMax: null,
  targetWeightKg: null,
  targetDurationSeconds: null,
  targetDistanceMeters: null,
  note: null,
} as const;

function createService() {
  const repository = new MemoryTrainingRepository();
  const now = new Date("2026-08-25T03:30:00.000Z");
  const service = new TrainingService({ repository, now: () => now });
  return { repository, service };
}

describe("TrainingService", () => {
  it("returns only guidance with explicit source, license, version, and review state", () => {
    const { service } = createService();
    expect(service.getExerciseGuidance("罗马尼亚硬拉")).toMatchObject({
      exerciseName: "硬拉",
      sourceName: "Exercise App contributors",
      license: "MIT",
      reviewStatus: "draft",
      videoUrl: null,
    });
    expect(service.getExerciseGuidance("不存在的自定义动作")).toBeNull();
  });

  it("keeps the plan snapshot after the source template changes", async () => {
    const { service } = createService();
    const template = await service.createTemplate("user-a", {
      name: "胸部 A",
      note: null,
      items: [{ ...emptyTarget, exerciseName: "杠铃卧推", targetSets: 4, targetRepsMin: 8, targetRepsMax: 10 }],
    });
    const session = await service.startSession("user-a", template.id, "Asia/Shanghai");

    await service.updateTemplate("user-a", template.id, template.revision, {
      name: "胸部 B",
      note: null,
      items: [{ ...emptyTarget, exerciseName: "哑铃卧推", targetSets: 3 }],
    });

    const stored = await service.getSession("user-a", session.id);
    expect(stored.sourceTemplateName).toBe("胸部 A");
    expect(stored.items[0]).toMatchObject({ exerciseName: "杠铃卧推", target: { targetSets: 4 } });
  });

  it("records completion without turning omitted measurements into zero", async () => {
    const { service } = createService();
    const session = await service.startSession("user-a", null, "Asia/Shanghai");
    const withExtra = await service.addExtraSessionItem("user-a", session.id, session.revision, {
      exerciseName: "散步",
      actualNote: "  饭后活动  ",
      sets: [{ reps: null, weightKg: null, durationSeconds: null, distanceMeters: null, note: null }],
    });

    expect(withExtra.items[0]?.sets[0]).toMatchObject({
      reps: null,
      weightKg: null,
      durationSeconds: null,
      distanceMeters: null,
    });
    expect(withExtra.items[0]?.actualNote).toBe("饭后活动");
  });

  it("keeps planned and performed exercise names separate and allows a traced correction", async () => {
    const { service } = createService();
    const template = await service.createTemplate("user-a", {
      name: "腿部训练",
      note: null,
      items: [{ ...emptyTarget, exerciseName: "杠铃深蹲", targetSets: 3 }],
    });
    let session = await service.startSession("user-a", template.id, "Asia/Shanghai");
    const itemId = session.items[0]!.id;
    session = await service.updateSessionItem("user-a", session.id, itemId, session.revision, {
      status: "completed",
      performedExerciseName: "高脚杯深蹲",
      actualNote: "器械占用，临时替换",
      sets: [{ reps: 10, weightKg: "24", durationSeconds: null, distanceMeters: null, note: null }],
    });
    session = await service.finishSession("user-a", session.id, session.revision, "completed");
    session = await service.updateSessionItem("user-a", session.id, itemId, session.revision, {
      status: "completed",
      performedExerciseName: "高脚杯深蹲",
      actualNote: "修正为实际重量",
      sets: [{ reps: 10, weightKg: "26", durationSeconds: null, distanceMeters: null, note: null }],
    });

    expect(session.items[0]).toMatchObject({
      exerciseName: "杠铃深蹲",
      performedExerciseName: "高脚杯深蹲",
      actualNote: "修正为实际重量",
      sets: [{ weightKg: "26" }],
    });
    const revisions = await service.listSessionItemRevisions("user-a", session.id);
    expect(revisions).toHaveLength(2);
    expect(revisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "pending", performedExerciseName: null }),
      expect.objectContaining({ status: "completed", performedExerciseName: "高脚杯深蹲", sets: [expect.objectContaining({ weightKg: "24" })] }),
    ]));

    session = await service.updateSessionMetadata("user-a", session.id, session.revision, {
      localDate: "2026-08-24",
      note: "跨午夜后修正归属日",
    });
    expect(session).toMatchObject({ localDate: "2026-08-24", timeZone: "Asia/Shanghai", note: "跨午夜后修正归属日" });
    await expect(service.listSessionRevisions("user-a", session.id)).resolves.toEqual([
      expect.objectContaining({ localDate: "2026-08-25", timeZone: "Asia/Shanghai", note: null }),
    ]);

    const skipped = await service.updateSessionItem("user-a", session.id, itemId, session.revision, {
      status: "skipped",
      performedExerciseName: "不应保留",
      actualNote: "当天不适合继续",
      sets: [{ reps: 99, weightKg: "99", durationSeconds: null, distanceMeters: null, note: null }],
    });
    expect(skipped.items[0]).toMatchObject({
      status: "skipped",
      performedExerciseName: null,
      actualNote: "当天不适合继续",
      sets: [],
    });
  });

  it("rejects stale writes instead of silently overwriting a session", async () => {
    const { service } = createService();
    const session = await service.startSession("user-a", null, "Asia/Shanghai");
    await service.addExtraSessionItem("user-a", session.id, session.revision, {
      exerciseName: "深蹲",
      actualNote: null,
      sets: [],
    });

    await expect(
      service.addExtraSessionItem("user-a", session.id, session.revision, {
        exerciseName: "硬拉",
        actualNote: null,
        sets: [],
      }),
    ).rejects.toMatchObject({ code: "training_revision_conflict" } satisfies Partial<TrainingError>);
  });

  it("uses the supplied time zone instead of assuming evening training", async () => {
    const { service } = createService();
    const shanghai = await service.startSession("user-a", null, "Asia/Shanghai");
    const losAngeles = await service.startSession("user-a", null, "America/Los_Angeles");

    expect(shanghai.localDate).toBe("2026-08-25");
    expect(losAngeles.localDate).toBe("2026-08-24");
  });

  it("copies a template into a program unit and only refreshes it explicitly", async () => {
    const { service } = createService();
    let template = await service.createTemplate("user-a", {
      name: "胸部 A",
      note: null,
      items: [{ ...emptyTarget, exerciseName: "杠铃卧推", targetSets: 3 }],
    });
    let program = await service.createProgram("user-a", {
      name: "两周计划",
      note: null,
      weekCount: 2,
    });
    program = await service.addProgramUnit(
      "user-a",
      program.id,
      program.revision,
      { weekNumber: 2, name: "", note: null, items: [] },
      template.id,
    );

    template = await service.updateTemplate("user-a", template.id, template.revision, {
      name: "胸部 B",
      note: null,
      items: [{ ...emptyTarget, exerciseName: "哑铃卧推", targetSets: 4 }],
    });
    expect(program.units[0]).toMatchObject({
      name: "胸部 A",
      sourceTemplateRevision: 1,
      items: [{ exerciseName: "杠铃卧推" }],
    });

    program = await service.reimportProgramUnit(
      "user-a",
      program.id,
      program.units[0]!.id,
      program.revision,
    );
    expect(program.units[0]).toMatchObject({
      name: "胸部 B",
      sourceTemplateRevision: template.revision,
      items: [{ exerciseName: "哑铃卧推", targetSets: 4 }],
    });
  });

  it("starts a program unit with a lightweight snapshot and then locks the unit", async () => {
    const { service } = createService();
    let program = await service.createProgram("user-a", {
      name: "三周计划",
      note: null,
      weekCount: 3,
    });
    program = await service.addProgramUnit(
      "user-a",
      program.id,
      program.revision,
      {
        weekNumber: 1,
        name: "第一训练日",
        note: null,
        items: [{ ...emptyTarget, exerciseName: "深蹲", targetSets: 3 }],
      },
      null,
    );
    const unit = program.units[0]!;
    const workout = await service.startProgramSession(
      "user-a",
      program.id,
      unit.id,
      "Asia/Shanghai",
    );

    expect(workout).toMatchObject({
      sourceProgramName: "三周计划",
      sourceWeekNumber: 1,
      sourceTrainingDayName: "第一训练日",
      items: [{ exerciseName: "深蹲", target: { targetSets: 3 } }],
    });
    const refreshed = await service.getProgram("user-a", program.id);
    expect(refreshed.units[0]?.started).toBe(true);
    const repeated = await service.startProgramSession("user-a", program.id, unit.id, "Asia/Shanghai");
    expect(repeated.id).not.toBe(workout.id);
    await expect(
      service.updateProgramUnit("user-a", program.id, unit.id, program.revision, {
        weekNumber: 1,
        name: "覆盖内容",
        note: null,
        items: [{ ...emptyTarget, exerciseName: "硬拉" }],
      }),
    ).rejects.toMatchObject({ code: "training_program_unit_started" });
  });

  it("schedules a template on a local date and starts it exactly once", async () => {
    const { service } = createService();
    const template = await service.createTemplate("user-a", {
      name: "胸部训练",
      note: null,
      items: [{ ...emptyTarget, exerciseName: "卧推", targetSets: 4 }],
    });
    const schedule = await service.createSchedule("user-a", {
      localDate: "2026-08-26",
      timeZone: "Asia/Shanghai",
      title: "",
      note: "下班后",
      sourceTemplateId: template.id,
      sourceProgramId: null,
      sourceProgramUnitId: null,
    });

    expect(schedule).toMatchObject({ title: "胸部训练", status: "scheduled" });
    await expect(service.listSchedules("user-a", "2026-08-26", "2026-08-26")).resolves.toHaveLength(1);
    const session = await service.startScheduledSession("user-a", schedule.id);
    expect(session).toMatchObject({
      sourceScheduleId: schedule.id,
      sourceScheduleTitle: "胸部训练",
      localDate: "2026-08-26",
      items: [{ exerciseName: "卧推" }],
    });
    await expect(service.startScheduledSession("user-a", schedule.id)).rejects.toMatchObject({
      code: "training_schedule_unavailable",
    });
    await expect(service.listSchedules("user-a", "2026-08-26", "2026-08-26")).resolves.toEqual([
      expect.objectContaining({ status: "started", startedSessionId: session.id }),
    ]);
  });

  it("keeps a cancelled theme as a fact without creating a workout", async () => {
    const { service } = createService();
    const schedule = await service.createSchedule("user-a", {
      localDate: "2026-08-27",
      timeZone: "Asia/Shanghai",
      title: "轻量活动",
      note: null,
      sourceTemplateId: null,
      sourceProgramId: null,
      sourceProgramUnitId: null,
    });
    const cancelled = await service.cancelSchedule("user-a", schedule.id, schedule.revision);
    expect(cancelled.status).toBe("cancelled");
    await expect(service.startScheduledSession("user-a", schedule.id)).rejects.toMatchObject({
      code: "training_schedule_unavailable",
    });
    await expect(
      service.createSchedule("user-a", {
        localDate: "2026-02-30",
        timeZone: "Asia/Shanghai",
        title: "不存在的日期",
        note: null,
        sourceTemplateId: null,
        sourceProgramId: null,
        sourceProgramUnitId: null,
      }),
    ).rejects.toMatchObject({ code: "invalid_training_input" });
  });

  it("estimates completed training from an exact official activity mapping and an effective-weight snapshot", async () => {
    const repository = new MemoryTrainingRepository();
    const planningService = new PlanningService(new MemoryPlanningRepository());
    await planningService.updateProfile("user-a", 0, {
      birthDate: "1996-01-01",
      sexCategory: "male",
      heightCm: 175,
      pregnantOrBreastfeeding: false,
      medicalNutritionCondition: false,
      specialBodyComposition: false,
      palCategory: "low_active",
    });
    const measurement = await planningService.createMeasurement("user-a", {
      measuredAt: "2026-08-20T08:00:00.000Z",
      localDate: "2026-08-20",
      timeZone: "Asia/Shanghai",
      weightKg: 70,
      waistCm: null,
      note: null,
    });
    const service = new TrainingService({
      repository,
      planningService,
      now: () => new Date("2026-08-25T03:30:00.000Z"),
    });
    let session = await service.startSession("user-a", null, "Asia/Shanghai");
    await expect(service.assessSessionExpenditure("user-a", session.id, session.revision, {
      activityCode: "barbell_bench_25rm",
      durationMinutes: 60,
    })).rejects.toMatchObject({ code: "training_session_in_progress" });
    session = await service.finishSession("user-a", session.id, session.revision, "completed");
    session = await service.assessSessionExpenditure("user-a", session.id, session.revision, {
      activityCode: "barbell_bench_25rm",
      durationMinutes: 60,
    });

    expect(session.expenditureAssessment).toMatchObject({
      status: "estimated",
      met: 4.9,
      grossEnergyKcal: 343,
      netEnergyKcal: 273,
      methodVersion: "training-expenditure-e003-v1",
      evidenceIds: ["E-003"],
      inputSnapshot: {
        durationMinutes: 60,
        profileRevision: 1,
        weightMeasurement: { id: measurement.id, revision: 1, localDate: "2026-08-20", weightKg: 70 },
      },
    });
    const assessedRevision = session.revision;
    session = await service.assessSessionExpenditure("user-a", session.id, session.revision, {
      activityCode: null,
      durationMinutes: null,
    });
    expect(session.expenditureAssessment).toMatchObject({ status: "unavailable", grossEnergyKcal: null, netEnergyKcal: null });
    expect(await service.listSessionRevisions("user-a", session.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionRevision: assessedRevision, expenditureAssessment: expect.objectContaining({ grossEnergyKcal: 343 }) }),
      expect.objectContaining({ expenditureAssessment: null }),
    ]));
  });
});
