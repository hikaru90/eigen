ALTER TABLE "user" ADD COLUMN "role" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_role_check" CHECK ("role" IN ('user', 'admin'));--> statement-breakpoint
UPDATE "user" SET "role" = 'admin' WHERE lower("email") = lower('alexbueckner@gmail.com');
