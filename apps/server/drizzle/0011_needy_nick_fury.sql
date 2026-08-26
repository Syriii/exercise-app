CREATE TABLE "measurement_reminder_day_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"status" "training_reminder_day_status" NOT NULL,
	"snoozed_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "measurement_reminder_day_states_snooze_ck" CHECK ("measurement_reminder_day_states"."status" <> 'snoozed' or "measurement_reminder_day_states"."snoozed_until" is not null)
);
--> statement-breakpoint
CREATE TABLE "measurement_reminder_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"interval_days" integer DEFAULT 7 NOT NULL,
	"local_time" text DEFAULT '09:00' NOT NULL,
	"time_zone" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "measurement_reminder_rules_interval_ck" CHECK ("measurement_reminder_rules"."interval_days" between 1 and 365),
	CONSTRAINT "measurement_reminder_rules_time_ck" CHECK ("measurement_reminder_rules"."local_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "measurement_reminder_rules_revision_positive_ck" CHECK ("measurement_reminder_rules"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "nutrition_reminder_day_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"status" "training_reminder_day_status" NOT NULL,
	"snoozed_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nutrition_reminder_day_states_snooze_ck" CHECK ("nutrition_reminder_day_states"."status" <> 'snoozed' or "nutrition_reminder_day_states"."snoozed_until" is not null)
);
--> statement-breakpoint
CREATE TABLE "nutrition_reminder_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"local_time" text DEFAULT '20:00' NOT NULL,
	"time_zone" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nutrition_reminder_rules_time_ck" CHECK ("nutrition_reminder_rules"."local_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "nutrition_reminder_rules_revision_positive_ck" CHECK ("nutrition_reminder_rules"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "measurement_reminder_day_states" ADD CONSTRAINT "measurement_reminder_day_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_reminder_rules" ADD CONSTRAINT "measurement_reminder_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_reminder_day_states" ADD CONSTRAINT "nutrition_reminder_day_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_reminder_rules" ADD CONSTRAINT "nutrition_reminder_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "measurement_reminder_day_states_user_date_uq" ON "measurement_reminder_day_states" USING btree ("user_id","local_date");--> statement-breakpoint
CREATE UNIQUE INDEX "measurement_reminder_rules_user_uq" ON "measurement_reminder_rules" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "nutrition_reminder_day_states_user_date_uq" ON "nutrition_reminder_day_states" USING btree ("user_id","local_date");--> statement-breakpoint
CREATE UNIQUE INDEX "nutrition_reminder_rules_user_uq" ON "nutrition_reminder_rules" USING btree ("user_id");