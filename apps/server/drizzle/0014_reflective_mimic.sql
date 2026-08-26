CREATE TYPE "public"."training_suggestion_status" AS ENUM('active', 'adopted', 'dismissed');--> statement-breakpoint
CREATE TABLE "training_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "training_suggestion_status" DEFAULT 'active' NOT NULL,
	"method_version" text NOT NULL,
	"evidence_ids" jsonb NOT NULL,
	"input_snapshot" jsonb NOT NULL,
	"candidate" jsonb NOT NULL,
	"adopted_template_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	"adopted_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_suggestions_revision_positive_ck" CHECK ("training_suggestions"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "training_suggestions" ADD CONSTRAINT "training_suggestions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "training_suggestions_user_idx" ON "training_suggestions" USING btree ("user_id","created_at");
--> statement-breakpoint
ALTER TABLE "training_suggestions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "training_suggestions_account" ON "training_suggestions" TO "exercise_api" USING ("user_id" = "exercise_security"."current_user_id"()) WITH CHECK ("user_id" = "exercise_security"."current_user_id"());
