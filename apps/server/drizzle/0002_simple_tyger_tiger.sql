CREATE TABLE "runtime_heartbeats" (
	"component" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
