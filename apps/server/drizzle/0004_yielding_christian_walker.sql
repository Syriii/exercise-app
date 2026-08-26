CREATE TABLE "training_program_unit_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_id" uuid NOT NULL,
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
	CONSTRAINT "training_program_unit_items_name_not_blank_ck" CHECK (length(btrim("training_program_unit_items"."exercise_name")) > 0),
	CONSTRAINT "training_program_unit_items_order_nonnegative_ck" CHECK ("training_program_unit_items"."sort_order" >= 0),
	CONSTRAINT "training_program_unit_items_sets_positive_ck" CHECK ("training_program_unit_items"."target_sets" is null or "training_program_unit_items"."target_sets" > 0),
	CONSTRAINT "training_program_unit_items_reps_min_positive_ck" CHECK ("training_program_unit_items"."target_reps_min" is null or "training_program_unit_items"."target_reps_min" > 0),
	CONSTRAINT "training_program_unit_items_reps_max_valid_ck" CHECK ("training_program_unit_items"."target_reps_max" is null or ("training_program_unit_items"."target_reps_max" > 0 and ("training_program_unit_items"."target_reps_min" is null or "training_program_unit_items"."target_reps_max" >= "training_program_unit_items"."target_reps_min"))),
	CONSTRAINT "training_program_unit_items_weight_positive_ck" CHECK ("training_program_unit_items"."target_weight_kg" is null or "training_program_unit_items"."target_weight_kg" > 0),
	CONSTRAINT "training_program_unit_items_duration_positive_ck" CHECK ("training_program_unit_items"."target_duration_seconds" is null or "training_program_unit_items"."target_duration_seconds" > 0),
	CONSTRAINT "training_program_unit_items_distance_positive_ck" CHECK ("training_program_unit_items"."target_distance_meters" is null or "training_program_unit_items"."target_distance_meters" > 0)
);
--> statement-breakpoint
CREATE TABLE "training_program_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"source_template_id" uuid,
	"source_template_name" text,
	"source_template_revision" integer,
	"imported_at" timestamp with time zone,
	"week_number" integer NOT NULL,
	"sort_order" integer NOT NULL,
	"name" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_program_units_name_not_blank_ck" CHECK (length(btrim("training_program_units"."name")) > 0),
	CONSTRAINT "training_program_units_week_positive_ck" CHECK ("training_program_units"."week_number" > 0),
	CONSTRAINT "training_program_units_order_nonnegative_ck" CHECK ("training_program_units"."sort_order" >= 0),
	CONSTRAINT "training_program_units_source_revision_positive_ck" CHECK ("training_program_units"."source_template_revision" is null or "training_program_units"."source_template_revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "training_programs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"note" text,
	"week_count" integer NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_programs_name_not_blank_ck" CHECK (length(btrim("training_programs"."name")) > 0),
	CONSTRAINT "training_programs_week_count_positive_ck" CHECK ("training_programs"."week_count" > 0),
	CONSTRAINT "training_programs_revision_positive_ck" CHECK ("training_programs"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "training_sessions" ADD COLUMN "source_program_id" uuid;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD COLUMN "source_program_name" text;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD COLUMN "source_program_unit_id" uuid;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD COLUMN "source_week_number" integer;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD COLUMN "source_training_day_name" text;--> statement-breakpoint
ALTER TABLE "training_program_unit_items" ADD CONSTRAINT "training_program_unit_items_unit_id_training_program_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."training_program_units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_program_units" ADD CONSTRAINT "training_program_units_program_id_training_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."training_programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_program_units" ADD CONSTRAINT "training_program_units_source_template_id_training_templates_id_fk" FOREIGN KEY ("source_template_id") REFERENCES "public"."training_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_programs" ADD CONSTRAINT "training_programs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "training_program_unit_items_order_uq" ON "training_program_unit_items" USING btree ("unit_id","sort_order");--> statement-breakpoint
CREATE INDEX "training_program_unit_items_unit_idx" ON "training_program_unit_items" USING btree ("unit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "training_program_units_order_uq" ON "training_program_units" USING btree ("program_id","week_number","sort_order");--> statement-breakpoint
CREATE INDEX "training_program_units_program_idx" ON "training_program_units" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "training_program_units_source_template_idx" ON "training_program_units" USING btree ("source_template_id");--> statement-breakpoint
CREATE INDEX "training_programs_user_idx" ON "training_programs" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_source_program_id_training_programs_id_fk" FOREIGN KEY ("source_program_id") REFERENCES "public"."training_programs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_source_program_unit_id_training_program_units_id_fk" FOREIGN KEY ("source_program_unit_id") REFERENCES "public"."training_program_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "training_sessions_source_program_unit_idx" ON "training_sessions" USING btree ("source_program_unit_id");