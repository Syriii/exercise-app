ALTER TABLE "training_session_revisions" ADD COLUMN "record_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD COLUMN "recorded_time" text;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD COLUMN "record_write" jsonb;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD COLUMN "deleted_at" timestamp with time zone;