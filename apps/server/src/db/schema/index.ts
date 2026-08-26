import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
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
export const trainingSessionStatus = pgEnum("training_session_status", [
  "in_progress",
  "completed",
  "abandoned",
]);
export const trainingSessionItemOrigin = pgEnum("training_session_item_origin", [
  "planned",
  "extra",
]);
export const trainingSessionItemStatus = pgEnum("training_session_item_status", [
  "pending",
  "completed",
  "skipped",
]);
export const trainingSuggestionStatus = pgEnum("training_suggestion_status", [
  "active",
  "adopted",
  "dismissed",
]);
export const trainingReminderDayStatus = pgEnum("training_reminder_day_status", [
  "snoozed",
  "dismissed",
]);
export const planningSexCategory = pgEnum("planning_sex_category", ["male", "female"]);
export const planningPalCategory = pgEnum("planning_pal_category", ["inactive", "low_active", "active", "very_active"]);
export const planningWeightStrategy = pgEnum("planning_weight_strategy", ["maintain", "lose", "gain"]);
export const planningMacroPreference = pgEnum("planning_macro_preference", ["balanced", "high_protein", "lower_fat"]);
export const mealContributionMode = pgEnum("meal_contribution_mode", ["item", "whole_meal", "supplement"]);
export const mealContributionSource = pgEnum("meal_contribution_source", ["manual", "model_adopted"]);
export const mealContributionReviewStatus = pgEnum("meal_contribution_review_status", ["tentative", "confirmed"]);
export const mealImageAnalysisStatus = pgEnum("meal_image_analysis_status", ["pending", "running", "succeeded", "failed", "cancelled"]);

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

export const runtimeHeartbeats = pgTable("runtime_heartbeats", {
  component: text("component").primaryKey(),
  instanceId: text("instance_id").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
});

export const maintenanceEvents = pgTable(
  "maintenance_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    type: text("type").notNull(),
    status: text("status").notNull(),
    artifactSha256: text("artifact_sha256"),
    details: jsonb("details").$type<Record<string, unknown>>().default({}).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("maintenance_events_type_completed_idx").on(table.type, table.completedAt),
    check("maintenance_events_type_ck", sql`${table.type} in ('backup', 'restore_verification')`),
    check("maintenance_events_status_ck", sql`${table.status} in ('succeeded', 'failed')`),
  ],
);

export const trainingSuggestions = pgTable(
  "training_suggestions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: trainingSuggestionStatus("status").default("active").notNull(),
    methodVersion: text("method_version").notNull(),
    evidenceIds: jsonb("evidence_ids").$type<readonly string[]>().notNull(),
    inputSnapshot: jsonb("input_snapshot").$type<Record<string, unknown>>().notNull(),
    candidate: jsonb("candidate").$type<Record<string, unknown>>().notNull(),
    adoptedTemplateId: uuid("adopted_template_id"),
    revision: integer("revision").default(1).notNull(),
    adoptedAt: timestamp("adopted_at", { withTimezone: true }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("training_suggestions_user_idx").on(table.userId, table.createdAt),
    check("training_suggestions_revision_positive_ck", sql`${table.revision} > 0`),
  ],
);

export const trainingTemplates = pgTable(
  "training_templates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    note: text("note"),
    sourceSuggestionId: uuid("source_suggestion_id"),
    revision: integer("revision").default(1).notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("training_templates_user_idx").on(table.userId),
    uniqueIndex("training_templates_source_suggestion_uq").on(table.sourceSuggestionId),
    check("training_templates_name_not_blank_ck", sql`length(btrim(${table.name})) > 0`),
    check("training_templates_revision_positive_ck", sql`${table.revision} > 0`),
  ],
);

export const trainingTemplateItems = pgTable(
  "training_template_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => trainingTemplates.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull(),
    exerciseName: text("exercise_name").notNull(),
    targetSets: integer("target_sets"),
    targetRepsMin: integer("target_reps_min"),
    targetRepsMax: integer("target_reps_max"),
    targetWeightKg: numeric("target_weight_kg", { precision: 8, scale: 3 }),
    targetDurationSeconds: integer("target_duration_seconds"),
    targetDistanceMeters: numeric("target_distance_meters", { precision: 12, scale: 3 }),
    note: text("note"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("training_template_items_order_uq").on(table.templateId, table.sortOrder),
    index("training_template_items_template_idx").on(table.templateId),
    check("training_template_items_name_not_blank_ck", sql`length(btrim(${table.exerciseName})) > 0`),
    check("training_template_items_order_nonnegative_ck", sql`${table.sortOrder} >= 0`),
    check("training_template_items_sets_positive_ck", sql`${table.targetSets} is null or ${table.targetSets} > 0`),
    check("training_template_items_reps_min_positive_ck", sql`${table.targetRepsMin} is null or ${table.targetRepsMin} > 0`),
    check("training_template_items_reps_max_valid_ck", sql`${table.targetRepsMax} is null or (${table.targetRepsMax} > 0 and (${table.targetRepsMin} is null or ${table.targetRepsMax} >= ${table.targetRepsMin}))`),
    check("training_template_items_weight_positive_ck", sql`${table.targetWeightKg} is null or ${table.targetWeightKg} > 0`),
    check("training_template_items_duration_positive_ck", sql`${table.targetDurationSeconds} is null or ${table.targetDurationSeconds} > 0`),
    check("training_template_items_distance_positive_ck", sql`${table.targetDistanceMeters} is null or ${table.targetDistanceMeters} > 0`),
  ],
);

export const trainingPrograms = pgTable(
  "training_programs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    note: text("note"),
    weekCount: integer("week_count").notNull(),
    revision: integer("revision").default(1).notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("training_programs_user_idx").on(table.userId),
    check("training_programs_name_not_blank_ck", sql`length(btrim(${table.name})) > 0`),
    check("training_programs_week_count_positive_ck", sql`${table.weekCount} > 0`),
    check("training_programs_revision_positive_ck", sql`${table.revision} > 0`),
  ],
);

export const trainingProgramUnits = pgTable(
  "training_program_units",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    programId: uuid("program_id")
      .notNull()
      .references(() => trainingPrograms.id, { onDelete: "cascade" }),
    sourceTemplateId: uuid("source_template_id").references(() => trainingTemplates.id, {
      onDelete: "set null",
    }),
    sourceTemplateName: text("source_template_name"),
    sourceTemplateRevision: integer("source_template_revision"),
    importedAt: timestamp("imported_at", { withTimezone: true }),
    weekNumber: integer("week_number").notNull(),
    sortOrder: integer("sort_order").notNull(),
    name: text("name").notNull(),
    note: text("note"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("training_program_units_order_uq").on(
      table.programId,
      table.weekNumber,
      table.sortOrder,
    ),
    index("training_program_units_program_idx").on(table.programId),
    index("training_program_units_source_template_idx").on(table.sourceTemplateId),
    check("training_program_units_name_not_blank_ck", sql`length(btrim(${table.name})) > 0`),
    check("training_program_units_week_positive_ck", sql`${table.weekNumber} > 0`),
    check("training_program_units_order_nonnegative_ck", sql`${table.sortOrder} >= 0`),
    check(
      "training_program_units_source_revision_positive_ck",
      sql`${table.sourceTemplateRevision} is null or ${table.sourceTemplateRevision} > 0`,
    ),
  ],
);

export const trainingProgramUnitItems = pgTable(
  "training_program_unit_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => trainingProgramUnits.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull(),
    exerciseName: text("exercise_name").notNull(),
    targetSets: integer("target_sets"),
    targetRepsMin: integer("target_reps_min"),
    targetRepsMax: integer("target_reps_max"),
    targetWeightKg: numeric("target_weight_kg", { precision: 8, scale: 3 }),
    targetDurationSeconds: integer("target_duration_seconds"),
    targetDistanceMeters: numeric("target_distance_meters", { precision: 12, scale: 3 }),
    note: text("note"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("training_program_unit_items_order_uq").on(table.unitId, table.sortOrder),
    index("training_program_unit_items_unit_idx").on(table.unitId),
    check("training_program_unit_items_name_not_blank_ck", sql`length(btrim(${table.exerciseName})) > 0`),
    check("training_program_unit_items_order_nonnegative_ck", sql`${table.sortOrder} >= 0`),
    check("training_program_unit_items_sets_positive_ck", sql`${table.targetSets} is null or ${table.targetSets} > 0`),
    check("training_program_unit_items_reps_min_positive_ck", sql`${table.targetRepsMin} is null or ${table.targetRepsMin} > 0`),
    check("training_program_unit_items_reps_max_valid_ck", sql`${table.targetRepsMax} is null or (${table.targetRepsMax} > 0 and (${table.targetRepsMin} is null or ${table.targetRepsMax} >= ${table.targetRepsMin}))`),
    check("training_program_unit_items_weight_positive_ck", sql`${table.targetWeightKg} is null or ${table.targetWeightKg} > 0`),
    check("training_program_unit_items_duration_positive_ck", sql`${table.targetDurationSeconds} is null or ${table.targetDurationSeconds} > 0`),
    check("training_program_unit_items_distance_positive_ck", sql`${table.targetDistanceMeters} is null or ${table.targetDistanceMeters} > 0`),
  ],
);

export const trainingSchedules = pgTable(
  "training_schedules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    localDate: date("local_date").notNull(),
    timeZone: text("time_zone").notNull(),
    title: text("title").notNull(),
    note: text("note"),
    sourceTemplateId: uuid("source_template_id").references(() => trainingTemplates.id, {
      onDelete: "set null",
    }),
    sourceTemplateName: text("source_template_name"),
    sourceProgramId: uuid("source_program_id").references(() => trainingPrograms.id, {
      onDelete: "set null",
    }),
    sourceProgramName: text("source_program_name"),
    sourceProgramUnitId: uuid("source_program_unit_id").references(() => trainingProgramUnits.id, {
      onDelete: "set null",
    }),
    sourceWeekNumber: integer("source_week_number"),
    sourceTrainingDayName: text("source_training_day_name"),
    revision: integer("revision").default(1).notNull(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("training_schedules_user_date_idx").on(table.userId, table.localDate),
    index("training_schedules_source_template_idx").on(table.sourceTemplateId),
    index("training_schedules_source_unit_idx").on(table.sourceProgramUnitId),
    check("training_schedules_title_not_blank_ck", sql`length(btrim(${table.title})) > 0`),
    check("training_schedules_revision_positive_ck", sql`${table.revision} > 0`),
  ],
);

export const trainingSessions = pgTable(
  "training_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sourceScheduleId: uuid("source_schedule_id").references(() => trainingSchedules.id, {
      onDelete: "set null",
    }),
    sourceScheduleTitle: text("source_schedule_title"),
    sourceTemplateId: uuid("source_template_id").references(() => trainingTemplates.id, {
      onDelete: "set null",
    }),
    sourceTemplateName: text("source_template_name"),
    sourceProgramId: uuid("source_program_id").references(() => trainingPrograms.id, {
      onDelete: "set null",
    }),
    sourceProgramName: text("source_program_name"),
    sourceProgramUnitId: uuid("source_program_unit_id").references(() => trainingProgramUnits.id, {
      onDelete: "set null",
    }),
    sourceWeekNumber: integer("source_week_number"),
    sourceTrainingDayName: text("source_training_day_name"),
    status: trainingSessionStatus("status").default("in_progress").notNull(),
    revision: integer("revision").default(1).notNull(),
    timeZone: text("time_zone").notNull(),
    localDate: date("local_date").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    note: text("note"),
    expenditureAssessment: jsonb("expenditure_assessment").$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (table) => [
    index("training_sessions_user_date_idx").on(table.userId, table.localDate),
    index("training_sessions_user_status_idx").on(table.userId, table.status),
    uniqueIndex("training_sessions_source_schedule_uq").on(table.sourceScheduleId),
    index("training_sessions_source_program_unit_idx").on(table.sourceProgramUnitId),
    check("training_sessions_revision_positive_ck", sql`${table.revision} > 0`),
  ],
);

export const trainingSessionItems = pgTable(
  "training_session_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => trainingSessions.id, { onDelete: "cascade" }),
    sourceTemplateItemId: uuid("source_template_item_id").references(() => trainingTemplateItems.id, {
      onDelete: "set null",
    }),
    origin: trainingSessionItemOrigin("origin").notNull(),
    status: trainingSessionItemStatus("status").default("pending").notNull(),
    sortOrder: integer("sort_order").notNull(),
    exerciseName: text("exercise_name").notNull(),
    performedExerciseName: text("performed_exercise_name"),
    targetSets: integer("target_sets"),
    targetRepsMin: integer("target_reps_min"),
    targetRepsMax: integer("target_reps_max"),
    targetWeightKg: numeric("target_weight_kg", { precision: 8, scale: 3 }),
    targetDurationSeconds: integer("target_duration_seconds"),
    targetDistanceMeters: numeric("target_distance_meters", { precision: 12, scale: 3 }),
    targetNote: text("target_note"),
    actualNote: text("actual_note"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("training_session_items_order_uq").on(table.sessionId, table.sortOrder),
    index("training_session_items_session_idx").on(table.sessionId),
    check("training_session_items_name_not_blank_ck", sql`length(btrim(${table.exerciseName})) > 0`),
    check(
      "training_session_items_performed_name_not_blank_ck",
      sql`${table.performedExerciseName} is null or length(btrim(${table.performedExerciseName})) > 0`,
    ),
    check("training_session_items_order_nonnegative_ck", sql`${table.sortOrder} >= 0`),
  ],
);

export const trainingSessionSets = pgTable(
  "training_session_sets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionItemId: uuid("session_item_id")
      .notNull()
      .references(() => trainingSessionItems.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    reps: integer("reps"),
    weightKg: numeric("weight_kg", { precision: 8, scale: 3 }),
    durationSeconds: integer("duration_seconds"),
    distanceMeters: numeric("distance_meters", { precision: 12, scale: 3 }),
    note: text("note"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("training_session_sets_sequence_uq").on(table.sessionItemId, table.sequence),
    index("training_session_sets_item_idx").on(table.sessionItemId),
    check("training_session_sets_sequence_positive_ck", sql`${table.sequence} > 0`),
    check("training_session_sets_reps_nonnegative_ck", sql`${table.reps} is null or ${table.reps} >= 0`),
    check("training_session_sets_weight_nonnegative_ck", sql`${table.weightKg} is null or ${table.weightKg} >= 0`),
    check("training_session_sets_duration_nonnegative_ck", sql`${table.durationSeconds} is null or ${table.durationSeconds} >= 0`),
    check("training_session_sets_distance_nonnegative_ck", sql`${table.distanceMeters} is null or ${table.distanceMeters} >= 0`),
  ],
);

export const trainingSessionItemRevisions = pgTable(
  "training_session_item_revisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => trainingSessions.id, { onDelete: "cascade" }),
    sessionItemId: uuid("session_item_id")
      .notNull()
      .references(() => trainingSessionItems.id, { onDelete: "cascade" }),
    sessionRevision: integer("session_revision").notNull(),
    status: trainingSessionItemStatus("status").notNull(),
    performedExerciseName: text("performed_exercise_name"),
    actualNote: text("actual_note"),
    setsSnapshot: jsonb("sets_snapshot").$type<Array<{
      id: string;
      sequence: number;
      reps: number | null;
      weightKg: string | null;
      durationSeconds: number | null;
      distanceMeters: string | null;
      note: string | null;
    }>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("training_session_item_revisions_session_idx").on(table.sessionId, table.createdAt),
    index("training_session_item_revisions_item_idx").on(table.sessionItemId, table.createdAt),
    check("training_session_item_revisions_revision_positive_ck", sql`${table.sessionRevision} > 0`),
  ],
);

export const trainingSessionRevisions = pgTable(
  "training_session_revisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => trainingSessions.id, { onDelete: "cascade" }),
    sessionRevision: integer("session_revision").notNull(),
    localDate: date("local_date").notNull(),
    timeZone: text("time_zone").notNull(),
    note: text("note"),
    expenditureAssessment: jsonb("expenditure_assessment").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("training_session_revisions_session_idx").on(table.sessionId, table.createdAt),
    check("training_session_revisions_revision_positive_ck", sql`${table.sessionRevision} > 0`),
  ],
);

export const trainingReminderRules = pgTable(
  "training_reminder_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").default(false).notNull(),
    localTime: text("local_time").default("18:00").notNull(),
    timeZone: text("time_zone").notNull(),
    revision: integer("revision").default(1).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("training_reminder_rules_user_uq").on(table.userId),
    check("training_reminder_rules_time_ck", sql`${table.localTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
    check("training_reminder_rules_revision_positive_ck", sql`${table.revision} > 0`),
  ],
);

export const trainingReminderDayStates = pgTable(
  "training_reminder_day_states",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    localDate: date("local_date").notNull(),
    status: trainingReminderDayStatus("status").notNull(),
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("training_reminder_day_states_user_date_uq").on(table.userId, table.localDate),
    check("training_reminder_day_states_snooze_ck", sql`${table.status} <> 'snoozed' or ${table.snoozedUntil} is not null`),
  ],
);

export const nutritionReminderRules = pgTable(
  "nutrition_reminder_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").default(false).notNull(),
    localTime: text("local_time").default("20:00").notNull(),
    timeZone: text("time_zone").notNull(),
    revision: integer("revision").default(1).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("nutrition_reminder_rules_user_uq").on(table.userId),
    check("nutrition_reminder_rules_time_ck", sql`${table.localTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
    check("nutrition_reminder_rules_revision_positive_ck", sql`${table.revision} > 0`),
  ],
);

export const nutritionReminderDayStates = pgTable(
  "nutrition_reminder_day_states",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    localDate: date("local_date").notNull(),
    status: trainingReminderDayStatus("status").notNull(),
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("nutrition_reminder_day_states_user_date_uq").on(table.userId, table.localDate),
    check("nutrition_reminder_day_states_snooze_ck", sql`${table.status} <> 'snoozed' or ${table.snoozedUntil} is not null`),
  ],
);

export const measurementReminderRules = pgTable(
  "measurement_reminder_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").default(true).notNull(),
    intervalDays: integer("interval_days").default(7).notNull(),
    localTime: text("local_time").default("09:00").notNull(),
    timeZone: text("time_zone").notNull(),
    revision: integer("revision").default(1).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("measurement_reminder_rules_user_uq").on(table.userId),
    check("measurement_reminder_rules_interval_ck", sql`${table.intervalDays} between 1 and 365`),
    check("measurement_reminder_rules_time_ck", sql`${table.localTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
    check("measurement_reminder_rules_revision_positive_ck", sql`${table.revision} > 0`),
  ],
);

export const measurementReminderDayStates = pgTable(
  "measurement_reminder_day_states",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    localDate: date("local_date").notNull(),
    status: trainingReminderDayStatus("status").notNull(),
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("measurement_reminder_day_states_user_date_uq").on(table.userId, table.localDate),
    check("measurement_reminder_day_states_snooze_ck", sql`${table.status} <> 'snoozed' or ${table.snoozedUntil} is not null`),
  ],
);

export const personalProfiles = pgTable(
  "personal_profiles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    birthDate: date("birth_date"),
    sexCategory: planningSexCategory("sex_category"),
    heightCm: numeric("height_cm", { precision: 6, scale: 2 }),
    pregnantOrBreastfeeding: boolean("pregnant_or_breastfeeding").default(false).notNull(),
    medicalNutritionCondition: boolean("medical_nutrition_condition").default(false).notNull(),
    specialBodyComposition: boolean("special_body_composition").default(false).notNull(),
    palCategory: planningPalCategory("pal_category"),
    revision: integer("revision").default(1).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("personal_profiles_user_uq").on(table.userId),
    check("personal_profiles_height_ck", sql`${table.heightCm} is null or (${table.heightCm} >= 80 and ${table.heightCm} <= 250)`),
    check("personal_profiles_revision_positive_ck", sql`${table.revision} > 0`),
  ],
);

export const goalStrategies = pgTable(
  "goal_strategies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    weightStrategy: planningWeightStrategy("weight_strategy").default("maintain").notNull(),
    macroPreference: planningMacroPreference("macro_preference").default("balanced").notNull(),
    regularExercise: boolean("regular_exercise").default(false).notNull(),
    trainingIntent: text("training_intent"),
    targetWeightKg: numeric("target_weight_kg", { precision: 6, scale: 2 }),
    targetDate: date("target_date"),
    revision: integer("revision").default(1).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("goal_strategies_user_uq").on(table.userId),
    check("goal_strategies_target_weight_ck", sql`${table.targetWeightKg} is null or (${table.targetWeightKg} >= 20 and ${table.targetWeightKg} <= 400)`),
    check("goal_strategies_lower_fat_ck", sql`${table.macroPreference} <> 'lower_fat' or ${table.weightStrategy} = 'lose'`),
    check("goal_strategies_revision_positive_ck", sql`${table.revision} > 0`),
  ],
);

export const bodyMeasurements = pgTable(
  "body_measurements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    measuredAt: timestamp("measured_at", { withTimezone: true }).notNull(),
    localDate: date("local_date").notNull(),
    timeZone: text("time_zone").notNull(),
    weightKg: numeric("weight_kg", { precision: 6, scale: 2 }).notNull(),
    waistCm: numeric("waist_cm", { precision: 6, scale: 2 }),
    note: text("note"),
    revision: integer("revision").default(1).notNull(),
    ...timestamps,
  },
  (table) => [
    index("body_measurements_user_date_idx").on(table.userId, table.localDate),
    check("body_measurements_weight_ck", sql`${table.weightKg} >= 20 and ${table.weightKg} <= 400`),
    check("body_measurements_waist_ck", sql`${table.waistCm} is null or (${table.waistCm} >= 30 and ${table.waistCm} <= 300)`),
    check("body_measurements_revision_positive_ck", sql`${table.revision} > 0`),
  ],
);

export const bodyMeasurementRevisions = pgTable(
  "body_measurement_revisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    measurementId: uuid("measurement_id").notNull().references(() => bodyMeasurements.id, { onDelete: "cascade" }),
    measurementRevision: integer("measurement_revision").notNull(),
    measuredAt: timestamp("measured_at", { withTimezone: true }).notNull(),
    localDate: date("local_date").notNull(),
    timeZone: text("time_zone").notNull(),
    weightKg: numeric("weight_kg", { precision: 6, scale: 2 }).notNull(),
    waistCm: numeric("waist_cm", { precision: 6, scale: 2 }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("body_measurement_revisions_measurement_idx").on(table.measurementId, table.createdAt),
    check("body_measurement_revisions_revision_positive_ck", sql`${table.measurementRevision} > 0`),
  ],
);

export const dailyPlanningReferences = pgTable(
  "daily_planning_references",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    localDate: date("local_date").notNull(),
    revision: integer("revision").notNull(),
    methodVersion: text("method_version").notNull(),
    evidenceIds: jsonb("evidence_ids").$type<string[]>().notNull(),
    inputSnapshot: jsonb("input_snapshot").$type<Record<string, unknown>>().notNull(),
    result: jsonb("result").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("daily_planning_references_user_date_revision_uq").on(table.userId, table.localDate, table.revision),
    index("daily_planning_references_user_date_idx").on(table.userId, table.localDate),
    check("daily_planning_references_revision_positive_ck", sql`${table.revision} > 0`),
    check("daily_planning_references_method_not_blank_ck", sql`length(btrim(${table.methodVersion})) > 0`),
  ],
);

export const meals = pgTable(
  "meals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    localDate: date("local_date").notNull(),
    timeZone: text("time_zone").notNull(),
    name: text("name"),
    note: text("note"),
    revision: integer("revision").default(1).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("meals_user_date_idx").on(table.userId, table.localDate),
    check("meals_revision_positive_ck", sql`${table.revision} > 0`),
    check("meals_name_not_blank_ck", sql`${table.name} is null or length(btrim(${table.name})) > 0`),
  ],
);

export const dietPlans = pgTable(
  "diet_plans",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    dateFrom: date("date_from").notNull(),
    dateTo: date("date_to").notNull(),
    title: text("title").notNull(),
    note: text("note"),
    entries: jsonb("entries").$type<Array<{ id: string; localDate: string | null; mealName: string | null; foodPlan: string; note: string | null }>>().notNull(),
    revision: integer("revision").default(1).notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("diet_plans_user_dates_idx").on(table.userId, table.dateFrom, table.dateTo),
    check("diet_plans_date_range_ck", sql`${table.dateTo} >= ${table.dateFrom}`),
    check("diet_plans_title_not_blank_ck", sql`length(btrim(${table.title})) > 0`),
    check("diet_plans_revision_positive_ck", sql`${table.revision} > 0`),
  ],
);

export const mealRevisions = pgTable(
  "meal_revisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    mealId: uuid("meal_id").notNull().references(() => meals.id, { onDelete: "cascade" }),
    mealRevision: integer("meal_revision").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    localDate: date("local_date").notNull(),
    timeZone: text("time_zone").notNull(),
    name: text("name"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("meal_revisions_meal_idx").on(table.mealId, table.createdAt),
    check("meal_revisions_revision_positive_ck", sql`${table.mealRevision} > 0`),
  ],
);

export const mealContributions = pgTable(
  "meal_contributions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    mealId: uuid("meal_id").notNull().references(() => meals.id, { onDelete: "cascade" }),
    mode: mealContributionMode("mode").notNull(),
    source: mealContributionSource("source").default("manual").notNull(),
    reviewStatus: mealContributionReviewStatus("review_status").default("confirmed").notNull(),
    sourceAnalysisId: uuid("source_analysis_id"),
    label: text("label").notNull(),
    portionAmount: numeric("portion_amount", { precision: 12, scale: 3 }),
    portionUnit: text("portion_unit"),
    basisDescription: text("basis_description"),
    energyKcal: numeric("energy_kcal", { precision: 12, scale: 3 }),
    proteinGrams: numeric("protein_grams", { precision: 12, scale: 3 }),
    carbohydrateGrams: numeric("carbohydrate_grams", { precision: 12, scale: 3 }),
    fatGrams: numeric("fat_grams", { precision: 12, scale: 3 }),
    revision: integer("revision").default(1).notNull(),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("meal_contributions_meal_idx").on(table.mealId),
    uniqueIndex("meal_contributions_source_analysis_uq").on(table.sourceAnalysisId).where(sql`${table.sourceAnalysisId} is not null`),
    check("meal_contributions_label_not_blank_ck", sql`length(btrim(${table.label})) > 0`),
    check("meal_contributions_portion_nonnegative_ck", sql`${table.portionAmount} is null or ${table.portionAmount} >= 0`),
    check("meal_contributions_energy_nonnegative_ck", sql`${table.energyKcal} is null or ${table.energyKcal} >= 0`),
    check("meal_contributions_protein_nonnegative_ck", sql`${table.proteinGrams} is null or ${table.proteinGrams} >= 0`),
    check("meal_contributions_carbohydrate_nonnegative_ck", sql`${table.carbohydrateGrams} is null or ${table.carbohydrateGrams} >= 0`),
    check("meal_contributions_fat_nonnegative_ck", sql`${table.fatGrams} is null or ${table.fatGrams} >= 0`),
    check("meal_contributions_any_nutrient_ck", sql`${table.energyKcal} is not null or ${table.proteinGrams} is not null or ${table.carbohydrateGrams} is not null or ${table.fatGrams} is not null`),
    check("meal_contributions_revision_positive_ck", sql`${table.revision} > 0`),
  ],
);

export const mealContributionRevisions = pgTable(
  "meal_contribution_revisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    contributionId: uuid("contribution_id").notNull().references(() => mealContributions.id, { onDelete: "cascade" }),
    contributionRevision: integer("contribution_revision").notNull(),
    mode: mealContributionMode("mode").notNull(),
    source: mealContributionSource("source").default("manual").notNull(),
    reviewStatus: mealContributionReviewStatus("review_status").default("confirmed").notNull(),
    sourceAnalysisId: uuid("source_analysis_id"),
    label: text("label").notNull(),
    portionAmount: numeric("portion_amount", { precision: 12, scale: 3 }),
    portionUnit: text("portion_unit"),
    basisDescription: text("basis_description"),
    energyKcal: numeric("energy_kcal", { precision: 12, scale: 3 }),
    proteinGrams: numeric("protein_grams", { precision: 12, scale: 3 }),
    carbohydrateGrams: numeric("carbohydrate_grams", { precision: 12, scale: 3 }),
    fatGrams: numeric("fat_grams", { precision: 12, scale: 3 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("meal_contribution_revisions_contribution_idx").on(table.contributionId, table.createdAt),
    check("meal_contribution_revisions_revision_positive_ck", sql`${table.contributionRevision} > 0`),
  ],
);

export const nutritionDayStates = pgTable(
  "nutrition_day_states",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    localDate: date("local_date").notNull(),
    coverageConfirmed: boolean("coverage_confirmed").default(false).notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex("nutrition_day_states_user_date_uq").on(table.userId, table.localDate)],
);

export const personalFoodTemplates = pgTable(
  "personal_food_templates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    portionAmount: numeric("portion_amount", { precision: 12, scale: 3 }),
    portionUnit: text("portion_unit"),
    basisDescription: text("basis_description"),
    energyKcal: numeric("energy_kcal", { precision: 12, scale: 3 }),
    proteinGrams: numeric("protein_grams", { precision: 12, scale: 3 }),
    carbohydrateGrams: numeric("carbohydrate_grams", { precision: 12, scale: 3 }),
    fatGrams: numeric("fat_grams", { precision: 12, scale: 3 }),
    revision: integer("revision").default(1).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("personal_food_templates_user_idx").on(table.userId),
    check("personal_food_templates_label_not_blank_ck", sql`length(btrim(${table.label})) > 0`),
    check("personal_food_templates_portion_nonnegative_ck", sql`${table.portionAmount} is null or ${table.portionAmount} >= 0`),
    check("personal_food_templates_energy_nonnegative_ck", sql`${table.energyKcal} is null or ${table.energyKcal} >= 0`),
    check("personal_food_templates_protein_nonnegative_ck", sql`${table.proteinGrams} is null or ${table.proteinGrams} >= 0`),
    check("personal_food_templates_carbohydrate_nonnegative_ck", sql`${table.carbohydrateGrams} is null or ${table.carbohydrateGrams} >= 0`),
    check("personal_food_templates_fat_nonnegative_ck", sql`${table.fatGrams} is null or ${table.fatGrams} >= 0`),
    check("personal_food_templates_any_nutrient_ck", sql`${table.energyKcal} is not null or ${table.proteinGrams} is not null or ${table.carbohydrateGrams} is not null or ${table.fatGrams} is not null`),
    check("personal_food_templates_revision_positive_ck", sql`${table.revision} > 0`),
  ],
);

export const mealImageAnalyses = pgTable(
  "meal_image_analyses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    mealId: uuid("meal_id").notNull().references(() => meals.id, { onDelete: "cascade" }),
    mediaId: uuid("media_id").notNull().references(() => temporaryMedia.id, { onDelete: "restrict" }),
    status: mealImageAnalysisStatus("status").default("pending").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    rawCandidate: jsonb("raw_candidate").$type<Record<string, unknown>>(),
    uncertaintyNote: text("uncertainty_note"),
    lastErrorCode: text("last_error_code"),
    adoptedAt: timestamp("adopted_at", { withTimezone: true }),
    revision: integer("revision").default(1).notNull(),
    ...timestamps,
  },
  (table) => [
    index("meal_image_analyses_user_meal_idx").on(table.userId, table.mealId),
    index("meal_image_analyses_status_idx").on(table.status),
    check("meal_image_analyses_model_not_blank_ck", sql`length(btrim(${table.model})) > 0`),
    check("meal_image_analyses_prompt_not_blank_ck", sql`length(btrim(${table.promptVersion})) > 0`),
    check("meal_image_analyses_revision_positive_ck", sql`${table.revision} > 0`),
  ],
);

export const mealImageAnalysisAttempts = pgTable(
  "meal_image_analysis_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    analysisId: uuid("analysis_id").notNull().references(() => mealImageAnalyses.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    status: attemptStatus("status").default("running").notNull(),
    providerRequestId: text("provider_request_id"),
    errorCode: text("error_code"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("meal_image_analysis_attempts_sequence_uq").on(table.analysisId, table.sequence),
    index("meal_image_analysis_attempts_analysis_idx").on(table.analysisId),
    check("meal_image_analysis_attempts_sequence_positive_ck", sql`${table.sequence} > 0`),
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
  runtimeHeartbeats,
  maintenanceEvents,
  trainingSuggestions,
  trainingTemplates,
  trainingTemplateItems,
  trainingPrograms,
  trainingProgramUnits,
  trainingProgramUnitItems,
  trainingSchedules,
  trainingSessions,
  trainingSessionItems,
  trainingSessionSets,
  trainingSessionItemRevisions,
  trainingSessionRevisions,
  trainingReminderRules,
  trainingReminderDayStates,
  nutritionReminderRules,
  nutritionReminderDayStates,
  measurementReminderRules,
  measurementReminderDayStates,
  personalProfiles,
  goalStrategies,
  bodyMeasurements,
  bodyMeasurementRevisions,
  dailyPlanningReferences,
  meals,
  dietPlans,
  mealRevisions,
  mealContributions,
  mealContributionRevisions,
  nutritionDayStates,
  personalFoodTemplates,
  mealImageAnalyses,
  mealImageAnalysisAttempts,
};
