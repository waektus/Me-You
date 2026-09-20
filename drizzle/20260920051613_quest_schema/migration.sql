DO $$ BEGIN
  CREATE TYPE "quest_status" AS ENUM('pending', 'review', 'completed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "verify_type" AS ENUM('review', 'instant');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" serial PRIMARY KEY,
	"name" varchar(50) NOT NULL,
	"stars" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "stars" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "created_at" timestamp DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "name" TYPE varchar(50);
--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "age";
--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "email";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "quests" (
	"id" serial PRIMARY KEY,
	"title" varchar(60) NOT NULL,
	"description" text,
	"due" date NOT NULL,
	"points" integer DEFAULT 1 NOT NULL,
	"verify_type" "verify_type" DEFAULT 'review'::"verify_type" NOT NULL,
	"status" "quest_status" DEFAULT 'pending'::"quest_status" NOT NULL,
	"sender_id" integer NOT NULL,
	"receiver_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "quests" ADD CONSTRAINT "quests_sender_id_users_id_fkey"
    FOREIGN KEY ("sender_id") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "quests" ADD CONSTRAINT "quests_receiver_id_users_id_fkey"
    FOREIGN KEY ("receiver_id") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
