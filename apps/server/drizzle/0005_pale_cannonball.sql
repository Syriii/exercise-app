CREATE TABLE "training_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"time_zone" text NOT NULL,
	"title" text NOT NULL,
	"note" text,
	"source_template_id" uuid,
	"source_template_name" text,
	"source_program_id" uuid,
	"source_program_name" text,
	"source_program_unit_id" uuid,
	"source_week_number" integer,
	"source_training_day_name" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_schedules_title_not_blank_ck" CHECK (length(btrim("training_schedules"."title")) > 0),
	CONSTRAINT "training_schedules_revision_positive_ck" CHECK ("training_schedules"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "training_sessions" ADD COLUMN "source_schedule_id" uuid;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD COLUMN "source_schedule_title" text;--> statement-breakpoint
ALTER TABLE "training_schedules" ADD CONSTRAINT "training_schedules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_schedules" ADD CONSTRAINT "training_schedules_source_template_id_training_templates_id_fk" FOREIGN KEY ("source_template_id") REFERENCES "public"."training_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_schedules" ADD CONSTRAINT "training_schedules_source_program_id_training_programs_id_fk" FOREIGN KEY ("source_program_id") REFERENCES "public"."training_programs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_schedules" ADD CONSTRAINT "training_schedules_source_program_unit_id_training_program_units_id_fk" FOREIGN KEY ("source_program_unit_id") REFERENCES "public"."training_program_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "training_schedules_user_date_idx" ON "training_schedules" USING btree ("user_id","local_date");--> statement-breakpoint
CREATE INDEX "training_schedules_source_template_idx" ON "training_schedules" USING btree ("source_template_id");--> statement-breakpoint
CREATE INDEX "training_schedules_source_unit_idx" ON "training_schedules" USING btree ("source_program_unit_id");--> statement-breakpoint
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_source_schedule_id_training_schedules_id_fk" FOREIGN KEY ("source_schedule_id") REFERENCES "public"."training_schedules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "training_sessions_source_schedule_uq" ON "training_sessions" USING btree ("source_schedule_id");