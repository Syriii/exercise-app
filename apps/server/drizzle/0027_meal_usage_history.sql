CREATE TABLE "meal_record_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "meal_record_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" uuid NOT NULL,
	"meal_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"before" jsonb,
	"after" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "temporary_media" ALTER COLUMN "expires_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "meal_image_analyses" ADD COLUMN "previous_analysis_id" uuid;--> statement-breakpoint
ALTER TABLE "meal_image_analysis_attempts" ADD COLUMN "evidence" jsonb;--> statement-breakpoint
ALTER TABLE "meal_record_events" ADD CONSTRAINT "meal_record_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_record_events" ADD CONSTRAINT "meal_record_events_meal_id_meals_id_fk" FOREIGN KEY ("meal_id") REFERENCES "public"."meals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meal_record_events_meal_idx" ON "meal_record_events" USING btree ("meal_id","id");--> statement-breakpoint
CREATE INDEX "meal_record_events_user_idx" ON "meal_record_events" USING btree ("user_id");
--> statement-breakpoint
ALTER TABLE "meal_record_events" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "meal_record_events_account" ON "meal_record_events" TO "exercise_api"
USING ("user_id" = "exercise_security"."current_user_id"())
WITH CHECK ("user_id" = "exercise_security"."current_user_id"() AND EXISTS (
  SELECT 1 FROM "meals" m WHERE m.id = meal_id AND m.user_id = "exercise_security"."current_user_id"()
));
GRANT SELECT, INSERT, DELETE ON "meal_record_events" TO "exercise_api";
GRANT USAGE, SELECT ON SEQUENCE "meal_record_events_id_seq" TO "exercise_api";
--> statement-breakpoint
-- Preserve only still-available meal photos. Never revive deleted/missing or deletion-pending media.
-- This metadata backfill requires explicit production approval; original bytes are not read.
UPDATE "temporary_media" media SET "expires_at" = NULL
WHERE media.status = 'available' AND EXISTS (
  SELECT 1 FROM meal_image_analyses a JOIN meals m ON m.id = a.meal_id
  WHERE a.media_id = media.id AND a.user_id = media.user_id AND m.deleted_at IS NULL
);
--> statement-breakpoint
-- Invoker rights: ownership/RLS is enforced for both the mutation and its history.
-- AFTER triggers participate in the business transaction, including rollback and retry deduplication.
-- Only successful persisted changes are recorded; no keystrokes, requests or credentials.
CREATE FUNCTION public.capture_meal_record_event() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  old_value jsonb;
  new_value jsonb;
  owner_id uuid;
  parent_id uuid;
  target record;
BEGIN
  new_value := to_jsonb(NEW) - 'user_id' - 'object_key';
  IF TG_OP = 'UPDATE' THEN
    old_value := to_jsonb(OLD) - 'user_id' - 'object_key';
    IF (new_value - 'updated_at') = (old_value - 'updated_at') THEN RETURN NEW; END IF;
  END IF;
  IF TG_TABLE_NAME = 'temporary_media' THEN
    FOR target IN SELECT DISTINCT a.user_id, a.meal_id FROM meal_image_analyses a WHERE a.media_id = NEW.id AND a.user_id = NEW.user_id LOOP
      INSERT INTO meal_record_events(user_id, meal_id, entity_type, entity_id, operation, "before", "after")
      VALUES(target.user_id, target.meal_id, TG_TABLE_NAME, NEW.id, lower(TG_OP), old_value, new_value);
    END LOOP;
    RETURN NEW;
  ELSIF TG_TABLE_NAME = 'meals' THEN
    owner_id := NEW.user_id; parent_id := NEW.id;
  ELSIF TG_TABLE_NAME = 'meal_image_analysis_attempts' THEN
    SELECT user_id, meal_id INTO owner_id, parent_id FROM meal_image_analyses WHERE id = NEW.analysis_id;
  ELSE
    parent_id := NEW.meal_id;
    SELECT user_id INTO owner_id FROM meals WHERE id = parent_id;
    IF TG_TABLE_NAME = 'meal_image_analyses' AND TG_OP = 'INSERT' THEN
      new_value := new_value || jsonb_build_object('media', (
        SELECT to_jsonb(m) - 'object_key' - 'user_id' FROM temporary_media m WHERE m.id = NEW.media_id AND m.user_id = owner_id
      ));
    END IF;
  END IF;
  INSERT INTO meal_record_events(user_id, meal_id, entity_type, entity_id, operation, "before", "after")
  VALUES(owner_id, parent_id, TG_TABLE_NAME, NEW.id, lower(TG_OP), old_value, new_value);
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.capture_meal_record_event() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.capture_meal_record_event() TO exercise_api;
--> statement-breakpoint
CREATE TRIGGER meal_record_capture AFTER INSERT OR UPDATE ON meals FOR EACH ROW EXECUTE FUNCTION public.capture_meal_record_event();
CREATE TRIGGER meal_contribution_capture AFTER INSERT OR UPDATE ON meal_contributions FOR EACH ROW EXECUTE FUNCTION public.capture_meal_record_event();
CREATE TRIGGER meal_analysis_capture AFTER INSERT OR UPDATE ON meal_image_analyses FOR EACH ROW EXECUTE FUNCTION public.capture_meal_record_event();
CREATE TRIGGER meal_attempt_capture AFTER INSERT OR UPDATE ON meal_image_analysis_attempts FOR EACH ROW EXECUTE FUNCTION public.capture_meal_record_event();
CREATE TRIGGER meal_media_capture AFTER UPDATE ON temporary_media FOR EACH ROW EXECUTE FUNCTION public.capture_meal_record_event();
