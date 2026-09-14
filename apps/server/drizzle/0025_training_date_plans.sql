DROP INDEX "training_sessions_source_schedule_uq";--> statement-breakpoint
ALTER TABLE "training_schedules" ADD COLUMN "items" jsonb;--> statement-breakpoint
ALTER TABLE "training_schedules" ADD COLUMN "history" jsonb;--> statement-breakpoint
ALTER TABLE "training_session_items" ADD COLUMN "plan_link" jsonb;--> statement-breakpoint
CREATE INDEX "training_sessions_source_schedule_idx" ON "training_sessions" USING btree ("source_schedule_id");