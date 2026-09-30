CREATE TABLE "artworks" (
	"id" serial PRIMARY KEY,
	"title" varchar(100) NOT NULL,
	"description" text,
	"image_url" text NOT NULL,
	"storage_path" text NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "songs" (
	"id" serial PRIMARY KEY,
	"title" varchar(120) NOT NULL,
	"artist" varchar(120) NOT NULL,
	"url" text NOT NULL,
	"cover_url" text,
	"message" text,
	"user_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artworks" ADD CONSTRAINT "artworks_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "songs" ADD CONSTRAINT "songs_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id");