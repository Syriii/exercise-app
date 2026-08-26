CREATE SCHEMA IF NOT EXISTS "exercise_security";
REVOKE ALL ON SCHEMA "exercise_security" FROM PUBLIC;
GRANT USAGE ON SCHEMA "exercise_security" TO "exercise_api";
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "exercise_security"."current_user_id"()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting('exercise.user_id', true), '')::uuid
$$;
REVOKE ALL ON FUNCTION "exercise_security"."current_user_id"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "exercise_security"."current_user_id"() TO "exercise_api";
--> statement-breakpoint
ALTER TABLE "training_templates" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "training_templates_account" ON "training_templates" TO "exercise_api" USING ("user_id" = "exercise_security"."current_user_id"()) WITH CHECK ("user_id" = "exercise_security"."current_user_id"());
ALTER TABLE "training_programs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "training_programs_account" ON "training_programs" TO "exercise_api" USING ("user_id" = "exercise_security"."current_user_id"()) WITH CHECK ("user_id" = "exercise_security"."current_user_id"());
ALTER TABLE "training_schedules" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "training_schedules_account" ON "training_schedules" TO "exercise_api" USING ("user_id" = "exercise_security"."current_user_id"()) WITH CHECK ("user_id" = "exercise_security"."current_user_id"());
ALTER TABLE "training_sessions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "training_sessions_account" ON "training_sessions" TO "exercise_api" USING ("user_id" = "exercise_security"."current_user_id"()) WITH CHECK ("user_id" = "exercise_security"."current_user_id"());
ALTER TABLE "training_reminder_rules" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "training_reminder_rules_account" ON "training_reminder_rules" TO "exercise_api" USING ("user_id" = "exercise_security"."current_user_id"()) WITH CHECK ("user_id" = "exercise_security"."current_user_id"());
ALTER TABLE "training_reminder_day_states" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "training_reminder_day_states_account" ON "training_reminder_day_states" TO "exercise_api" USING ("user_id" = "exercise_security"."current_user_id"()) WITH CHECK ("user_id" = "exercise_security"."current_user_id"());
ALTER TABLE "nutrition_reminder_rules" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "nutrition_reminder_rules_account" ON "nutrition_reminder_rules" TO "exercise_api" USING ("user_id" = "exercise_security"."current_user_id"()) WITH CHECK ("user_id" = "exercise_security"."current_user_id"());
ALTER TABLE "nutrition_reminder_day_states" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "nutrition_reminder_day_states_account" ON "nutrition_reminder_day_states" TO "exercise_api" USING ("user_id" = "exercise_security"."current_user_id"()) WITH CHECK ("user_id" = "exercise_security"."current_user_id"());
ALTER TABLE "measurement_reminder_rules" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "measurement_reminder_rules_account" ON "measurement_reminder_rules" TO "exercise_api" USING ("user_id" = "exercise_security"."current_user_id"()) WITH CHECK ("user_id" = "exercise_security"."current_user_id"());
ALTER TABLE "measurement_reminder_day_states" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "measurement_reminder_day_states_account" ON "measurement_reminder_day_states" TO "exercise_api" USING ("user_id" = "exercise_security"."current_user_id"()) WITH CHECK ("user_id" = "exercise_security"."current_user_id"());
ALTER TABLE "personal_profiles" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "personal_profiles_account" ON "personal_profiles" TO "exercise_api" USING ("user_id" = "exercise_security"."current_user_id"()) WITH CHECK ("user_id" = "exercise_security"."current_user_id"());
ALTER TABLE "goal_strategies" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "goal_strategies_account" ON "goal_strategies" TO "exercise_api" USING ("user_id" = "exercise_security"."current_user_id"()) WITH CHECK ("user_id" = "exercise_security"."current_user_id"());
ALTER TABLE "body_measurements" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "body_measurements_account" ON "body_measurements" TO "exercise_api" USING ("user_id" = "exercise_security"."current_user_id"()) WITH CHECK ("user_id" = "exercise_security"."current_user_id"());
ALTER TABLE "daily_planning_references" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "daily_planning_references_account" ON "daily_planning_references" TO "exercise_api" USING ("user_id" = "exercise_security"."current_user_id"()) WITH CHECK ("user_id" = "exercise_security"."current_user_id"());
ALTER TABLE "meals" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "meals_account" ON "meals" TO "exercise_api" USING ("user_id" = "exercise_security"."current_user_id"()) WITH CHECK ("user_id" = "exercise_security"."current_user_id"());
ALTER TABLE "nutrition_day_states" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "nutrition_day_states_account" ON "nutrition_day_states" TO "exercise_api" USING ("user_id" = "exercise_security"."current_user_id"()) WITH CHECK ("user_id" = "exercise_security"."current_user_id"());
ALTER TABLE "personal_food_templates" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "personal_food_templates_account" ON "personal_food_templates" TO "exercise_api" USING ("user_id" = "exercise_security"."current_user_id"()) WITH CHECK ("user_id" = "exercise_security"."current_user_id"());
ALTER TABLE "meal_image_analyses" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "meal_image_analyses_account" ON "meal_image_analyses" TO "exercise_api" USING ("user_id" = "exercise_security"."current_user_id"()) WITH CHECK ("user_id" = "exercise_security"."current_user_id"());
--> statement-breakpoint
ALTER TABLE "training_template_items" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "training_template_items_account" ON "training_template_items" TO "exercise_api" USING (EXISTS (SELECT 1 FROM "training_templates" parent WHERE parent."id" = "template_id" AND parent."user_id" = "exercise_security"."current_user_id"())) WITH CHECK (EXISTS (SELECT 1 FROM "training_templates" parent WHERE parent."id" = "template_id" AND parent."user_id" = "exercise_security"."current_user_id"()));
ALTER TABLE "training_program_units" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "training_program_units_account" ON "training_program_units" TO "exercise_api" USING (EXISTS (SELECT 1 FROM "training_programs" parent WHERE parent."id" = "program_id" AND parent."user_id" = "exercise_security"."current_user_id"())) WITH CHECK (EXISTS (SELECT 1 FROM "training_programs" parent WHERE parent."id" = "program_id" AND parent."user_id" = "exercise_security"."current_user_id"()));
ALTER TABLE "training_program_unit_items" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "training_program_unit_items_account" ON "training_program_unit_items" TO "exercise_api" USING (EXISTS (SELECT 1 FROM "training_program_units" unit JOIN "training_programs" parent ON parent."id" = unit."program_id" WHERE unit."id" = "unit_id" AND parent."user_id" = "exercise_security"."current_user_id"())) WITH CHECK (EXISTS (SELECT 1 FROM "training_program_units" unit JOIN "training_programs" parent ON parent."id" = unit."program_id" WHERE unit."id" = "unit_id" AND parent."user_id" = "exercise_security"."current_user_id"()));
ALTER TABLE "training_session_items" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "training_session_items_account" ON "training_session_items" TO "exercise_api" USING (EXISTS (SELECT 1 FROM "training_sessions" parent WHERE parent."id" = "session_id" AND parent."user_id" = "exercise_security"."current_user_id"())) WITH CHECK (EXISTS (SELECT 1 FROM "training_sessions" parent WHERE parent."id" = "session_id" AND parent."user_id" = "exercise_security"."current_user_id"()));
ALTER TABLE "training_session_sets" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "training_session_sets_account" ON "training_session_sets" TO "exercise_api" USING (EXISTS (SELECT 1 FROM "training_session_items" item JOIN "training_sessions" parent ON parent."id" = item."session_id" WHERE item."id" = "session_item_id" AND parent."user_id" = "exercise_security"."current_user_id"())) WITH CHECK (EXISTS (SELECT 1 FROM "training_session_items" item JOIN "training_sessions" parent ON parent."id" = item."session_id" WHERE item."id" = "session_item_id" AND parent."user_id" = "exercise_security"."current_user_id"()));
ALTER TABLE "training_session_item_revisions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "training_session_item_revisions_account" ON "training_session_item_revisions" TO "exercise_api" USING (EXISTS (SELECT 1 FROM "training_session_items" item JOIN "training_sessions" parent ON parent."id" = item."session_id" WHERE item."id" = "session_item_id" AND parent."user_id" = "exercise_security"."current_user_id"())) WITH CHECK (EXISTS (SELECT 1 FROM "training_session_items" item JOIN "training_sessions" parent ON parent."id" = item."session_id" WHERE item."id" = "session_item_id" AND parent."user_id" = "exercise_security"."current_user_id"()));
ALTER TABLE "training_session_revisions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "training_session_revisions_account" ON "training_session_revisions" TO "exercise_api" USING (EXISTS (SELECT 1 FROM "training_sessions" parent WHERE parent."id" = "session_id" AND parent."user_id" = "exercise_security"."current_user_id"())) WITH CHECK (EXISTS (SELECT 1 FROM "training_sessions" parent WHERE parent."id" = "session_id" AND parent."user_id" = "exercise_security"."current_user_id"()));
ALTER TABLE "body_measurement_revisions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "body_measurement_revisions_account" ON "body_measurement_revisions" TO "exercise_api" USING (EXISTS (SELECT 1 FROM "body_measurements" parent WHERE parent."id" = "measurement_id" AND parent."user_id" = "exercise_security"."current_user_id"())) WITH CHECK (EXISTS (SELECT 1 FROM "body_measurements" parent WHERE parent."id" = "measurement_id" AND parent."user_id" = "exercise_security"."current_user_id"()));
ALTER TABLE "meal_revisions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "meal_revisions_account" ON "meal_revisions" TO "exercise_api" USING (EXISTS (SELECT 1 FROM "meals" parent WHERE parent."id" = "meal_id" AND parent."user_id" = "exercise_security"."current_user_id"())) WITH CHECK (EXISTS (SELECT 1 FROM "meals" parent WHERE parent."id" = "meal_id" AND parent."user_id" = "exercise_security"."current_user_id"()));
ALTER TABLE "meal_contributions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "meal_contributions_account" ON "meal_contributions" TO "exercise_api" USING (EXISTS (SELECT 1 FROM "meals" parent WHERE parent."id" = "meal_id" AND parent."user_id" = "exercise_security"."current_user_id"())) WITH CHECK (EXISTS (SELECT 1 FROM "meals" parent WHERE parent."id" = "meal_id" AND parent."user_id" = "exercise_security"."current_user_id"()));
ALTER TABLE "meal_contribution_revisions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "meal_contribution_revisions_account" ON "meal_contribution_revisions" TO "exercise_api" USING (EXISTS (SELECT 1 FROM "meal_contributions" item JOIN "meals" parent ON parent."id" = item."meal_id" WHERE item."id" = "contribution_id" AND parent."user_id" = "exercise_security"."current_user_id"())) WITH CHECK (EXISTS (SELECT 1 FROM "meal_contributions" item JOIN "meals" parent ON parent."id" = item."meal_id" WHERE item."id" = "contribution_id" AND parent."user_id" = "exercise_security"."current_user_id"()));
ALTER TABLE "meal_image_analysis_attempts" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "meal_image_analysis_attempts_account" ON "meal_image_analysis_attempts" TO "exercise_api" USING (EXISTS (SELECT 1 FROM "meal_image_analyses" parent WHERE parent."id" = "analysis_id" AND parent."user_id" = "exercise_security"."current_user_id"())) WITH CHECK (EXISTS (SELECT 1 FROM "meal_image_analyses" parent WHERE parent."id" = "analysis_id" AND parent."user_id" = "exercise_security"."current_user_id"()));
