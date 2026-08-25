import { describe, expect, it } from "vitest";

import { IdentityError } from "./errors.js";
import { MemoryIdentityRepository } from "./memory-repository.js";
import { IdentityService } from "./service.js";

const sessionSecret = "a-test-session-secret-that-is-long-enough";
const password = "correct horse battery staple";

function createService(repository = new MemoryIdentityRepository()) {
  return {
    repository,
    service: new IdentityService({
      repository,
      sessionSecret,
      sessionTtlHours: 24,
      now: () => new Date("2026-08-25T00:00:00.000Z"),
    }),
  };
}

describe("IdentityService", () => {
  it("creates the preset admin without retaining the plaintext password", async () => {
    const { repository, service } = createService();

    const admin = await service.initializeAdmin(password);

    expect(admin.role).toBe("admin");
    expect(admin.passwordChangeRequired).toBe(true);
    expect([...repository.accounts.values()][0]?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(JSON.stringify([...repository.accounts.values()])).not.toContain(password);
  });

  it("registers a normal account and authenticates an opaque session", async () => {
    const { repository, service } = createService();

    const session = await service.register("Syriii", password);
    const authenticated = await service.authenticate(session.token);

    expect(authenticated.id).toBe(session.account.id);
    expect(authenticated.role).toBe("user");
    expect([...repository.sessions.keys()][0]).not.toBe(session.token);
    expect([...repository.sessions.keys()][0]).toMatch(/^[a-f0-9]{64}$/);
  });

  it("uses a generic login failure", async () => {
    const { service } = createService();
    await service.register("friend", password);

    await expect(service.login("friend", "this password is wrong")).rejects.toMatchObject({
      code: "invalid_credentials",
      statusCode: 401,
    });
  });

  it("respects the registration switch while allowing idempotent admin initialization", async () => {
    const { repository, service } = createService();
    repository.registrationOpen = false;

    await expect(service.register("friend", password)).rejects.toMatchObject({
      code: "registration_closed",
      statusCode: 403,
    });

    const first = await service.initializeAdmin(password);
    const second = await service.initializeAdmin("a different secure admin password");
    expect(second.id).toBe(first.id);
    expect(repository.accounts.size).toBe(1);
  });

  it("keeps administrator operations separate from ordinary accounts", async () => {
    const { repository, service } = createService();
    const admin = await service.initializeAdmin(password);
    const userSession = await service.register("friend", password);

    await expect(service.listAccounts(userSession.account)).rejects.toBeInstanceOf(IdentityError);

    await service.setAccountStatus(admin, userSession.account.id, "disabled");
    await expect(service.authenticate(userSession.token)).rejects.toMatchObject({
      code: "authentication_required",
    });
    expect(repository.auditEvents).toHaveLength(1);
  });

  it("changes the initial administrator password and replaces existing sessions", async () => {
    const { repository, service } = createService();
    const admin = await service.initializeAdmin(password);
    const oldSession = await service.login("admin", password);

    const newSession = await service.changePassword(
      admin,
      password,
      "a newer secure administrator password",
    );

    expect(newSession.account.passwordChangeRequired).toBe(false);
    await expect(service.authenticate(oldSession.token)).rejects.toMatchObject({
      code: "authentication_required",
    });
    await expect(service.login("admin", password)).rejects.toMatchObject({
      code: "invalid_credentials",
    });
    await expect(service.authenticate(newSession.token)).resolves.toMatchObject({ role: "admin" });
    expect(repository.auditEvents.at(-1)?.action).toBe("account.password.change");
  });

  it("lets an administrator revoke sessions without disabling the account", async () => {
    const { repository, service } = createService();
    const admin = await service.initializeAdmin(password);
    const userSession = await service.register("session-owner", password);

    await service.revokeAccountSessions(admin, userSession.account.id);

    await expect(service.authenticate(userSession.token)).rejects.toMatchObject({
      code: "authentication_required",
    });
    expect((await repository.findAccountById(userSession.account.id))?.status).toBe("active");
    expect(repository.auditEvents.at(-1)?.action).toBe("account.sessions.revoke");
  });
});
