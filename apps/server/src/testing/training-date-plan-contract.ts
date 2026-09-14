import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import type { TrainingService } from "../modules/training/service.js";
import type { TrainingRecordInput, TrainingSchedule, TrainingScheduleInput } from "../modules/training/types.js";

const target = { targetSets: 3, targetRepsMin: 10, targetRepsMax: 10, targetWeightKg: null,
  targetDurationSeconds: null, targetDistanceMeters: null, note: null };
const date = "2026-09-14", later = "2026-09-17";
const scheduleInput = (plan: TrainingSchedule): TrainingScheduleInput => ({ localDate: plan.localDate,
  timeZone: plan.timeZone, title: plan.title, note: plan.note, sourceTemplateId: plan.sourceTemplateId,
  sourceProgramId: plan.sourceProgramId, sourceProgramUnitId: plan.sourceProgramUnitId });

/** Same behavioral contract on memory and real PostgreSQL, with synthetic accounts only. */
export async function verifyDatePlans(service: TrainingService, userId: string, otherId: string) {
  const template = await service.createTemplate(userId, { name: "练胸", note: null, items: [
    { ...target, exerciseName: "卧推" }, { ...target, exerciseName: "跑步", targetSets: null, targetDurationSeconds: 1200, targetDistanceMeters: "3000" },
  ] });
  const input: TrainingScheduleInput = { localDate: date, timeZone: "Asia/Shanghai", title: "练胸", note: null,
    sourceTemplateId: template.id, sourceProgramId: null, sourceProgramUnitId: null };
  let monday = await service.createSchedule(userId, input);
  const thursday = await service.createSchedule(userId, { ...input, localDate: later });
  expect(monday.items?.[0]?.id).not.toBe(thursday.items?.[0]?.id);
  expect(monday.items?.[1]?.progressUnit).toBe("seconds");
  const updatedTemplate = await service.updateTemplate(userId, template.id, template.revision, { name: "新练胸", note: null,
    items: [{ ...target, exerciseName: "夹胸", targetSets: 5 }] });
  await service.archiveTemplate(userId, template.id, updatedTemplate.revision);
  expect((await service.listSchedules(userId)).find(p => p.id === monday.id)?.items?.[0]?.exerciseName).toBe("卧推");

  const payload = (sets: number, linked = true): TrainingRecordInput => ({ revision: 0, localDate: date, timeZone: "Asia/Shanghai",
    recordedTime: null, note: null, items: [{ id: randomUUID(), exerciseName: "卧推", actualNote: null, measurement: "sets",
      planLink: linked ? { scheduleId: monday.id, itemId: monday.items![0]!.id, revision: monday.revision } : null,
      sets: Array.from({ length: sets }, () => ({ reps: 10, weightKg: "40", durationSeconds: null, distanceMeters: null, note: null })) }] });
  const progress = async () => (await service.listSchedules(userId, date, date)).find(p => p.id === monday.id)!.progress!;
  const firstInput = payload(2), firstId = randomUUID();
  const [first, replay] = await Promise.all([service.saveRecord(userId, firstId, firstInput), service.saveRecord(userId, firstId, firstInput)]);
  expect(first.id).toBe(replay.id);
  expect((await progress())[0]).toMatchObject({ actual: 2, remaining: 1, status: "partial" });
  await service.saveRecord(userId, randomUUID(), payload(20, false));
  expect((await progress())[0]?.actual).toBe(2);
  const second = await service.saveRecord(userId, randomUUID(), payload(2));
  expect((await progress())[0]).toMatchObject({ actual: 4, remaining: 0, status: "complete" });
  expect((await progress())[1]).toMatchObject({ actual: null, status: "unrecorded", target: 1200, unit: "seconds" });
  await expect(service.saveRecord(otherId, randomUUID(), payload(2))).rejects.toMatchObject({ code: "training_schedule_not_found" });
  await expect(service.updateSchedule(otherId, monday.id, monday.revision, input)).rejects.toMatchObject({ code: "training_schedule_not_found" });

  const firstItem = monday.items![0]!;
  monday = await service.updateSchedule(userId, monday.id, monday.revision, { ...scheduleInput(monday),
    items: monday.items!.map(item => ({ ...item, targetSets: item.id === firstItem.id ? 6 : item.targetSets })) });
  expect(monday.items![0]!.id).toBe(firstItem.id);
  expect(monday.history?.[0]?.items?.[0]?.targetSets).toBe(3);
  expect((await progress())[0]).toMatchObject({ target: 6, actual: 4, remaining: 2, status: "partial" });
  expect((await service.listSchedules(userId)).find(p => p.id === thursday.id)?.items?.[0]?.targetSets).toBe(3);
  // Lost response can replay even after the plan changes; a fresh stale write cannot.
  expect((await service.saveRecord(userId, firstId, firstInput)).id).toBe(firstId);
  await expect(service.saveRecord(userId, randomUUID(), firstInput)).rejects.toMatchObject({ statusCode: 409 });
  const movedInput = { ...firstInput, revision: first.revision, localDate: later,
    items: [{ ...firstInput.items[0]!, id: first.items[0]!.id }] };
  const moved = await service.saveRecord(userId, first.id, movedInput);
  expect(moved.items[0]?.planLink).toBeNull();
  expect((await progress())[0]?.actual).toBe(2);
  await service.deleteRecord(userId, second.id, second.revision);
  expect((await progress())[0]?.status).toBe("unrecorded");

  const unknownInput = payload(0);
  const unknown = await service.saveRecord(userId, randomUUID(), { ...unknownInput, items: [{ ...unknownInput.items[0]!, measurement: "unknown" }] });
  expect((await progress())[0]).toMatchObject({ actual: null, status: "unknown" });
  const run = monday.items![1]!;
  await service.saveRecord(userId, randomUUID(), { ...payload(0), items: [{ id: randomUUID(), exerciseName: "跑步", actualNote: null,
    measurement: "activity", planLink: { scheduleId: monday.id, itemId: run.id, revision: monday.revision },
    sets: [{ reps: null, weightKg: null, durationSeconds: 600, distanceMeters: "3500", note: null }] }] });
  expect((await progress())[1]).toMatchObject({ actual: 600, target: 1200, status: "partial" });
  monday = await service.updateSchedule(userId, monday.id, monday.revision, { ...scheduleInput(monday),
    items: [{ ...run, progressUnit: "meters" }] });
  expect((await progress())[0]).toMatchObject({ unit: "meters", actual: 3500, target: 3000, status: "complete" });
  monday = await service.updateSchedule(userId, monday.id, monday.revision, { ...scheduleInput(monday),
    items: [...monday.items!, { ...target, exerciseName: "卧推", progressUnit: "sets" }] });
  expect(monday.items![1]!.id).not.toBe(firstItem.id);
  expect((await progress())[1]?.status).toBe("unrecorded");
  // Removed identities cannot be reintroduced and inherit old contributions.
  await expect(service.updateSchedule(userId, monday.id, monday.revision, { ...scheduleInput(monday), items: [firstItem] }))
    .rejects.toMatchObject({ code: "invalid_training_input" });
  monday = await service.updateSchedule(userId, monday.id, monday.revision, { ...scheduleInput(monday), localDate: later });
  expect((await service.listSchedules(userId, later, later)).find(p => p.id === monday.id)?.progress?.every(p => p.status === "unrecorded")).toBe(true);
  await service.cancelSchedule(userId, monday.id, monday.revision);
  expect((await service.getSession(userId, unknown.id)).localDate).toBe(date);
  let program = await service.createProgram(userId, { name: "两周编排", note: null, weekCount: 2 });
  program = await service.addProgramUnit(userId, program.id, program.revision, { name: "第一周", note: null, weekNumber: 1,
    items: [{ ...target, exerciseName: "深蹲" }] }, null);
  program = await service.addProgramUnit(userId, program.id, program.revision, { name: "第二周", note: null, weekNumber: 2,
    items: [{ ...target, exerciseName: "划船" }] }, null);
  const firstUnit = program.units[0]!, secondUnit = program.units[1]!;
  const scheduledUnit = await service.createSchedule(userId, { ...input, sourceTemplateId: null, sourceProgramId: program.id, sourceProgramUnitId: firstUnit.id });
  const scheduledSecond = await service.createSchedule(userId, { ...input, localDate: later, sourceTemplateId: null, sourceProgramId: program.id, sourceProgramUnitId: secondUnit.id });
  await service.updateProgramUnit(userId, program.id, firstUnit.id, program.revision, { name: "修改后第一周", note: null,
    weekNumber: 1, items: [{ ...target, exerciseName: "硬拉" }] });
  const all = await service.listSchedules(userId);
  expect(all.find(p => p.id === scheduledUnit.id)?.items?.[0]?.exerciseName).toBe("深蹲");
  expect(all.find(p => p.id === scheduledSecond.id)?.items?.[0]?.exerciseName).toBe("划船");
  const changed = await Promise.allSettled([service.updateSchedule(userId, scheduledUnit.id, scheduledUnit.revision, { ...scheduleInput(scheduledUnit), title: "甲" }),
    service.updateSchedule(userId, scheduledUnit.id, scheduledUnit.revision, { ...scheduleInput(scheduledUnit), title: "乙" })]);
  expect(changed.filter(value => value.status === "fulfilled")).toHaveLength(1);
  expect(changed.find(value => value.status === "rejected")).toMatchObject({ reason: { statusCode: 409 } });
  return { scheduleId: monday.id, recordId: first.id, linkedRecordId: unknown.id };
}
