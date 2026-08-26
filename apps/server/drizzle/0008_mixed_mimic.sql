CREATE TYPE "public"."planning_macro_preference" AS ENUM('balanced', 'high_protein', 'lower_fat');--> statement-breakpoint
CREATE TYPE "public"."planning_pal_category" AS ENUM('inactive', 'low_active', 'active', 'very_active');--> statement-breakpoint
CREATE TYPE "public"."planning_sex_category" AS ENUM('male', 'female');--> statement-breakpoint
CREATE TYPE "public"."planning_weight_strategy" AS ENUM('maintain', 'lose', 'gain');--> statement-breakpoint
CREATE TABLE "body_measurement_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"measurement_id" uuid NOT NULL,
	"measurement_revision" integer NOT NULL,
	"measured_at" timestamp with time zone NOT NULL,
	"local_date" date NOT NULL,
	"time_zone" text NOT NULL,
	"weight_kg" numeric(6, 2) NOT NULL,
	"waist_cm" numeric(6, 2),
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "body_measurement_revisions_revision_positive_ck" CHECK ("body_measurement_revisions"."measurement_revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "body_measurements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"measured_at" timestamp with time zone NOT NULL,
	"local_date" date NOT NULL,
	"time_zone" text NOT NULL,
	"weight_kg" numeric(6, 2) NOT NULL,
	"waist_cm" numeric(6, 2),
	"note" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "body_measurements_weight_ck" CHECK ("body_measurements"."weight_kg" >= 20 and "body_measurements"."weight_kg" <= 400),
	CONSTRAINT "body_measurements_waist_ck" CHECK ("body_measurements"."waist_cm" is null or ("body_measurements"."waist_cm" >= 30 and "body_measurements"."waist_cm" <= 300)),
	CONSTRAINT "body_measurements_revision_positive_ck" CHECK ("body_measurements"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "daily_planning_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"revision" integer NOT NULL,
	"method_version" text NOT NULL,
	"evidence_ids" jsonb NOT NULL,
	"input_snapshot" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_planning_references_revision_positive_ck" CHECK ("daily_planning_references"."revision" > 0),
	CONSTRAINT "daily_planning_references_method_not_blank_ck" CHECK (length(btrim("daily_planning_references"."method_version")) > 0)
);
--> statement-breakpoint
CREATE TABLE "goal_strategies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"weight_strategy" "planning_weight_strategy" DEFAULT 'maintain' NOT NULL,
	"macro_preference" "planning_macro_preference" DEFAULT 'balanced' NOT NULL,
	"regular_exercise" boolean DEFAULT false NOT NULL,
	"training_intent" text,
	"target_weight_kg" numeric(6, 2),
	"target_date" date,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goal_strategies_target_weight_ck" CHECK ("goal_strategies"."target_weight_kg" is null or ("goal_strategies"."target_weight_kg" >= 20 and "goal_strategies"."target_weight_kg" <= 400)),
	CONSTRAINT "goal_strategies_lower_fat_ck" CHECK ("goal_strategies"."macro_preference" <> 'lower_fat' or "goal_strategies"."weight_strategy" = 'lose'),
	CONSTRAINT "goal_strategies_revision_positive_ck" CHECK ("goal_strategies"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "personal_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"birth_date" date,
	"sex_category" "planning_sex_category",
	"height_cm" numeric(6, 2),
	"pregnant_or_breastfeeding" boolean DEFAULT false NOT NULL,
	"medical_nutrition_condition" boolean DEFAULT false NOT NULL,
	"special_body_composition" boolean DEFAULT false NOT NULL,
	"pal_category" "planning_pal_category",
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "personal_profiles_height_ck" CHECK ("personal_profiles"."height_cm" is null or ("personal_profiles"."height_cm" >= 80 and "personal_profiles"."height_cm" <= 250)),
	CONSTRAINT "personal_profiles_revision_positive_ck" CHECK ("personal_profiles"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "body_measurement_revisions" ADD CONSTRAINT "body_measurement_revisions_measurement_id_body_measurements_id_fk" FOREIGN KEY ("measurement_id") REFERENCES "public"."body_measurements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "body_measurements" ADD CONSTRAINT "body_measurements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_planning_references" ADD CONSTRAINT "daily_planning_references_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_strategies" ADD CONSTRAINT "goal_strategies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_profiles" ADD CONSTRAINT "personal_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "body_measurement_revisions_measurement_idx" ON "body_measurement_revisions" USING btree ("measurement_id","created_at");--> statement-breakpoint
CREATE INDEX "body_measurements_user_date_idx" ON "body_measurements" USING btree ("user_id","local_date");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_planning_references_user_date_revision_uq" ON "daily_planning_references" USING btree ("user_id","local_date","revision");--> statement-breakpoint
CREATE INDEX "daily_planning_references_user_date_idx" ON "daily_planning_references" USING btree ("user_id","local_date");--> statement-breakpoint
CREATE UNIQUE INDEX "goal_strategies_user_uq" ON "goal_strategies" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "personal_profiles_user_uq" ON "personal_profiles" USING btree ("user_id");