CREATE TYPE "public"."meal_contribution_source" AS ENUM('manual', 'model_adopted');--> statement-breakpoint
CREATE TYPE "public"."meal_image_analysis_status" AS ENUM('pending', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "meal_image_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"meal_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"status" "meal_image_analysis_status" DEFAULT 'pending' NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"raw_candidate" jsonb,
	"uncertainty_note" text,
	"last_error_code" text,
	"adopted_at" timestamp with time zone,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meal_image_analyses_model_not_blank_ck" CHECK (length(btrim("meal_image_analyses"."model")) > 0),
	CONSTRAINT "meal_image_analyses_prompt_not_blank_ck" CHECK (length(btrim("meal_image_analyses"."prompt_version")) > 0),
	CONSTRAINT "meal_image_analyses_revision_positive_ck" CHECK ("meal_image_analyses"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "meal_image_analysis_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"status" "task_attempt_status" DEFAULT 'running' NOT NULL,
	"provider_request_id" text,
	"error_code" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "meal_image_analysis_attempts_sequence_positive_ck" CHECK ("meal_image_analysis_attempts"."sequence" > 0)
);
--> statement-breakpoint
ALTER TABLE "meal_contribution_revisions" ADD COLUMN "source" "meal_contribution_source" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "meal_contribution_revisions" ADD COLUMN "source_analysis_id" uuid;--> statement-breakpoint
ALTER TABLE "meal_contributions" ADD COLUMN "source" "meal_contribution_source" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "meal_contributions" ADD COLUMN "source_analysis_id" uuid;--> statement-breakpoint
ALTER TABLE "meal_image_analyses" ADD CONSTRAINT "meal_image_analyses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_image_analyses" ADD CONSTRAINT "meal_image_analyses_meal_id_meals_id_fk" FOREIGN KEY ("meal_id") REFERENCES "public"."meals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_image_analyses" ADD CONSTRAINT "meal_image_analyses_media_id_temporary_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."temporary_media"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_image_analysis_attempts" ADD CONSTRAINT "meal_image_analysis_attempts_analysis_id_meal_image_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."meal_image_analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meal_image_analyses_user_meal_idx" ON "meal_image_analyses" USING btree ("user_id","meal_id");--> statement-breakpoint
CREATE INDEX "meal_image_analyses_status_idx" ON "meal_image_analyses" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "meal_image_analysis_attempts_sequence_uq" ON "meal_image_analysis_attempts" USING btree ("analysis_id","sequence");--> statement-breakpoint
CREATE INDEX "meal_image_analysis_attempts_analysis_idx" ON "meal_image_analysis_attempts" USING btree ("analysis_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meal_contributions_source_analysis_uq" ON "meal_contributions" USING btree ("source_analysis_id") WHERE "meal_contributions"."source_analysis_id" is not null;