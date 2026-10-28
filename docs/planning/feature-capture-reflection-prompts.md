# Feature: reflection prompts on Capture

Status: **implemented 2026-10-28** (board idea `609a4092`, approved 2026-10-28: "daily prompts in the
empty field"). Migration `drizzle/0084_capture_reflection_prompt.sql`.
Risk: **high** — new LLM call and new per-user table; it does not touch ingestion (a tapped
prompt is ordinary text in the writer and goes through the normal capture flow).

## 1. Problem

Capture opens on an empty field and one heading. Board: "I want the capture page to have
inspiring questions … that bring you to reflect on your day and current thoughts and
projects." Nothing on the page helps you start.

## 2. Goal

Once a day, Capture offers up to three short questions written from your own open projects
and recent thoughts. Tapping one puts it in the field so you answer it; the answer is a
normal capture.

## 3. Scope

**In scope**

- RP-1 **One LLM call per user per local day** (user timezone), billed to the user and listed
  in the usage log as `capture_reflection_prompts`. Input: the daily digest (projects with next
  action, stalled threads) and the 8 most recent capture snippets. Output JSON
  `{ "prompts": string[] }`, 1–3 items, each ≤ 120 characters, in the user's preferred
  language. Post-LLM code validates the schema only (zod) — it never rewrites or filters by
  meaning.
- RP-2 **Exactly 3 attempts**, then an explicit error (HTTP 502 with a plain message) shown in
  place of the prompts. Insufficient credits → 402 with the billing message. Never a default
  or canned question list.
- RP-3 **Nothing to reflect on → no call:** no projects, no stalled threads and no recent
  captures → `{ state: 'empty' }`, no LLM spend.
- RP-4 **Storage:** `capture_reflection_prompt (user_id, day, prompts_encrypted, created_at,
dismissed_at)`, primary key `(user_id, day)`. Prompts are derived from personal thoughts, so
  they are stored only encrypted (tenant envelope). RLS: owner only.
- RP-5 **Dismiss:** "Not today" hides them until the next local day (`dismissed_at`).
  A day dismissed before generation never generates.
- RP-6 **UI:** Capture fetches once on mount (`GET /api/capture/reflection-prompts`). Prompts
  show under the heading only while the page is at rest (no reading, nothing just kept, empty
  field). Tap → the question plus a line break goes in the field, focused. Offline → nothing is
  fetched or shown (the offline line already says the page is a stored copy).

**Out of scope**

- Push/email of prompts, more than one set per day, regenerate-on-demand, prompts on Ask,
  storing which prompt a capture answered.

## 4. Relation to grounding questions

Grounding questions (`grounding-question-policy.md`) fill blanks in the user profile and must
never "ask just to ask". Reflection prompts are a different surface: they invite a capture
about the user's own named projects and thoughts and are never written to
`user_grounding_profile`. The voice rule still holds: plain questions a friend would ask,
naming the concrete project or thought — no coaching-app voice ("What are your core values?").

## 5. Acceptance criteria

- **RP-AC1** Given a user with open projects or recent captures and no row for today, when
  Capture loads, then one LLM call writes 1–3 prompts, they are stored encrypted for today and
  shown under the heading.
- **RP-AC2** Given today's row exists, when Capture loads again, then the stored prompts are
  shown and no LLM call is made.
- **RP-AC3** Given the LLM returns invalid JSON three times, when Capture loads, then the
  response is 502 with a plain error, nothing is stored, and the page shows the error.
- **RP-AC4** Given no projects, stalled threads or recent captures, when Capture loads, then
  the state is `empty` and no LLM call is made.
- **RP-AC5** Given prompts are shown, when the user taps "Not today", then they disappear and
  stay hidden for the rest of the local day.
- **RP-AC6** Given prompts are shown, when the user taps one, then the field holds the question
  and a line break and has focus; the prompts hide.

## 6. Tests

Unit: `src/lib/server/capture/reflection-prompts.spec.ts` (messages, schema, attempts, states),
`src/routes/api/capture/reflection-prompts/server.spec.ts` (auth, status codes).
E2E: `src/routes/e2e/capture-reflection-prompts.e2e.ts` (RP-AC5, RP-AC6 with a stubbed
endpoint).
