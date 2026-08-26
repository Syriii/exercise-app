CREATE TABLE "training_session_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"session_revision" integer NOT NULL,
	"local_date" date NOT NULL,
	"time_zone" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_session_revisions_revision_positive_ck" CHECK ("training_session_revisions"."session_revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "training_session_revisions" ADD CONSTRAINT "training_session_revisions_session_id_training_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."training_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "training_session_revisions_session_idx" ON "training_session_revisions" USING btree ("session_id","created_at");