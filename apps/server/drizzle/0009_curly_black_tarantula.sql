CREATE TYPE "public"."meal_contribution_mode" AS ENUM('item', 'whole_meal', 'supplement');--> statement-breakpoint
CREATE TABLE "meal_contribution_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contribution_id" uuid NOT NULL,
	"contribution_revision" integer NOT NULL,
	"mode" "meal_contribution_mode" NOT NULL,
	"label" text NOT NULL,
	"portion_amount" numeric(12, 3),
	"portion_unit" text,
	"basis_description" text,
	"energy_kcal" numeric(12, 3),
	"protein_grams" numeric(12, 3),
	"carbohydrate_grams" numeric(12, 3),
	"fat_grams" numeric(12, 3),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meal_contribution_revisions_revision_positive_ck" CHECK ("meal_contribution_revisions"."contribution_revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "meal_contributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meal_id" uuid NOT NULL,
	"mode" "meal_contribution_mode" NOT NULL,
	"label" text NOT NULL,
	"portion_amount" numeric(12, 3),
	"portion_unit" text,
	"basis_description" text,
	"energy_kcal" numeric(12, 3),
	"protein_grams" numeric(12, 3),
	"carbohydrate_grams" numeric(12, 3),
	"fat_grams" numeric(12, 3),
	"revision" integer DEFAULT 1 NOT NULL,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meal_contributions_label_not_blank_ck" CHECK (length(btrim("meal_contributions"."label")) > 0),
	CONSTRAINT "meal_contributions_portion_nonnegative_ck" CHECK ("meal_contributions"."portion_amount" is null or "meal_contributions"."portion_amount" >= 0),
	CONSTRAINT "meal_contributions_energy_nonnegative_ck" CHECK ("meal_contributions"."energy_kcal" is null or "meal_contributions"."energy_kcal" >= 0),
	CONSTRAINT "meal_contributions_protein_nonnegative_ck" CHECK ("meal_contributions"."protein_grams" is null or "meal_contributions"."protein_grams" >= 0),
	CONSTRAINT "meal_contributions_carbohydrate_nonnegative_ck" CHECK ("meal_contributions"."carbohydrate_grams" is null or "meal_contributions"."carbohydrate_grams" >= 0),
	CONSTRAINT "meal_contributions_fat_nonnegative_ck" CHECK ("meal_contributions"."fat_grams" is null or "meal_contributions"."fat_grams" >= 0),
	CONSTRAINT "meal_contributions_any_nutrient_ck" CHECK ("meal_contributions"."energy_kcal" is not null or "meal_contributions"."protein_grams" is not null or "meal_contributions"."carbohydrate_grams" is not null or "meal_contributions"."fat_grams" is not null),
	CONSTRAINT "meal_contributions_revision_positive_ck" CHECK ("meal_contributions"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "meal_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meal_id" uuid NOT NULL,
	"meal_revision" integer NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"local_date" date NOT NULL,
	"time_zone" text NOT NULL,
	"name" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meal_revisions_revision_positive_ck" CHECK ("meal_revisions"."meal_revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "meals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"local_date" date NOT NULL,
	"time_zone" text NOT NULL,
	"name" text,
	"note" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meals_revision_positive_ck" CHECK ("meals"."revision" > 0),
	CONSTRAINT "meals_name_not_blank_ck" CHECK ("meals"."name" is null or length(btrim("meals"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "nutrition_day_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"coverage_confirmed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personal_food_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"label" text NOT NULL,
	"portion_amount" numeric(12, 3),
	"portion_unit" text,
	"basis_description" text,
	"energy_kcal" numeric(12, 3),
	"protein_grams" numeric(12, 3),
	"carbohydrate_grams" numeric(12, 3),
	"fat_grams" numeric(12, 3),
	"revision" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "personal_food_templates_label_not_blank_ck" CHECK (length(btrim("personal_food_templates"."label")) > 0),
	CONSTRAINT "personal_food_templates_portion_nonnegative_ck" CHECK ("personal_food_templates"."portion_amount" is null or "personal_food_templates"."portion_amount" >= 0),
	CONSTRAINT "personal_food_templates_energy_nonnegative_ck" CHECK ("personal_food_templates"."energy_kcal" is null or "personal_food_templates"."energy_kcal" >= 0),
	CONSTRAINT "personal_food_templates_protein_nonnegative_ck" CHECK ("personal_food_templates"."protein_grams" is null or "personal_food_templates"."protein_grams" >= 0),
	CONSTRAINT "personal_food_templates_carbohydrate_nonnegative_ck" CHECK ("personal_food_templates"."carbohydrate_grams" is null or "personal_food_templates"."carbohydrate_grams" >= 0),
	CONSTRAINT "personal_food_templates_fat_nonnegative_ck" CHECK ("personal_food_templates"."fat_grams" is null or "personal_food_templates"."fat_grams" >= 0),
	CONSTRAINT "personal_food_templates_any_nutrient_ck" CHECK ("personal_food_templates"."energy_kcal" is not null or "personal_food_templates"."protein_grams" is not null or "personal_food_templates"."carbohydrate_grams" is not null or "personal_food_templates"."fat_grams" is not null),
	CONSTRAINT "personal_food_templates_revision_positive_ck" CHECK ("personal_food_templates"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "meal_contribution_revisions" ADD CONSTRAINT "meal_contribution_revisions_contribution_id_meal_contributions_id_fk" FOREIGN KEY ("contribution_id") REFERENCES "public"."meal_contributions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_contributions" ADD CONSTRAINT "meal_contributions_meal_id_meals_id_fk" FOREIGN KEY ("meal_id") REFERENCES "public"."meals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_revisions" ADD CONSTRAINT "meal_revisions_meal_id_meals_id_fk" FOREIGN KEY ("meal_id") REFERENCES "public"."meals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meals" ADD CONSTRAINT "meals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_day_states" ADD CONSTRAINT "nutrition_day_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_food_templates" ADD CONSTRAINT "personal_food_templates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meal_contribution_revisions_contribution_idx" ON "meal_contribution_revisions" USING btree ("contribution_id","created_at");--> statement-breakpoint
CREATE INDEX "meal_contributions_meal_idx" ON "meal_contributions" USING btree ("meal_id");--> statement-breakpoint
CREATE INDEX "meal_revisions_meal_idx" ON "meal_revisions" USING btree ("meal_id","created_at");--> statement-breakpoint
CREATE INDEX "meals_user_date_idx" ON "meals" USING btree ("user_id","local_date");--> statement-breakpoint
CREATE UNIQUE INDEX "nutrition_day_states_user_date_uq" ON "nutrition_day_states" USING btree ("user_id","local_date");--> statement-breakpoint
CREATE INDEX "personal_food_templates_user_idx" ON "personal_food_templates" USING btree ("user_id");