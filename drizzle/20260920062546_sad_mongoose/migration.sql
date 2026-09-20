CREATE TYPE "quest_type" AS ENUM('normal', 'photo');--> statement-breakpoint
ALTER TABLE "quests" ADD COLUMN "quest_type" "quest_type" DEFAULT 'normal'::"quest_type" NOT NULL;--> statement-breakpoint
ALTER TABLE "quests" ADD COLUMN "photo_url" text;--> statement-breakpoint
ALTER TABLE "quests" ADD COLUMN "photo_submitted_at" timestamp;