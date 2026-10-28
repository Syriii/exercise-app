ALTER TABLE "meal_contribution_revisions" ADD COLUMN "intake_evidence" jsonb;--> statement-breakpoint
ALTER TABLE "meal_contributions" ADD COLUMN "intake_evidence" jsonb;--> statement-breakpoint
ALTER TABLE "meal_image_analyses" ADD COLUMN "input_context" jsonb;