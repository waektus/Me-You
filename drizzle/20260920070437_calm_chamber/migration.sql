ALTER TABLE "quests" ADD COLUMN "require_photo_reason" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "quests" ADD COLUMN "photo_reason" text;