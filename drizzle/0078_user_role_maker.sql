-- `maker`: Contribute board over MCP (list/share/vote/forget) without /admin access.
ALTER TABLE "user" DROP CONSTRAINT IF EXISTS "user_role_check";--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_role_check" CHECK ("role" IN ('user', 'maker', 'admin'));
