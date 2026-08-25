import { and, asc, eq, gt, isNull } from "drizzle-orm";

import type { Database } from "../../db/database.js";
import {
  appSettings,
  auditEvents,
  credentials,
  sessions,
  users,
} from "../../db/schema/index.js";
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

function toAccount(user: typeof users.$inferSelect): Account {
  return {
    id: user.id,
    username: user.username,
    normalizedUsername: user.normalizedUsername,
    role: user.role,
    status: user.status,
    passwordChangeRequired: user.passwordChangeRequired,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "code" in error && error.code === "23505"
  );
}

export class PostgresIdentityRepository implements IdentityRepository {
  readonly #database: Database;

  public constructor(database: Database) {
    this.#database = database;
  }

  public async isRegistrationOpen(): Promise<boolean> {
    const [setting] = await this.#database
      .select({ registrationOpen: appSettings.registrationOpen })
      .from(appSettings)
      .where(eq(appSettings.id, 1))
      .limit(1);
    return setting?.registrationOpen ?? false;
  }

  public async setRegistrationOpen(open: boolean, actorUserId: string): Promise<void> {
    await this.#database
      .update(appSettings)
      .set({ registrationOpen: open, updatedBy: actorUserId, updatedAt: new Date() })
      .where(eq(appSettings.id, 1));
  }

  public async findAccountByNormalizedUsername(
    normalizedUsername: string,
  ): Promise<AccountWithCredential | null> {
    const [result] = await this.#database
      .select({ user: users, passwordHash: credentials.passwordHash })
      .from(users)
      .innerJoin(credentials, eq(credentials.userId, users.id))
      .where(eq(users.normalizedUsername, normalizedUsername))
      .limit(1);

    return result === undefined
      ? null
      : { ...toAccount(result.user), passwordHash: result.passwordHash };
  }

  public async findAccountById(userId: string): Promise<Account | null> {
    const [user] = await this.#database.select().from(users).where(eq(users.id, userId)).limit(1);
    return user === undefined ? null : toAccount(user);
  }

  public async createAccount(
    input: NewAccount,
    options: { bypassRegistration: boolean },
  ): Promise<Account> {
    try {
      return await this.#database.transaction(async (transaction) => {
        if (!options.bypassRegistration) {
          const [setting] = await transaction
            .select({ registrationOpen: appSettings.registrationOpen })
            .from(appSettings)
            .where(eq(appSettings.id, 1))
            .for("update")
            .limit(1);
          if (setting?.registrationOpen !== true) {
            throw new IdentityError("registration_closed", "当前未开放注册", 403);
          }
        }

        const [user] = await transaction
          .insert(users)
          .values({
            username: input.username,
            normalizedUsername: input.normalizedUsername,
            role: input.role,
            passwordChangeRequired: input.passwordChangeRequired,
          })
          .returning();
        if (user === undefined) {
          throw new Error("user insert returned no row");
        }

        await transaction.insert(credentials).values({
          userId: user.id,
          passwordHash: input.passwordHash,
        });
        return toAccount(user);
      });
    } catch (error) {
      if (error instanceof IdentityError) {
        throw error;
      }
      if (isUniqueViolation(error)) {
        throw new IdentityError("username_taken", "用户名已被使用", 409);
      }
      throw error;
    }
  }

  public async createSession(input: NewSession): Promise<{ id: string }> {
    const [session] = await this.#database.insert(sessions).values(input).returning({ id: sessions.id });
    if (session === undefined) {
      throw new Error("session insert returned no row");
    }
    return session;
  }

  public async updatePassword(userId: string, passwordHash: string): Promise<Account | null> {
    return this.#database.transaction(async (transaction) => {
      const [credential] = await transaction
        .update(credentials)
        .set({ passwordHash, updatedAt: new Date() })
        .where(eq(credentials.userId, userId))
        .returning({ userId: credentials.userId });
      if (credential === undefined) {
        return null;
      }

      const [user] = await transaction
        .update(users)
        .set({ passwordChangeRequired: false, updatedAt: new Date() })
        .where(eq(users.id, userId))
        .returning();
      return user === undefined ? null : toAccount(user);
    });
  }

  public async findSessionByTokenHash(
    tokenHash: string,
    now: Date,
  ): Promise<SessionWithAccount | null> {
    const [result] = await this.#database
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(sessions.tokenHash, tokenHash),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, now),
        ),
      )
      .limit(1);
    if (result === undefined) {
      return null;
    }
    return {
      id: result.session.id,
      tokenHash: result.session.tokenHash,
      expiresAt: result.session.expiresAt,
      revokedAt: result.session.revokedAt,
      account: toAccount(result.user),
    };
  }

  public async revokeSessionByTokenHash(tokenHash: string, revokedAt: Date): Promise<void> {
    await this.#database
      .update(sessions)
      .set({ revokedAt })
      .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)));
  }

  public async revokeSessionsForUser(userId: string, revokedAt: Date): Promise<void> {
    await this.#database
      .update(sessions)
      .set({ revokedAt })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  }

  public async listAccounts(): Promise<readonly Account[]> {
    const result = await this.#database.select().from(users).orderBy(asc(users.createdAt));
    return result.map(toAccount);
  }

  public async setAccountStatus(userId: string, status: UserStatus): Promise<Account | null> {
    const [user] = await this.#database
      .update(users)
      .set({ status, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    return user === undefined ? null : toAccount(user);
  }

  public async recordAuditEvent(event: AuditInput): Promise<void> {
    await this.#database.insert(auditEvents).values({
      actorUserId: event.actorUserId,
      targetUserId: event.targetUserId,
      action: event.action,
      result: event.result,
      metadata: event.metadata ?? {},
    });
  }
}
