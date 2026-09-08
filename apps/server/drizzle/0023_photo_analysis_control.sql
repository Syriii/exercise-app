ALTER TYPE "public"."meal_image_analysis_status" ADD VALUE 'waiting';--> statement-breakpoint
ALTER TABLE "meal_image_analyses" ADD COLUMN "replacement_state" jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "photo_analysis_automatic" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "photo_analysis_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "photo_analysis_settings_revision" integer DEFAULT 1 NOT NULL;