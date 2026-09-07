ALTER TABLE "meal_contribution_revisions" ADD COLUMN "food_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "meal_contributions" ADD COLUMN "food_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "personal_food_templates" ADD COLUMN "catalog_key" text;--> statement-breakpoint
ALTER TABLE "personal_food_templates" ADD COLUMN "catalog_metadata" jsonb;--> statement-breakpoint
ALTER TABLE "personal_food_templates" ADD COLUMN "is_favorite" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "personal_food_templates_catalog_key_uq" ON "personal_food_templates" USING btree ("user_id","catalog_key");