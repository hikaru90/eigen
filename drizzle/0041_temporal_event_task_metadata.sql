DO $$ BEGIN
 CREATE TYPE "public"."temporal_energy_level" AS ENUM('light', 'medium', 'deep');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."temporal_priority_quadrant" AS ENUM(
  'urgent_important',
  'not_urgent_important',
  'urgent_not_important',
  'neither'
 );
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "temporal_event" ADD COLUMN IF NOT EXISTS "duration_minutes" integer;
--> statement-breakpoint
ALTER TABLE "temporal_event" ADD COLUMN IF NOT EXISTS "energy_level" "temporal_energy_level";
--> statement-breakpoint
ALTER TABLE "temporal_event" ADD COLUMN IF NOT EXISTS "priority_quadrant" "temporal_priority_quadrant";
--> statement-breakpoint
ALTER TABLE "temporal_event" ADD COLUMN IF NOT EXISTS "context_tags" text[];
--> statement-breakpoint
ALTER TABLE "temporal_event" ADD COLUMN IF NOT EXISTS "parent_event_id" uuid;
--> statement-breakpoint
ALTER TABLE "temporal_event" ADD COLUMN IF NOT EXISTS "focus_rank" integer;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "temporal_event" ADD CONSTRAINT "temporal_event_parent_event_id_temporal_event_id_fk"
  FOREIGN KEY ("parent_event_id") REFERENCES "public"."temporal_event"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
