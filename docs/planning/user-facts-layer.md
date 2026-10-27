# "What Eigen knows about you": user facts + community profiles

> Parked on branch `benchmark-work` (2026-10-27): not on main.

Status: **decisions Q1–Q4 answered by the operator 2026-10-26**; ready to build F1. Nothing is built yet. Risk: **critical**
(ingestion, retrieval and consolidation are critical-path domains). Every change must improve Eigen
for real users; PersonaMem is the measuring stick, not the target.

## Problem (evidence)

PersonaMem `val-full-2-4omini` (10 unseen val personas, 40 questions): 25 misses, by cause:

| Cause | Misses | Example |
| --- | --- | --- |
| Forget request ignored | 7 | being fixed by S2b (`docs/planning/personamem-score-plan.md`) |
| Evidence retrieved, no conclusion drawn | 8 | "swims at the local pool" in context; generic gym/walk option picked |
| Evidence not retrieved | 5 | mild myopia never surfaced for "tips against eye strain" |
| Someone else's preference used as the user's | 3 | "my friend Mia … drinks too little" → "since you carry a water bottle" |
| Sensitive identifier used in an answer | 2 | licence plate put into advice |

Eigen stores what the user said; every answer must re-infer the preference from 15–20 loose
memories (often implicit, sometimes about someone else). The PersonaMem paper's best system (55%)
keeps a compact memory of distilled user facts instead.

Graph communities are not that layer today: the report prompt forbids biographical facts
(`src/lib/server/consolidation/community-summaries.ts:180`), `composeAnswer` treats them as
"routing hints only — NOT evidence" (`src/lib/server/qa/compose-answer.ts:377`), they are built
only by nightly consolidation, and benchmark tenants have 0 of them.

## Design: two levels

### Level 1 — user facts at capture (source of truth)

A **fact** is a short statement about one person, derived by an LLM from a capture:
`subject` · `statement` · `kind` · `confidence` · `inferred` · `as of` · provenance.

- **Subject attribution.** `subject` is the user, or a named/described other person ("Mia
  (friend)", "colleague Laura"), linked to the person entity in the graph when one exists. A fact
  about someone else is never presented as the user's.
- **Kinds:** preference, dislike, habit, activity, health/medical, circumstance (job, place,
  household), relationship, plan/goal, constraint, trait. (Ontology-style catalog in the prompt;
  the LLM picks, code validates.)
- **What feeds extraction.** Every capture, including the reference part of mixed/reference
  captures, **but the extractor may only state facts about people** — what the text reveals about
  the user or a person in their life. A pasted recipe yields nothing (unless the user writes "I'm
  baking this for Mom's 70th, she can't have nuts"); an email the user wrote ("an early morning out
  on the waves before the keynote") yields a fact about the user. Document topics never become
  facts, and neither does trivia: only **personally relevant** facts (what would change how Eigen
  should treat or advise this person). (Q1: approved.)
- **Inferred facts.** Implicit evidence is the norm (PersonaMem, and real life). The extractor may
  infer ("out on the waves" → "surfs"), marked `inferred: true` with a confidence; facts below a
  confidence gate (0.7) are not stored. (Q2: approved.)
- **Identifiers go to secure storage (Q3).** Personal identifiers (email, phone, postal address,
  licence plate, account/ID/policy numbers, dates of birth) are stored as facts whose **value lives
  in a secure store**: new table `user_secure_value` (tenant-encrypted value, `kind`, `label`, RLS,
  never embedded, never lexical-indexed, never in logs/activity/tool results). The fact statement
  holds only a reference — "licence plate: [secure value]" — linked by `secure_value_id`; that is
  what retrieval indexes and what any LLM sees. When the user asks for the value ("what's my
  licence plate?"), the answer model emits the reference token and the server substitutes the
  value in the user-facing response only (Ask, MCP), after generation — the LLM never sees it.
  Advice answers never include identifiers unless asked. Credentials (API keys, passwords,
  tokens) keep the existing rule from `secret-hygiene.md`: never memory, original only in
  `raw_text`.
  The extractor detects identifiers by meaning (LLM), not patterns; the existing secret redaction
  still runs first.
- **Reconciliation (updates).** Extraction sees the existing active facts about the same subjects
  (retrieved by meaning) and returns operations per fact: `add` · `update` (supersedes an existing
  fact: "no longer drinks coffee") · `confirm` · `none`. Superseded facts are kept with
  `superseded_by` (history questions can still see them); answers use active facts. PersonaMem's
  `updated` preferences (≈21%) test exactly this.
- **Storage.** New table `user_fact` (migration `0085` + journal): id, user_id, subject_kind
  (user|person), subject_label, subject_entity_id?, statement (encrypted like thought text),
  lexical_text + tsvector, embedding vector(1536), kind, confidence, inferred, status
  (active|superseded|forgotten), superseded_by?, as_of (the source capture's time),
  created/updated. Link table `user_fact_source` (fact → thought / text_file) for provenance. RLS by
  user_id like `thought`. Embeddings DB-only.
- **When.** One extra json-mode LLM call per capture in enrichment (after content role/split, on the
  redacted text), evict-on-reject, cost logged. Order-faithful like the rest of ingest.
- **Edit / forget integration.** Editing or archiving a source thought re-derives or retires its
  facts. Forget (S2b) treats facts as hits: `remove_all` → `forgotten`, `remove_detail` → rewritten
  statement. A forgotten fact is gone from retrieval immediately.

### Level 2 — community profiles (summary on top)

- The nightly consolidation keeps building communities. Each community report gains a **profile**:
  the active facts whose sources are members of that community, summarised by theme ("Health: mild
  myopia, occasional tension headaches"), each line carrying the fact ids it summarises. The
  prompt's "no biographical facts" rule changes to "summarise only the listed facts; never add
  any".
- **Forget/update freshness.** When a fact is forgotten or superseded, the affected community
  profiles are regenerated right away (not at the next nightly run), so a forgotten detail never
  lingers in a summary.
- Communities still route overview questions; the profile lines are citable only through their
  fact ids.

### Answering

- Facts join the shared retrieval (`retrieveAnswerEvidence`, used by `composeAnswer`/Ask/MCP and
  forget): hybrid vector + lexical search over active facts, alongside thoughts and note passages.
  For advice questions (S3 `personalization`), the relevant community profiles are added as
  routing context and their facts pulled in.
- The answer prompt gets a "Known facts" section (subject, statement, as-of, inferred marker,
  citable `[id=…]`) and two rules: facts about other people are not the user's; never put personal
  identifiers into an answer unless the user asks for them (the 2 sensitive-info misses).
- MCP tool results expose facts like thoughts (never embeddings; secure values only as references).
- **No facts page (Q4).** "What do you know about me?" (Ask or MCP) is answered from the active
  facts and community profiles, grouped by theme and person, with citations; corrections go
  through normal capture/edit and "forget …". No dedicated UI.

### Benchmark harness

- After a tenant's ingest, run consolidation once (community detection + summaries/profiles),
  checkpointed in the durable ingest progress so a resume doesn't repeat it. Real users get nightly
  consolidation; leaving it out understates Eigen.
- New metric: *fact hit* — the chooser context contains a fact derived from the question's
  evidence turn.

## Requirements and acceptance (Given/When/Then)

In scope: user_fact storage + extraction + reconciliation + subject attribution; retrieval and
answer use; edit/forget integration; community profiles; benchmark consolidation step.
Out of scope: facts UI (Q4), grounding-profile merge, LongMemEval/LoCoMo changes, stemming.

- Given a capture "I swam at the local pool again this morning", when enriched, then an active
  fact (subject user, kind activity, "swims at the local pool") exists with that thought as source.
- Given "My friend Mia keeps getting headaches, she barely drinks water", then the facts have
  subject "Mia (friend)" and none is attributed to the user.
- Given a pasted recipe with no personal text, then no fact is created.
- Given "I quit coffee last month" after an earlier "I drink three coffees a day", then the old
  fact is superseded and the new one is active.
- Given "please forget that I drink coffee", then matching facts become forgotten and no answer
  uses them; affected community profiles are regenerated immediately.
- Given a capture containing a licence plate or email address, then a fact references a
  `user_secure_value` holding it; no fact statement, embedding, index, log or LLM payload contains
  the value; "what's my licence plate?" returns it (server-side substitution); an advice answer
  never includes it.
- Given "what do you know about me?", then the answer lists active facts by theme/person with
  citations (identifier values only as references unless asked).
- Given an advice question ("tips against eye strain"), when the user has the fact "mild myopia",
  then that fact is in the answer context.
- Given a fact question unrelated to facts, then retrieval and answer behave as today (no extra
  LLM call beyond extraction at capture).

## Phases (each: tests first, review, commit; subagents build)

- **F1 — facts at capture:** schema/migration, extraction + reconciliation + attribution, gates,
  edit/forget hooks. Unit tests with fake LLMs for every acceptance case above.
- **F2 — facts in answers:** shared retrieval, answer prompt section + the two rules, MCP exposure.
- **F3 — community profiles:** prompt change, fact-linked profiles, immediate refresh on
  forget/supersede, use for advice questions.
- **F4 — harness:** consolidation after ingest (checkpointed), fact-hit metric, dry-run cost.

Measurement: F1+F2 first on the 60-question evidence-only dev set (≈ $0.50), then a fresh
full-history ingest of `val-full-2` (10 personas, deepseek ≈ $4.5, gpt-4o-mini ≈ $4.5), compared
against `val-full-2-deepseek-s2b` and `val-full-2-4omini`. Extraction adds one call per capture
(estimate +15–25% ingest cost; measured in the dev run).

## Decisions (operator, 2026-10-26)

- **Q1** Facts may come from reference material too — only personally relevant facts about people,
  never document topics or trivia. **Approved.**
- **Q2** Inferred facts allowed (marked inferred, confidence ≥ 0.7). **Approved.**
- **Q3** Personal identifiers are stored securely (`user_secure_value`) and facts link to them;
  values never reach an LLM, an index or a log, and are substituted server-side only when the user
  asks. **Approved (changed from "never facts").**
- **Q4** No facts page; "what do you know about me?" is answered in Ask/MCP. **Approved.**
