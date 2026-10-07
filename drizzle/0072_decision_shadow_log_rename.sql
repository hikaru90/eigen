-- Decision-model shadow provider swapped from Clef (Workers AI) to OpenRouter
-- Decisions API (e.g. typesafe/jev-1.13). Table was provider-neutral in name but
-- used clef_* columns; rename to decision_* before any rows exist.
ALTER TABLE "decision_shadow_log" RENAME COLUMN "clef_category" TO "decision_category";
--> statement-breakpoint
ALTER TABLE "decision_shadow_log" RENAME COLUMN "clef_probability" TO "decision_probability";
--> statement-breakpoint
ALTER TABLE "decision_shadow_log" RENAME COLUMN "clef_alternatives" TO "decision_alternatives";
--> statement-breakpoint
ALTER TABLE "decision_shadow_log" RENAME COLUMN "clef_error" TO "decision_error";
--> statement-breakpoint
ALTER TABLE "decision_shadow_log" RENAME COLUMN "clef_duration_ms" TO "decision_duration_ms";
