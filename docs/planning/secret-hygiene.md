# Secret hygiene in capture: credentials never become memory

Status: **approved by the operator 2026-10-25** (plan; implementation by subagent).
Risk: **critical** (ingestion path, security baseline).

## Evidence

PersonaMem dev-set run 2026-10-25 (`evals/reports/public/personamem-v2/deepseek-v4.1-flash-1017-2026-10-25T22-34-41-694Z`):
a user turn pasting a `.env` was stored **verbatim as a thought**
(`DATABASE_URL=postgres://user:password@localhost:5432/mydb LLM_API_KEY=sk-Y29v… PORT=3000`);
enrichment turned `LLM_API_KEY`, `DATABASE_URL` and the connection string into graph entities,
embedded them, and wrote the recall cue "What is my DATABASE_URL set to?". The text also went to
the LLM gateway (Jev, content split, enrichment). Existing redaction
(`src/lib/server/observability/redact-for-log.ts`) only covers object keys in logs, not free text.

## Requirement

A credential the user pastes (API key, token, password, private key, connection string with a
password) is never: sent to an LLM or embedding call, stored in a derived text surface
(`normalized_text`, `lexical_text`, note passages, recall cues, ask question), turned into a graph
entity, or returned by MCP/Ask tools. The user's verbatim original is kept only in `raw_text`
(encrypted at rest, the AGENTS.md verbatim invariant) and the note body the user saved, both
user-visible and never indexed or sent to an LLM unredacted.

Out of scope: deciding whether non-credential personal data is "sensitive" (that is meaning —
LLM territory, separate decision); scrubbing data already stored (script provided, not run).

## Design

1. **Detector** `src/lib/server/security/detect-secrets.ts` — pure, format-based redaction
   (explicitly allowed by AGENTS.md: "Allowed without LLM: … redaction"):
   - provider key formats (e.g. `sk-…`, `sk-ant-…`, `ghp_/gho_/github_pat_…`, `xox[abp]-…`,
     `AKIA…`, `AIza…`, `glpat-…`), JWTs, PEM private-key blocks, URLs with `user:password@`;
   - `NAME=value` / `NAME: value` / JSON `"name": "value"` where NAME is a credential name — reuse
     and export the name rules from `redact-for-log.ts` (one source of truth).
   - Output: redacted text with placeholders that keep the non-secret name, e.g.
     `LLM_API_KEY=[redacted secret]`, plus the list of findings (kind, name, span) — never the value.
   - No entropy-only guessing (hashes and ids would false-positive).
2. **One canonical text at the boundary.** At every capture entry (UI capture/interpret,
   `queueCapture`, MCP `capture_thought`, text-file create/update/append) compute the redacted
   text once. Everything downstream (interpret, Jev content_role, content split spans, enrichment,
   embeddings, lexical, cues, note passages) uses the redacted text. `raw_text` keeps the original.
   Enumerate every place that reads `rawText`/note body for an LLM or index and switch it.
3. **Gateway guard (defence in depth).** `llmChatCompletion` and the embedding client run the
   detector over outgoing content; any finding is redacted and logged as a security warning with
   the call site (no value). A test asserts the capture path never trips it (the boundary already
   redacted).
4. **User feedback.** Capture response/metadata records `secretsRedacted: [{kind, name}]` so the
   UI/MCP can say "API key not stored in memory". (UI copy follows the existing i18n pattern; a
   small notice is enough.)
5. **Existing data.** `scripts/scrub-stored-secrets.ts`: dry-run by default, re-derives
   `normalized_text`/lexical/embeddings/passages and drops secret-derived graph entities for
   thoughts/notes whose text has findings. Not run by the agent.

## Acceptance (Given/When/Then)

- Given the `.env` capture above, when captured, then `normalized_text`, lexical text, cues, note
  passages and graph entities contain no `sk-…` value and no `user:password@`, and the LLM/embedding
  payloads captured in the test contain only placeholders; `raw_text` still equals the input.
- Given "my GitHub token is ghp_…, use it for the deploy", when captured, then the thought reads
  "my GitHub token is [redacted secret], use it for the deploy" downstream and the fact that a
  GitHub token exists may be remembered, never its value.
- Given ordinary text with ids/hashes ("commit 9f3a2c1", "order #A12B"), when captured, then nothing
  is redacted (false-positive guard).
- Given an MCP `retrieve_thoughts`/`answer_question` on that tenant, then no tool result contains a
  secret value.

## Tests first

Detector table tests (each format + negatives), boundary tests per entry point with a spy LLM and
embedding client, gateway-guard test, Phase-A span test (spans cut from redacted text), note
passages built from redacted text, MCP result scan, scrub script dry-run on fixtures.
