# Future: MCP grounding tool

**Status:** Document only — not implemented in tiered ingest v1.

## Problem

Consolidation-derived context (communities, summaries) takes time to build and never captures explicit self-knowledge ("I work at X", "I care about Y", "I'm a parent") unless it appears in captured thoughts.

## Proposed MCP tool

`grounding` (or `capture_grounding`) — opt-in via MCP/agent when the user wants richer enrichment:

- System or agent asks structured questions: interests, work, roles, location, recurring themes, identity.
- Answers persist to a **user grounding profile** store (new table or extension of `user_ontology.profile`).
- `loadEnrichmentContext` merges grounding profile **first** — highest-priority lens for all enrich LLM calls.
- Complements (does not replace) ontology, entities, and community summaries.

## Guardrails

- No onboarding interview at first-use (existing product guardrail).
- Grounding is **opt-in** — never required for capture or retrieval.
- Grounding text follows tenant encryption and RLS like other user profile fields.

## Wiring (when implemented)

1. New persistence layer for grounding facts keyed by `user_id`.
2. Extend `EnrichmentContext` with `groundingProfile` slice.
3. Prompt blocks in classify, entity extract, metadata, relation extract prefer grounding excerpts when present.
4. MCP registry entry + `sanitizeMcpToolResult` on read/write tools.
