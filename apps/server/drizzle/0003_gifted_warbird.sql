CREATE TYPE "public"."training_session_item_origin" AS ENUM('planned', 'extra');--> statement-breakpoint
CREATE TYPE "public"."training_session_item_status" AS ENUM('pending', 'completed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."training_session_status" AS ENUM('in_progress', 'completed', 'abandoned');--> statement-breakpoint
CREATE TABLE "training_session_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"source_template_item_id" uuid,
	"origin" "training_session_item_origin" NOT NULL,
	"status" "training_session_item_status" DEFAULT 'pending' NOT NULL,
	"sort_order" integer NOT NULL,
	"exercise_name" text NOT NULL,
	"target_sets" integer,
	"target_reps_min" integer,
	"target_reps_max" integer,
	"target_weight_kg" numeric(8, 3),
	"target_duration_seconds" integer,
	"target_distance_meters" numeric(12, 3),
	"target_note" text,
	"actual_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_session_items_name_not_blank_ck" CHECK (length(btrim("training_session_items"."exercise_name")) > 0),
	CONSTRAINT "training_session_items_order_nonnegative_ck" CHECK ("training_session_items"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "training_session_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_item_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"reps" integer,
	"weight_kg" numeric(8, 3),
	"duration_seconds" integer,
	"distance_meters" numeric(12, 3),
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_session_sets_sequence_positive_ck" CHECK ("training_session_sets"."sequence" > 0),
	CONSTRAINT "training_session_sets_reps_nonnegative_ck" CHECK ("training_session_sets"."reps" is null or "training_session_sets"."reps" >= 0),
	CONSTRAINT "training_session_sets_weight_nonnegative_ck" CHECK ("training_session_sets"."weight_kg" is null or "training_session_sets"."weight_kg" >= 0),
	CONSTRAINT "training_session_sets_duration_nonnegative_ck" CHECK ("training_session_sets"."duration_seconds" is null or "training_session_sets"."duration_seconds" >= 0),
	CONSTRAINT "training_session_sets_distance_nonnegative_ck" CHECK ("training_session_sets"."distance_meters" is null or "training_session_sets"."distance_meters" >= 0)
);
--> statement-breakpoint
CREATE TABLE "training_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_template_id" uuid,
	"source_template_name" text,
	"status" "training_session_status" DEFAULT 'in_progress' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"time_zone" text NOT NULL,
	"local_date" date NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_sessions_revision_positive_ck" CHECK ("training_sessions"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "training_template_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"sort_order" integer NOT NULL,
	"exercise_name" text NOT NULL,
	"target_sets" integer,
	"target_reps_min" integer,
	"target_reps_max" integer,
	"target_weight_kg" numeric(8, 3),
	"target_duration_seconds" integer,
	"target_distance_meters" numeric(12, 3),
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_template_items_name_not_blank_ck" CHECK (length(btrim("training_template_items"."exercise_name")) > 0),
	CONSTRAINT "training_template_items_order_nonnegative_ck" CHECK ("training_template_items"."sort_order" >= 0),
	CONSTRAINT "training_template_items_sets_positive_ck" CHECK ("training_template_items"."target_sets" is null or "training_template_items"."target_sets" > 0),
	CONSTRAINT "training_template_items_reps_min_positive_ck" CHECK ("training_template_items"."target_reps_min" is null or "training_template_items"."target_reps_min" > 0),
	CONSTRAINT "training_template_items_reps_max_valid_ck" CHECK ("training_template_items"."target_reps_max" is null or ("training_template_items"."target_reps_max" > 0 and ("training_template_items"."target_reps_min" is null or "training_template_items"."target_reps_max" >= "training_template_items"."target_reps_min"))),
	CONSTRAINT "training_template_items_weight_positive_ck" CHECK ("training_template_items"."target_weight_kg" is null or "training_template_items"."target_weight_kg" > 0),
	CONSTRAINT "training_template_items_duration_positive_ck" CHECK ("training_template_items"."target_duration_seconds" is null or "training_template_items"."target_duration_seconds" > 0),
	CONSTRAINT "training_template_items_distance_positive_ck" CHECK ("training_template_items"."target_distance_meters" is null or "training_template_items"."target_distance_meters" > 0)
);
--> statement-breakpoint
CREATE TABLE "training_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"note" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_templates_name_not_blank_ck" CHECK (length(btrim("training_templates"."name")) > 0),
	CONSTRAINT "training_templates_revision_positive_ck" CHECK ("training_templates"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "training_session_items" ADD CONSTRAINT "training_session_items_session_id_training_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."training_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_session_items" ADD CONSTRAINT "training_session_items_source_template_item_id_training_template_items_id_fk" FOREIGN KEY ("source_template_item_id") REFERENCES "public"."training_template_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_session_sets" ADD CONSTRAINT "training_session_sets_session_item_id_training_session_items_id_fk" FOREIGN KEY ("session_item_id") REFERENCES "public"."training_session_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_source_template_id_training_templates_id_fk" FOREIGN KEY ("source_template_id") REFERENCES "public"."training_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_template_items" ADD CONSTRAINT "training_template_items_template_id_training_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."training_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_templates" ADD CONSTRAINT "training_templates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "training_session_items_order_uq" ON "training_session_items" USING btree ("session_id","sort_order");--> statement-breakpoint
CREATE INDEX "training_session_items_session_idx" ON "training_session_items" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "training_session_sets_sequence_uq" ON "training_session_sets" USING btree ("session_item_id","sequence");--> statement-breakpoint
CREATE INDEX "training_session_sets_item_idx" ON "training_session_sets" USING btree ("session_item_id");--> statement-breakpoint
CREATE INDEX "training_sessions_user_date_idx" ON "training_sessions" USING btree ("user_id","local_date");--> statement-breakpoint
CREATE INDEX "training_sessions_user_status_idx" ON "training_sessions" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "training_template_items_order_uq" ON "training_template_items" USING btree ("template_id","sort_order");--> statement-breakpoint
CREATE INDEX "training_template_items_template_idx" ON "training_template_items" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "training_templates_user_idx" ON "training_templates" USING btree ("user_id");