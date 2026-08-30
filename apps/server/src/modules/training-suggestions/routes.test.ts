import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../../app.js";
import { createTestConfig } from "../../testing/test-config.js";
import { MemoryIdentityRepository } from "../identity/memory-repository.js";
import { IdentityService } from "../identity/service.js";
import { MemoryPlanningRepository } from "../planning/memory-repository.js";
import { PlanningService } from "../planning/service.js";
import { MemoryTrainingRepository } from "../training/memory-repository.js";
import { TrainingService } from "../training/service.js";
import { MemoryTrainingSuggestionRepository } from "./memory-repository.js";
import { TrainingSuggestionService } from "./service.js";

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => Promise.all(apps.splice(0).map(async (app) => app.close())));

describe("training suggestion routes", () => {
  it("generates and adopts only within the signed-in account", async () => {
    const config = createTestConfig({ webDistDirectory: "/directory-that-does-not-exist" });
    const identityService = new IdentityService({ repository: new MemoryIdentityRepository(), sessionSecret: config.sessionSecret, sessionTtlHours: config.sessionTtlHours });
    const planningService = new PlanningService(new MemoryPlanningRepository());
    const trainingService = new TrainingService({ repository: new MemoryTrainingRepository() });
    const trainingSuggestionService = new TrainingSuggestionService({ repository: new MemoryTrainingSuggestionRepository(), planningService, trainingService, now: () => new Date("2026-08-26T08:00:00.000Z") });
    const app = await buildApp({ config, checkDatabase: async () => undefined, identityService, planningService, trainingService, trainingSuggestionService });
    apps.push(app);
    const registration = await app.inject({ method: "POST", url: "/api/v1/auth/register", payload: { username: "suggestion-user", password: "correct horse battery staple" } });
    const cookie = String(registration.headers["set-cookie"]).split(";", 1)[0];
    await planningService.updateProfile(registration.json<{ id: string }>().id, 0, { birthDate: "1995-05-01", sexCategory: "male", heightCm: 175, pregnantOrBreastfeeding: false, medicalNutritionCondition: false, specialBodyComposition: false, palCategory: "low_active" });
    const generated = await app.inject({ method: "POST", url: "/api/v1/training-suggestions", headers: { cookie }, payload: { goal: "general", experience: "beginner", equipment: "dumbbells", availableDaysPerWeek: 2, sessionMinutes: 45, hasInjuryOrMedicalLimitation: false } });
    expect(generated.statusCode, generated.body).toBe(201);
    const suggestion = generated.json<{ id: string; revision: number }>();
    const adopted = await app.inject({ method: "POST", url: `/api/v1/training-suggestions/${suggestion.id}/adopt`, headers: { cookie }, payload: { revision: suggestion.revision } });
    expect(adopted.statusCode, adopted.body).toBe(200);
    expect(adopted.json()).toMatchObject({ suggestion: { status: "adopted" }, template: { name: "全身训练草案" } });

    const second = await app.inject({ method: "POST", url: "/api/v1/auth/register", payload: { username: "other-suggestion-user", password: "correct horse battery staple" } });
    const otherCookie = String(second.headers["set-cookie"]).split(";", 1)[0];
    const hidden = await app.inject({ method: "POST", url: `/api/v1/training-suggestions/${suggestion.id}/dismiss`, headers: { cookie: otherCookie }, payload: { revision: 1 } });
    expect(hidden.statusCode).toBe(404);
  });
});
