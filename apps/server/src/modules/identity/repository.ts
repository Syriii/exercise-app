import type {
  Account,
  AccountWithCredential,
  AuditInput,
  NewAccount,
  NewSession,
  SessionWithAccount,
  UserStatus,
} from "./types.js";

export interface IdentityRepository {
  isRegistrationOpen(): Promise<boolean>;
  setRegistrationOpen(open: boolean, actorUserId: string): Promise<void>;
  findAccountByNormalizedUsername(normalizedUsername: string): Promise<AccountWithCredential | null>;
  findAccountById(userId: string): Promise<Account | null>;
  createAccount(account: NewAccount, options: { bypassRegistration: boolean; maxAccounts?: number }): Promise<Account>;
  updatePassword(userId: string, passwordHash: string, passwordChangeRequired: boolean): Promise<Account | null>;
  createSession(session: NewSession): Promise<{ id: string }>;
  findSessionByTokenHash(tokenHash: string, now: Date): Promise<SessionWithAccount | null>;
  revokeSessionByTokenHash(tokenHash: string, revokedAt: Date): Promise<void>;
  revokeSessionsForUser(userId: string, revokedAt: Date): Promise<void>;
  listAccounts(): Promise<readonly Account[]>;
  setAccountStatus(userId: string, status: UserStatus): Promise<Account | null>;
  deleteAccount(userId: string): Promise<boolean>;
  recordAuditEvent(event: AuditInput): Promise<void>;
}
