ALTER TABLE "training_session_revisions" ADD COLUMN "expenditure_assessment" jsonb;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD COLUMN "expenditure_assessment" jsonb;