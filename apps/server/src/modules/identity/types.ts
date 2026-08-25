export type UserRole = "admin" | "user";
export type UserStatus = "active" | "disabled";

export interface Account {
  readonly id: string;
  readonly username: string;
  readonly normalizedUsername: string;
  readonly role: UserRole;
  readonly status: UserStatus;
  readonly passwordChangeRequired: boolean;
}

export interface AccountWithCredential extends Account {
  readonly passwordHash: string;
}

export interface SessionWithAccount {
  readonly id: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly account: Account;
}

export interface NewAccount {
  readonly username: string;
  readonly normalizedUsername: string;
  readonly passwordHash: string;
  readonly role: UserRole;
  readonly passwordChangeRequired: boolean;
}

export interface NewSession {
  readonly userId: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
}

export interface AuditInput {
  readonly actorUserId: string | null;
  readonly targetUserId: string | null;
  readonly action: string;
  readonly result: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}
