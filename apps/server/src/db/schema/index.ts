import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const userRole = pgEnum("user_role", ["admin", "user"]);
export const userStatus = pgEnum("user_status", ["active", "disabled"]);
export const taskStatus = pgEnum("task_status", [
  "pending",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);
export const attemptStatus = pgEnum("task_attempt_status", [
  "running",
  "succeeded",
  "failed",
]);
export const temporaryMediaStatus = pgEnum("temporary_media_status", [
  "available",
  "deletion_pending",
  "deleted",
  "missing",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    username: text("username").notNull(),
    normalizedUsername: text("normalized_username").notNull(),
    role: userRole("role").default("user").notNull(),
    status: userStatus("status").default("active").notNull(),
    passwordChangeRequired: boolean("password_change_required").default(false).notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex("users_normalized_username_uq").on(table.normalizedUsername)],
);

export const credentials = pgTable(
  "credentials",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    passwordHash: text("password_hash").notNull(),
    ...timestamps,
  },
  (table) => [
    check("credentials_password_hash_argon2id_ck", sql`${table.passwordHash} like '$argon2id$%'`),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("sessions_token_hash_uq").on(table.tokenHash),
    index("sessions_user_id_idx").on(table.userId),
    index("sessions_expires_at_idx").on(table.expiresAt),
  ],
);

export const appSettings = pgTable(
  "app_settings",
  {
    id: integer("id").primaryKey().default(1),
    registrationOpen: boolean("registration_open").default(true).notNull(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (table) => [check("app_settings_singleton_ck", sql`${table.id} = 1`)],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    targetUserId: uuid("target_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    result: text("result").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("audit_events_actor_idx").on(table.actorUserId),
    index("audit_events_created_at_idx").on(table.createdAt),
  ],
);

export const backgroundTasks = pgTable(
  "background_tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    status: taskStatus("status").default("pending").notNull(),
    subjectId: uuid("subject_id"),
    deduplicationKey: text("deduplication_key"),
    lastErrorCode: text("last_error_code"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("background_tasks_status_idx").on(table.status),
    index("background_tasks_user_idx").on(table.userId),
    uniqueIndex("background_tasks_deduplication_uq")
      .on(table.type, table.deduplicationKey)
      .where(sql`${table.deduplicationKey} is not null`),
  ],
);

export const backgroundTaskAttempts = pgTable(
  "background_task_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => backgroundTasks.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    status: attemptStatus("status").default("running").notNull(),
    errorCode: text("error_code"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("background_task_attempts_sequence_uq").on(table.taskId, table.sequence),
    index("background_task_attempts_task_idx").on(table.taskId),
  ],
);

export const temporaryMedia = pgTable(
  "temporary_media",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    objectKey: text("object_key").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    sha256: text("sha256").notNull(),
    status: temporaryMediaStatus("status").default("available").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("temporary_media_object_key_uq").on(table.objectKey),
    index("temporary_media_user_idx").on(table.userId),
    index("temporary_media_expiry_idx").on(table.expiresAt),
    check("temporary_media_byte_size_ck", sql`${table.byteSize} > 0`),
  ],
);

export const schema = {
  users,
  credentials,
  sessions,
  appSettings,
  auditEvents,
  backgroundTasks,
  backgroundTaskAttempts,
  temporaryMedia,
};
