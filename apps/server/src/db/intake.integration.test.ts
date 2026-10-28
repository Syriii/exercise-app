import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createDatabase } from "./database.js";
import { DatabaseUserContext } from "./user-context.js";
import { ensureApiDatabaseRole, grantApiDatabaseRole } from "./runtime-role.js";
import { readSecretValue } from "../config/environment.js";
import { loadTestDatabaseUrl } from "../testing/test-database-url.js";
import { PostgresNutritionRepository } from "../modules/nutrition/postgres-repository.js";
import { NutritionService } from "../modules/nutrition/service.js";
import { PostgresUserDataExporter } from "../modules/portability/postgres-exporter.js";
import type { IntakeInput } from "../modules/nutrition/intake.js";

// The integration runner and loader both reject a target without the explicit _test suffix.
const databaseUrl = loadTestDatabaseUrl(), admin = createDatabase(databaseUrl);
const password = process.env.TEST_API_DATABASE_PASSWORD === undefined && process.env.TEST_API_DATABASE_PASSWORD_FILE === undefined
  ? "integration-only-api-role-password"
  : readSecretValue("TEST_API_DATABASE_PASSWORD", process.env, path => readFileSync(path, "utf8"));
const restrictedUrl = new URL(databaseUrl);
restrictedUrl.username = "exercise_api"; restrictedUrl.password = password;
const context = new DatabaseUserContext(), restricted = createDatabase(restrictedUrl.toString(), context);
const nutrition = new NutritionService(new PostgresNutritionRepository(restricted.database));

beforeAll(async () => {
  await migrate(admin.database, { migrationsFolder: resolve(import.meta.dirname, "../../drizzle") });
  await ensureApiDatabaseRole(admin.pool, password, { preserveExistingPassword: true });
  await grantApiDatabaseRole(admin.pool);
});
afterAll(async () => { await restricted.close(); await admin.close(); });

it("persists intake evidence and revision history with RLS, transactional rollback, export and account deletion", async () => {
  const accounts = await admin.pool.query<{ id: string }>("insert into users (username, normalized_username) values ($1, $1), ($2, $2) returning id", [`intake-owner-${randomUUID()}`, `intake-other-${randomUUID()}`]);
  const owner = accounts.rows[0]!.id, other = accounts.rows[1]!.id;
  const constraint = `intake_rollback_${randomUUID().replaceAll("-", "")}`;
  let constraintCreated = false;
  try {
    const created = await context.run(owner, () => nutrition.createMeal(owner, { occurredAt: "2026-10-01T00:00:00Z", localDate: "2026-10-01", timeZone: "UTC", name: "测试餐食", note: null }));
    const meal = await context.run(owner, () => nutrition.addContribution(owner, created.id, created.revision, { mode: "item", label: "测试食物", portionAmount: 100, portionUnit: "g", basisDescription: "测试来源每100g", energyKcal: 120, proteinGrams: 0, carbohydrateGrams: null, fatGrams: 3 }, false));
    const item = meal.contributions[0]!;
    expect(item.intakeEvidence).toBeNull();
    const input: IntakeInput = { mealRevision: meal.revision, contributionRevision: item.revision,
      quantity: { kind: "before_after", beforeGrams: 500, afterGrams: 250, discardedGrams: 50, sameContainer: true }, basis: { kind: "current_record" } };
    const preview = await context.run(owner, () => nutrition.previewIntake(owner, meal.id, item.id, input));
    expect(preview).toMatchObject({ amount: 200, nutrients: { energyKcal: 240, proteinGrams: 0, carbohydrateGrams: null } });
    expect(await context.run(owner, () => nutrition.getMeal(owner, meal.id))).toEqual(meal);
    await expect(context.run(other, () => nutrition.applyIntake(other, meal.id, item.id, input))).rejects.toMatchObject({ statusCode: 404 });
    await expect(context.run(other, () => nutrition.applyIntake(owner, meal.id, item.id, input))).rejects.toMatchObject({ statusCode: 404 });
    const saves = await Promise.allSettled([context.run(owner, () => nutrition.applyIntake(owner, meal.id, item.id, input)), context.run(owner, () => nutrition.applyIntake(owner, meal.id, item.id, input))]);
    expect(saves.filter(value => value.status === "fulfilled")).toHaveLength(1);
    const failed = saves.find(value => value.status === "rejected");
    expect(failed && failed.status === "rejected" ? failed.reason : null).toMatchObject({ statusCode: 409 });
    const saved = await context.run(owner, () => nutrition.getMeal(owner, meal.id));
    expect(saved.contributions[0]).toMatchObject({ id: item.id, portionAmount: 200, energyKcal: 240, intakeEvidence: { input: { quantity: input.quantity }, basis: { amount: 100, carbohydrateGrams: null } } });
    const hidden = await context.run(other, () => restricted.pool.query("select intake_evidence from meal_contributions where id = $1", [item.id]));
    expect(hidden.rowCount).toBe(0);
    const changed = await context.run(other, () => restricted.pool.query("update meal_contributions set intake_evidence = '{}'::jsonb where id = $1", [item.id]));
    expect(changed.rowCount).toBe(0);

    // The history insert occurs before the contribution update; a late failure must roll both back.
    const rollbackInput: IntakeInput = { ...input, mealRevision: saved.revision, contributionRevision: saved.contributions[0]!.revision, quantity: { kind: "net_weight", grams: 50 } };
    await admin.pool.query(`alter table meal_contributions add constraint ${constraint} check (id <> '${item.id}'::uuid or portion_amount <> 50)`);
    constraintCreated = true;
    const revisionsBefore = await context.run(owner, () => nutrition.listContributionRevisions(owner, meal.id));
    await expect(context.run(owner, () => nutrition.applyIntake(owner, meal.id, item.id, rollbackInput))).rejects.toBeDefined();
    expect(await context.run(owner, () => nutrition.getMeal(owner, meal.id))).toEqual(saved);
    expect(await context.run(owner, () => nutrition.listContributionRevisions(owner, meal.id))).toEqual(revisionsBefore);
    await admin.pool.query(`alter table meal_contributions drop constraint ${constraint}`); constraintCreated = false;

    const label: IntakeInput = { ...rollbackInput, quantity: { kind: "count", amount: 2, unit: "份" }, basis: { kind: "label", amount: 1, unit: "份", energyUnit: "kJ", energy: 418.4, proteinGrams: 0, carbohydrateGrams: null, fatGrams: null, source: "测试包装标签" } };
    const labeled = await context.run(owner, () => nutrition.applyIntake(owner, meal.id, item.id, label));
    expect(labeled.contributions[0]).toMatchObject({ energyKcal: 200, carbohydrateGrams: null, foodSnapshot: null });
    const modified = await context.run(owner, () => nutrition.changePortion(owner, meal.id, item.id, labeled.revision, labeled.contributions[0]!.revision, 1));
    expect(modified.contributions[0]).toMatchObject({ intakeEvidence: null, energyKcal: 100, carbohydrateGrams: null });
    const history = await context.run(owner, () => nutrition.listContributionRevisions(owner, meal.id));
    expect(history.filter(value => value.intakeEvidence !== null)).toHaveLength(2);
    expect((await context.run(other, () => restricted.pool.query("select intake_evidence from meal_contribution_revisions where contribution_id = $1", [item.id]))).rowCount).toBe(0);
    const exported = await context.run(owner, () => new PostgresUserDataExporter(restricted.database).exportUserData(owner, new Date()));
    expect(exported.data.meal_contributions).toEqual(expect.arrayContaining([expect.objectContaining({ id: item.id, intake_evidence: null })]));
    expect(exported.data.meal_contribution_revisions).toEqual(expect.arrayContaining([expect.objectContaining({ contribution_id: item.id, intake_evidence: expect.objectContaining({ version: "intake-v1", input: { quantity: label.quantity, basis: label.basis } }) })]));
    expect((await context.run(other, () => new PostgresUserDataExporter(restricted.database).exportUserData(other, new Date()))).data.meal_contribution_revisions).toEqual([]);
    await admin.pool.query("delete from users where id = $1", [owner]);
    expect((await admin.pool.query("select 1 from meal_contributions where id = $1", [item.id])).rowCount).toBe(0);
    expect((await admin.pool.query("select 1 from meal_contribution_revisions where contribution_id = $1", [item.id])).rowCount).toBe(0);
  } finally {
    if (constraintCreated) await admin.pool.query(`alter table meal_contributions drop constraint ${constraint}`);
    await admin.pool.query("delete from users where id = any($1::uuid[])", [[owner, other]]);
  }
});
