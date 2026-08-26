import { afterEach, describe, expect, it } from "vitest";

import { buildContractApp } from "./testing/contract-app.js";

const apps: Awaited<ReturnType<typeof buildContractApp>>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe("OpenAPI contract", () => {
  it("documents the implemented identity, administration, and health boundaries", async () => {
    const app = await buildContractApp();
    apps.push(app);
    await app.ready();
    const contract = app.swagger();

    expect(Object.keys(contract.paths ?? {})).toEqual(
      expect.arrayContaining([
        "/api/v1/health/live",
        "/api/v1/health/ready",
        "/api/v1/auth/register",
        "/api/v1/auth/login",
        "/api/v1/auth/password",
        "/api/v1/admin/accounts",
        "/api/v1/admin/accounts/{userId}/password",
        "/api/v1/admin/operations/health",
        "/api/v1/planning/profile",
        "/api/v1/planning/measurements",
        "/api/v1/planning/daily-reference",
        "/api/v1/training-suggestions",
        "/api/v1/training-suggestions/{suggestionId}/adopt",
        "/api/v1/nutrition/meals",
        "/api/v1/nutrition/day-summary",
        "/api/v1/nutrition/food-templates",
        "/api/v1/nutrition/food-search",
      ]),
    );
    expect(JSON.stringify(contract)).not.toContain("passwordHash");
  });
});
