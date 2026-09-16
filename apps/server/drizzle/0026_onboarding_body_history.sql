ALTER TABLE "body_measurements" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "personal_profiles" ADD COLUMN "setup_progress" jsonb;