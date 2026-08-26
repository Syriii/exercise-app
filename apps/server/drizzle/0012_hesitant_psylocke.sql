CREATE TABLE "maintenance_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"artifact_sha256" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_events_type_ck" CHECK ("maintenance_events"."type" in ('backup', 'restore_verification')),
	CONSTRAINT "maintenance_events_status_ck" CHECK ("maintenance_events"."status" in ('succeeded', 'failed'))
);
--> statement-breakpoint
CREATE INDEX "maintenance_events_type_completed_idx" ON "maintenance_events" USING btree ("type","completed_at");