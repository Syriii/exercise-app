import { eq, sql } from "drizzle-orm";

import type { Database } from "../../db/database.js";
import { users } from "../../db/schema/index.js";
import type { UserDataExporter } from "./repository.js";
import type { UserExportEnvelope } from "./types.js";

export const userExportRootTables = [
  "background_tasks",
  "body_measurements",
  "daily_planning_references",
  "diet_plans",
  "goal_strategies",
  "meal_image_analyses",
  "meals",
  "nutrition_day_states",
  "nutrition_reminder_day_states",
  "nutrition_reminder_rules",
  "measurement_reminder_day_states",
  "measurement_reminder_rules",
  "personal_food_templates",
  "personal_profiles",
  "training_programs",
  "training_reminder_day_states",
  "training_reminder_rules",
  "training_schedules",
  "training_sessions",
  "training_suggestions",
  "training_templates",
] as const;

const childQueries = {
  background_task_attempts: "select to_jsonb(child) as value from background_task_attempts child inner join background_tasks parent on parent.id = child.task_id where parent.user_id =",
  body_measurement_revisions: "select to_jsonb(child) as value from body_measurement_revisions child inner join body_measurements parent on parent.id = child.measurement_id where parent.user_id =",
  meal_revisions: "select to_jsonb(child) as value from meal_revisions child inner join meals parent on parent.id = child.meal_id where parent.user_id =",
  meal_contributions: "select to_jsonb(child) as value from meal_contributions child inner join meals parent on parent.id = child.meal_id where parent.user_id =",
  meal_contribution_revisions: "select to_jsonb(child) as value from meal_contribution_revisions child inner join meal_contributions contribution on contribution.id = child.contribution_id inner join meals parent on parent.id = contribution.meal_id where parent.user_id =",
  meal_image_analysis_attempts: "select to_jsonb(child) as value from meal_image_analysis_attempts child inner join meal_image_analyses parent on parent.id = child.analysis_id where parent.user_id =",
  training_template_items: "select to_jsonb(child) as value from training_template_items child inner join training_templates parent on parent.id = child.template_id where parent.user_id =",
  training_program_units: "select to_jsonb(child) as value from training_program_units child inner join training_programs parent on parent.id = child.program_id where parent.user_id =",
  training_program_unit_items: "select to_jsonb(child) as value from training_program_unit_items child inner join training_program_units unit on unit.id = child.unit_id inner join training_programs parent on parent.id = unit.program_id where parent.user_id =",
  training_session_items: "select to_jsonb(child) as value from training_session_items child inner join training_sessions parent on parent.id = child.session_id where parent.user_id =",
  training_session_sets: "select to_jsonb(child) as value from training_session_sets child inner join training_session_items item on item.id = child.session_item_id inner join training_sessions parent on parent.id = item.session_id where parent.user_id =",
  training_session_revisions: "select to_jsonb(child) as value from training_session_revisions child inner join training_sessions parent on parent.id = child.session_id where parent.user_id =",
  training_session_item_revisions: "select to_jsonb(child) as value from training_session_item_revisions child inner join training_session_items item on item.id = child.session_item_id inner join training_sessions parent on parent.id = item.session_id where parent.user_id =",
} as const;

export class PostgresUserDataExporter implements UserDataExporter {
  public constructor(private readonly database: Database) {}

  public async exportUserData(userId: string, exportedAt: Date): Promise<UserExportEnvelope> {
    const [account] = await this.database.select({ id: users.id, username: users.username, role: users.role, status: users.status, passwordChangeRequired: users.passwordChangeRequired, createdAt: users.createdAt, updatedAt: users.updatedAt }).from(users).where(eq(users.id, userId)).limit(1);
    if (account === undefined) throw new Error("export_account_not_found");
    const data: Record<string, readonly unknown[]> = {};
    for (const table of userExportRootTables) {
      const result = await this.database.execute<{ value: unknown }>(sql`select (to_jsonb(record) - 'user_id' - 'object_key') as value from ${sql.raw(`"${table}"`)} record where record.user_id = ${userId} order by record.created_at nulls last`);
      data[table] = result.rows.map((row) => row.value);
    }
    for (const [name, query] of Object.entries(childQueries)) {
      const result = await this.database.execute<{ value: unknown }>(sql`${sql.raw(query)} ${userId}`);
      data[name] = result.rows.map((row) => row.value);
    }
    const mediaResult = await this.database.execute<{ value: unknown }>(sql`select (to_jsonb(record) - 'user_id' - 'object_key') as value from temporary_media record where record.user_id = ${userId} order by record.created_at`);
    return {
      schemaVersion: "exercise-app-user-export-v1",
      exportedAt: exportedAt.toISOString(),
      account,
      data,
      lifecycle: { includesOriginalPhotos: false, excludesCredentialsAndSessions: true, temporaryMedia: mediaResult.rows.map((row) => row.value) },
    };
  }
}
