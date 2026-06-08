# Grounding conversation and onboarding

**Status:** Implemented.

## Overview

New users must pass two gates before capture:

1. **Credits** — platform-credits users top up via PayPal (minimum balance for capture pipeline). BYOK users skip this gate (Settings → LLM → BYOK).
2. **Grounding** — required chat at `/chat?mode=grounding` that persists `user_grounding_profile`.

BYOK credential forms are **not** shown in onboarding; they live under Settings → LLM → BYOK only.

## MCP tools

| Tool | Purpose |
|------|---------|
| `capture_grounding` | Incremental facet persistence during chat |
| `complete_grounding_session` | Mark session complete; sets `initial_completed_at` on first run |

Grounding chat mode exposes only these two tools.

## Data

- Table: `user_grounding_profile` (encrypted `narrative_summary`, JSON `facets`, session metadata)
- `chat_session.mode`: `default` | `grounding`
- Facet keys: `identity`, `work`, `values`, `relationships`, `psychology`, `routines`

## Enrichment

`loadEnrichmentContext` loads grounding profile; `groundingProfilePromptBlock()` is injected first in:

- `resolveThoughtCategory`
- `extractEntityGraphBundle`
- `extractThoughtMetadata`

## Periodic refresh

After initial completion, capture shows a dismissible nudge when:

- `last_session_at` is older than 90 days, or
- thought count is a positive multiple of 100

CTA: `/chat?mode=grounding&refresh=1`

## Settings

`/settings/grounding` — view portrait, update via chat, delete profile.
