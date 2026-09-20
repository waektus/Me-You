CREATE TABLE "reward_redemptions" (
	"id" serial PRIMARY KEY,
	"user_id" integer NOT NULL,
	"reward" varchar(200) NOT NULL,
	"cost" integer DEFAULT 30 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reward_redemptions" ADD CONSTRAINT "reward_redemptions_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id");