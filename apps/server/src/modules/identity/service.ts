import { IdentityError } from "./errors.js";
import { hashPassword, verifyPassword } from "./passwords.js";
import type { IdentityRepository } from "./repository.js";
import { createSessionToken, hashSessionToken } from "./session-tokens.js";
import type { Account, UserStatus } from "./types.js";

const usernamePattern = /^[\p{L}\p{N}._-]{3,32}$/u;

export interface AuthenticatedSession {
  readonly token: string;
  readonly expiresAt: Date;
  readonly account: Account;
}

export interface IdentityServiceOptions {
  readonly repository: IdentityRepository;
  readonly sessionSecret: string;
  readonly sessionTtlHours: number;
  readonly now?: () => Date;
}

function normalizeUsername(username: string): string {
  const trimmed = username.trim().normalize("NFKC");
  if (!usernamePattern.test(trimmed)) {
    throw new IdentityError(
      "invalid_username",
      "用户名需为 3–32 个字母、数字、点、下划线或连字符",
      400,
    );
  }
  return trimmed.toLocaleLowerCase("und");
}

function validatePassword(password: string): void {
  if (password.length < 12 || password.length > 128) {
    throw new IdentityError("weak_password", "密码长度需为 12–128 个字符", 400);
  }
}

export class IdentityService {
  readonly #repository: IdentityRepository;
  readonly #sessionSecret: string;
  readonly #sessionTtlHours: number;
  readonly #now: () => Date;

  public constructor(options: IdentityServiceOptions) {
    this.#repository = options.repository;
    this.#sessionSecret = options.sessionSecret;
    this.#sessionTtlHours = options.sessionTtlHours;
    this.#now = options.now ?? (() => new Date());
  }

  public async initializeAdmin(password: string): Promise<Account> {
    validatePassword(password);
    const existing = await this.#repository.findAccountByNormalizedUsername("admin");
    if (existing !== null) {
      if (existing.role !== "admin") {
        throw new IdentityError(
          "admin_username_conflict",
          "admin 用户名已被普通账号占用",
          409,
        );
      }
      return existing;
    }

    const passwordHash = await hashPassword(password);
    return this.#repository.createAccount(
      {
        username: "admin",
        normalizedUsername: "admin",
        passwordHash,
        role: "admin",
        passwordChangeRequired: true,
      },
      { bypassRegistration: true },
    );
  }

  public async register(username: string, password: string): Promise<AuthenticatedSession> {
    const normalizedUsername = normalizeUsername(username);
    validatePassword(password);
    if (!(await this.#repository.isRegistrationOpen())) {
      throw new IdentityError("registration_closed", "当前未开放注册", 403);
    }

    const passwordHash = await hashPassword(password);
    let account: Account;
    try {
      account = await this.#repository.createAccount(
        {
          username: username.trim().normalize("NFKC"),
          normalizedUsername,
          passwordHash,
          role: "user",
          passwordChangeRequired: false,
        },
        { bypassRegistration: false },
      );
    } catch (error) {
      if (error instanceof IdentityError) {
        throw error;
      }
      throw error;
    }
    return this.#issueSession(account);
  }

  public async login(username: string, password: string): Promise<AuthenticatedSession> {
    let normalizedUsername: string;
    try {
      normalizedUsername = normalizeUsername(username);
    } catch {
      throw new IdentityError("invalid_credentials", "用户名或密码不正确", 401);
    }

    const account = await this.#repository.findAccountByNormalizedUsername(normalizedUsername);
    if (account === null || !(await verifyPassword(account.passwordHash, password))) {
      throw new IdentityError("invalid_credentials", "用户名或密码不正确", 401);
    }
    if (account.status !== "active") {
      throw new IdentityError("account_disabled", "账号已停用", 403);
    }
    return this.#issueSession(account);
  }

  public async authenticate(token: string | undefined): Promise<Account> {
    if (token === undefined || token.length === 0) {
      throw new IdentityError("authentication_required", "请先登录", 401);
    }

    const session = await this.#repository.findSessionByTokenHash(
      hashSessionToken(token, this.#sessionSecret),
      this.#now(),
    );
    if (session === null) {
      throw new IdentityError("authentication_required", "登录状态已失效", 401);
    }
    if (session.account.status !== "active") {
      throw new IdentityError("account_disabled", "账号已停用", 403);
    }
    return session.account;
  }

  public async logout(token: string | undefined): Promise<void> {
    if (token === undefined || token.length === 0) {
      return;
    }
    await this.#repository.revokeSessionByTokenHash(
      hashSessionToken(token, this.#sessionSecret),
      this.#now(),
    );
  }

  public async changePassword(
    account: Account,
    currentPassword: string,
    newPassword: string,
  ): Promise<AuthenticatedSession> {
    validatePassword(newPassword);
    const credential = await this.#repository.findAccountByNormalizedUsername(
      account.normalizedUsername,
    );
    if (credential === null || !(await verifyPassword(credential.passwordHash, currentPassword))) {
      throw new IdentityError("invalid_current_password", "当前密码不正确", 400);
    }

    const updated = await this.#repository.updatePassword(account.id, await hashPassword(newPassword));
    if (updated === null) {
      throw new IdentityError("account_not_found", "账号不存在", 404);
    }
    await this.#repository.revokeSessionsForUser(account.id, this.#now());
    await this.#repository.recordAuditEvent({
      actorUserId: account.id,
      targetUserId: account.id,
      action: "account.password.change",
      result: "succeeded",
    });
    return this.#issueSession(updated);
  }

  public async getRegistrationStatus(): Promise<{ open: boolean }> {
    return { open: await this.#repository.isRegistrationOpen() };
  }

  public async setRegistrationOpen(actor: Account, open: boolean): Promise<void> {
    this.#requireAdmin(actor);
    await this.#repository.setRegistrationOpen(open, actor.id);
    await this.#repository.recordAuditEvent({
      actorUserId: actor.id,
      targetUserId: null,
      action: "registration.set",
      result: "succeeded",
      metadata: { open },
    });
  }

  public async listAccounts(actor: Account): Promise<readonly Account[]> {
    this.#requireAdmin(actor);
    return this.#repository.listAccounts();
  }

  public async setAccountStatus(
    actor: Account,
    userId: string,
    status: UserStatus,
  ): Promise<Account> {
    this.#requireAdmin(actor);
    if (actor.id === userId && status === "disabled") {
      throw new IdentityError("cannot_disable_self", "管理员不能停用自己的当前账号", 409);
    }
    const account = await this.#repository.setAccountStatus(userId, status);
    if (account === null) {
      throw new IdentityError("account_not_found", "账号不存在", 404);
    }
    if (status === "disabled") {
      await this.#repository.revokeSessionsForUser(userId, this.#now());
    }
    await this.#repository.recordAuditEvent({
      actorUserId: actor.id,
      targetUserId: userId,
      action: "account.status.set",
      result: "succeeded",
      metadata: { status },
    });
    return account;
  }

  public async revokeAccountSessions(actor: Account, userId: string): Promise<void> {
    this.#requireAdmin(actor);
    const account = await this.#repository.findAccountById(userId);
    if (account === null) {
      throw new IdentityError("account_not_found", "账号不存在", 404);
    }
    await this.#repository.revokeSessionsForUser(userId, this.#now());
    await this.#repository.recordAuditEvent({
      actorUserId: actor.id,
      targetUserId: userId,
      action: "account.sessions.revoke",
      result: "succeeded",
    });
  }

  #requireAdmin(account: Account): void {
    if (account.role !== "admin") {
      throw new IdentityError("admin_required", "需要管理员权限", 403);
    }
  }

  async #issueSession(account: Account): Promise<AuthenticatedSession> {
    const token = createSessionToken();
    const now = this.#now();
    const expiresAt = new Date(now.getTime() + this.#sessionTtlHours * 60 * 60 * 1000);
    await this.#repository.createSession({
      userId: account.id,
      tokenHash: hashSessionToken(token, this.#sessionSecret),
      expiresAt,
    });
    return { token, expiresAt, account };
  }
}
