# Grounding conversation and onboarding

**Status:** Implemented.

## Overview

New users must pass two gates before capture:

1. **Credits** — platform-credits users top up via PayPal (minimum balance for capture pipeline). BYOK users skip this gate (Settings → LLM → BYOK).
2. **Grounding** — required one-time chat at `/grounding` that persists `user_grounding_profile`.

Once `initial_completed_at` is set, grounding is never shown again. `/chat` is MCP-only.

BYOK credential forms are **not** shown in onboarding; they live under Settings → LLM → BYOK only.

## MCP tools

| Tool | Purpose |
|------|---------|
| `capture_grounding` | Incremental facet persistence during chat |
| `complete_grounding_session` | Mark session complete; sets `initial_completed_at` on first run |

Grounding chat exposes only these two tools via `/api/grounding/chat`.

## Data

- Table: `user_grounding_profile` (encrypted `narrative_summary`, JSON `facets`, session metadata)
- `chat_session.mode`: `default` | `grounding`
- Facet keys: `identity`, `work`, `values`, `relationships`, `psychology`, `routines`

**Single source of truth:** `user_grounding_profile.initial_completed_at`. All routes and APIs check this via `loadGroundingProfileRow` + `isInitialGroundingComplete`.

## Enrichment

`loadEnrichmentContext` loads grounding profile; `groundingProfilePromptBlock()` is injected first in:

- `resolveThoughtCategory`
- `extractEntityGraphBundle`
- `extractThoughtMetadata`

## Settings

`/settings/grounding` — view portrait, delete profile (deleting also removes grounding chat sessions). To re-run grounding, delete the profile first, then visit `/grounding`.
