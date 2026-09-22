CREATE TYPE "quest_mode" AS ENUM('solo', 'couple');--> statement-breakpoint
ALTER TABLE "quests" ADD COLUMN "quest_mode" "quest_mode" DEFAULT 'solo'::"quest_mode" NOT NULL;--> statement-breakpoint
ALTER TABLE "quests" ADD COLUMN "sender_completed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "quests" ADD COLUMN "receiver_completed" boolean DEFAULT false NOT NULL;