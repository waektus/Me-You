ALTER TABLE "quests" ADD COLUMN "sender_photo_url" text;--> statement-breakpoint
ALTER TABLE "quests" ADD COLUMN "sender_photo_submitted_at" timestamp;--> statement-breakpoint
ALTER TABLE "quests" ADD COLUMN "sender_photo_reason" text;--> statement-breakpoint
ALTER TABLE "quests" ADD COLUMN "receiver_photo_url" text;--> statement-breakpoint
ALTER TABLE "quests" ADD COLUMN "receiver_photo_submitted_at" timestamp;--> statement-breakpoint
ALTER TABLE "quests" ADD COLUMN "receiver_photo_reason" text;