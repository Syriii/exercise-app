CREATE TYPE "public"."meal_contribution_review_status" AS ENUM('tentative', 'confirmed');--> statement-breakpoint
ALTER TABLE "meal_contribution_revisions" ADD COLUMN "review_status" "meal_contribution_review_status" DEFAULT 'confirmed' NOT NULL;--> statement-breakpoint
ALTER TABLE "meal_contributions" ADD COLUMN "review_status" "meal_contribution_review_status" DEFAULT 'confirmed' NOT NULL;