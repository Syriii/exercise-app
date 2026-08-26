CREATE TABLE "diet_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"date_from" date NOT NULL,
	"date_to" date NOT NULL,
	"title" text NOT NULL,
	"note" text,
	"entries" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diet_plans_date_range_ck" CHECK ("diet_plans"."date_to" >= "diet_plans"."date_from"),
	CONSTRAINT "diet_plans_title_not_blank_ck" CHECK (length(btrim("diet_plans"."title")) > 0),
	CONSTRAINT "diet_plans_revision_positive_ck" CHECK ("diet_plans"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "diet_plans" ADD CONSTRAINT "diet_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "diet_plans_user_dates_idx" ON "diet_plans" USING btree ("user_id","date_from","date_to");--> statement-breakpoint
ALTER TABLE "diet_plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "diet_plans_account" ON "diet_plans" TO "exercise_api" USING ("user_id" = "exercise_security"."current_user_id"()) WITH CHECK ("user_id" = "exercise_security"."current_user_id"());
