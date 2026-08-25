import { randomUUID } from "node:crypto";

import { IdentityError } from "./errors.js";
import type { IdentityRepository } from "./repository.js";
import type {
  Account,
  AccountWithCredential,
  AuditInput,
  NewAccount,
  NewSession,
  SessionWithAccount,
  UserStatus,
} from "./types.js";

interface StoredSession extends NewSession {
  readonly id: string;
  revokedAt: Date | null;
}

export class MemoryIdentityRepository implements IdentityRepository {
  public registrationOpen = true;
  public readonly accounts = new Map<string, AccountWithCredential>();
  public readonly sessions = new Map<string, StoredSession>();
  public readonly auditEvents: AuditInput[] = [];

  public async isRegistrationOpen(): Promise<boolean> {
    return this.registrationOpen;
  }

  public async setRegistrationOpen(open: boolean, _actorUserId: string): Promise<void> {
    this.registrationOpen = open;
  }

  public async findAccountByNormalizedUsername(
    normalizedUsername: string,
  ): Promise<AccountWithCredential | null> {
    return (
      [...this.accounts.values()].find(
        (account) => account.normalizedUsername === normalizedUsername,
      ) ?? null
    );
  }

  public async findAccountById(userId: string): Promise<Account | null> {
    return this.accounts.get(userId) ?? null;
  }

  public async createAccount(
    input: NewAccount,
    options: { bypassRegistration: boolean },
  ): Promise<Account> {
    if (!options.bypassRegistration && !this.registrationOpen) {
      throw new IdentityError("registration_closed", "当前未开放注册", 403);
    }
    if ((await this.findAccountByNormalizedUsername(input.normalizedUsername)) !== null) {
      throw new IdentityError("username_taken", "用户名已被使用", 409);
    }

    const account: AccountWithCredential = {
      id: randomUUID(),
      status: "active",
      ...input,
    };
    this.accounts.set(account.id, account);
    return account;
  }

  public async createSession(input: NewSession): Promise<{ id: string }> {
    const id = randomUUID();
    this.sessions.set(input.tokenHash, { id, ...input, revokedAt: null });
    return { id };
  }

  public async updatePassword(userId: string, passwordHash: string): Promise<Account | null> {
    const account = this.accounts.get(userId);
    if (account === undefined) {
      return null;
    }
    const updated: AccountWithCredential = {
      ...account,
      passwordHash,
      passwordChangeRequired: false,
    };
    this.accounts.set(userId, updated);
    return updated;
  }

  public async findSessionByTokenHash(
    tokenHash: string,
    now: Date,
  ): Promise<SessionWithAccount | null> {
    const session = this.sessions.get(tokenHash);
    if (session === undefined || session.revokedAt !== null || session.expiresAt <= now) {
      return null;
    }
    const account = this.accounts.get(session.userId);
    if (account === undefined) {
      return null;
    }
    return { ...session, account };
  }

  public async revokeSessionByTokenHash(tokenHash: string, revokedAt: Date): Promise<void> {
    const session = this.sessions.get(tokenHash);
    if (session !== undefined) {
      session.revokedAt = revokedAt;
    }
  }

  public async revokeSessionsForUser(userId: string, revokedAt: Date): Promise<void> {
    for (const session of this.sessions.values()) {
      if (session.userId === userId) {
        session.revokedAt = revokedAt;
      }
    }
  }

  public async listAccounts(): Promise<readonly Account[]> {
    return [...this.accounts.values()];
  }

  public async setAccountStatus(userId: string, status: UserStatus): Promise<Account | null> {
    const account = this.accounts.get(userId);
    if (account === undefined) {
      return null;
    }
    const updated = { ...account, status };
    this.accounts.set(userId, updated);
    return updated;
  }

  public async recordAuditEvent(event: AuditInput): Promise<void> {
    this.auditEvents.push(event);
  }
}
