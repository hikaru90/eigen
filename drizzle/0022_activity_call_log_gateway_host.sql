-- Migration: 0022_activity_call_log_gateway_host
-- Stores LLM gateway hostname for activity transparency (provider-agnostic UI).

--> statement-breakpoint

ALTER TABLE "activity_call_log" ADD COLUMN IF NOT EXISTS "gateway_host" text;
