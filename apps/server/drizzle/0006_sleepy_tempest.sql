CREATE TYPE "public"."training_reminder_day_status" AS ENUM('snoozed', 'dismissed');--> statement-breakpoint
CREATE TABLE "training_reminder_day_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"status" "training_reminder_day_status" NOT NULL,
	"snoozed_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_reminder_day_states_snooze_ck" CHECK ("training_reminder_day_states"."status" <> 'snoozed' or "training_reminder_day_states"."snoozed_until" is not null)
);
--> statement-breakpoint
CREATE TABLE "training_reminder_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"local_time" text DEFAULT '18:00' NOT NULL,
	"time_zone" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_reminder_rules_time_ck" CHECK ("training_reminder_rules"."local_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "training_reminder_rules_revision_positive_ck" CHECK ("training_reminder_rules"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "training_session_item_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"session_item_id" uuid NOT NULL,
	"session_revision" integer NOT NULL,
	"status" "training_session_item_status" NOT NULL,
	"performed_exercise_name" text,
	"actual_note" text,
	"sets_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_session_item_revisions_revision_positive_ck" CHECK ("training_session_item_revisions"."session_revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "training_session_items" ADD COLUMN "performed_exercise_name" text;--> statement-breakpoint
ALTER TABLE "training_reminder_day_states" ADD CONSTRAINT "training_reminder_day_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_reminder_rules" ADD CONSTRAINT "training_reminder_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_session_item_revisions" ADD CONSTRAINT "training_session_item_revisions_session_id_training_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."training_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_session_item_revisions" ADD CONSTRAINT "training_session_item_revisions_session_item_id_training_session_items_id_fk" FOREIGN KEY ("session_item_id") REFERENCES "public"."training_session_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "training_reminder_day_states_user_date_uq" ON "training_reminder_day_states" USING btree ("user_id","local_date");--> statement-breakpoint
CREATE UNIQUE INDEX "training_reminder_rules_user_uq" ON "training_reminder_rules" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "training_session_item_revisions_session_idx" ON "training_session_item_revisions" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "training_session_item_revisions_item_idx" ON "training_session_item_revisions" USING btree ("session_item_id","created_at");--> statement-breakpoint
ALTER TABLE "training_session_items" ADD CONSTRAINT "training_session_items_performed_name_not_blank_ck" CHECK ("training_session_items"."performed_exercise_name" is null or length(btrim("training_session_items"."performed_exercise_name")) > 0);