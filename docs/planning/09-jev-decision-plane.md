# Jev decision plane — every bounded decision in ingest and chat (spec, pre-implementation)

**Status:** Draft for operator approval (DoR stage — no implementation before sign-off).
**Risk classification:** `critical` (ingestion + retrieval routing are critical-path domains per [03-guardrails](./03-guardrails-quality-gates.md)).
**Related:** [decision-client.ts](../../src/lib/server/llm/decision-client.ts) · [decision-plane.ts](../../src/lib/server/llm/decision-plane.ts) · [capture-ingest-llm-overhead.md](./capture-ingest-llm-overhead.md) · [ingest-retrieval-timing.md](./ingest-retrieval-timing.md) · [single-thought-type-axis.md](./single-thought-type-axis.md) · [classify-query-intent.ts](../../src/lib/server/retrieval/classify-query-intent.ts)

---

## 1. Problem and opportunity

Eigen's ingest and retrieval pipelines are chains of **LLM-as-judge decisions** (no string heuristics, per policy). Today every one of those decisions is made by an expensive general-purpose chat model (qwen, ~0.7–30s per call), while exactly **one** decision — thought category — is also being shadowed by the OpenRouter **decision model** (`typesafe/jev-1.13` via the Decisions API), which returns bounded choices with **calibrated probability distributions** in ~0.5s at ~$0.000014/call.

That first shadow comparison already showed the shape of the opportunity: identical choice (`task`), wildly different confidence (qwen 95%, Jev 51% with spread across decision/observation/memory).

**Goal:** extend the decision-model shadow to **every bounded decision** in ingest and chat, collect agreement + calibration evidence per decision kind, and only then — per kind, with explicit operator approval — promote any of them from shadow to authoritative. Jev becomes the *decision plane* of the app; qwen remains the *generation plane* (interpret, extract, compose).

**Non-goals (this spec):**

- No behavior change to capture, enrich, retrieval, or chat in phases S1–S3. Shadow only.
- No reintroduction of a second type axis. `memoryType` was deliberately deleted ([single-thought-type-axis](./single-thought-type-axis.md)); "memory vs todo" is the existing `category` axis + per-kind `never_stale` data. This spec must not recreate the two-classifier collision that decision fixed.
- Embeddings are **not** a decision — Jev's Decisions API cannot produce vectors. Embedding generation stays on the embedding gateway ([embeddings-db-only-boundary](./embeddings-db-only-boundary.md) unaffected).
- No free-form text generation via Jev (interpreted text, cues, entity surface names, summaries, answers stay on the chat judge).

---

## 2. Design rule: decision shape decides the engine

Every ingest/chat step is sorted by its **decision shape**:

| Shape | Engine | Examples |
|---|---|---|
| **Bounded choice over a closed set** | **Jev** (Decisions API: `choice` + `probabilities` + `confidence`) | category, entity type, relation type, scope, temporal kind, split role, provenance style, salience band, promote/demote |
| **Structured free-form extraction** | Chat judge (qwen, JSON schema) | interpretedText, cues[], entity surface names, relation endpoints, timeWindow ISO values |
| **Numeric vector** | Embedding gateway | thought/entity/query embeddings |
| **Structural metadata** | No model — deterministic | entry channel, billing mode, queue status, surface |

Rule of thumb: **if the answer is a key from a catalog, it is a Jev question. If the answer is new text, it is not.**

The Decisions API accepts a **map of questions per request**, so one Jev call can carry the entire bounded question set for one ingest (or one chat turn) — cost stays ~flat regardless of question count.

---

## 3. Ingest decision inventory (tier 1–3)

"LLM today" = which call currently owns the decision. "Phase" = rollout phase (§6).

| # | Parameter (user's list mapped) | Decision | Closed set | LLM today | Jev? | Phase |
|---|---|---|---|---|---|---|
| 1 | **Category** ("category", "memory?") | thought_category kind | 10 seeded kinds, per-user ontology | enrich bundle chat (qwen) | **already shadowed** ✓ | S0 (done) |
| 2 | **Content split** | `thought_only` vs `split` (role-based, not length) | 2 (+ optional target note role) | `resolveCaptureContentSplit` chat | yes — role is bounded | S1 |
| 3 | **Ontology entity type** ("ontology") | entity_type per mention | person, place, organization, project, technology, event, concept, artifact | entity bundle chat | yes — per-mention choice (state = mention + context) | S1 |
| 4 | **Entity resolution** ("connections") | new canonical entity vs merge into existing candidate | `create` / top-k candidate ids | key/alias/embedding heuristic + LLM fallback | partial — bounded *choice among candidates* is Jev-shaped; candidate *generation* stays embedding/SQL | S2 |
| 5 | **Relation type** ("connections") | relation type for a candidate pair | mentions, depends_on, refines, contradicts, related_to, follows_from, continuation_of, caused_by | relation classify chat (deferred path) | yes — pair + 8-way choice | S2 |
| 6 | **Temporal kind** | none / ordering / multi_ordering / duration / count / lookback / span / absolute | 8 + none | enrich bundle / temporal chat | yes | S2 |
| 7 | **Durability** ("memory?") | `never_stale` is **per-kind ontology data, not classified** — deliberately | — | none (seeded) | **none — keep structural** | — |
| 8 | **Open loop / actionable** ("todo?") | is this a live commitment vs mention of one | actionable / mentioned / closed | implicit in category `task` | yes as **refinement** question, not a second type axis | S2 |
| 9 | **Salience band** ("salience") | high / medium / low prior salience | 3 | none (computed decay + boosts) | yes — as a *prior signal* consumed by consolidation alongside the deterministic math | S2 |
| 10 | **Provenance style** ("human/bot") | does the text read human-captured vs agent-generated | human / agent / mixed | none | yes — complements the **structural** `capture_session.author` axis (webhook/MCP/UI), which needs no model | S2 |
| 11 | **Entry channel** | UI / voice / MCP / Eigenmesh webhook | structural | `capture_session.author` + surface already carry it | **no model — metadata only** | — |
| 12 | **Ontology evolution** ("ontology") | every-10th profile refresh; propose new kind vs not | propose / skip (+ label note text stays chat) | ontology_eval chat | yes for the bounded part | S3 |
| 13 | **GTD project promotion** | hub is a multi-step initiative | promote / reject (+ confidence) | `judgeGtdProjectHub` chat (rich context prompt) | yes as second opinion — full linked-thought summaries go into `state` | S3 |
| 14 | **Community summary eligibility / topics** | L1 routing summary content | free-form text | batched chat | **no** (generative) — but *which community a query routes to* (retrieval side) is Jev-shaped (see §4) | — |

### Explicitly rejected for Jev

- **Embeddings** — not a decision (§1).
- **Rerank listwise ordering** — an ordering over 15 candidates, not a closed-set choice; keep LLM listwise. (A Jev *pairwise preference* question would be O(n²) — rejected on cost.)
- **Compose answer / interpret text / cues** — generative.
- **Second "memory type" axis** — prohibited by the single-axis decision (§1).

---

## 4. Chat decision inventory (intent + retrieval)

Today `/chat` is an agent tool loop with **no router or classifiers** ([agent-loop.ts](../../src/lib/server/llm/agent-loop.ts)); `answer_question` internally runs `classifyQueryIntent` (one qwen call: scope, temporal, kind, entityHints, durationUnit, comparativeOrdering, timeWindow).

| # | Decision | Closed set | LLM today | Jev? | Phase |
|---|---|---|---|---|---|
| C1 | **Message intent** (chat tab routing) | memory_question / capture_new / edit_stored / note_operation / project_operation / smalltalk | none — agent model infers | yes — shadow beside the loop; future fast-path router | S3 |
| C2 | **Retrieval scope** | global / local | `classifyQueryIntent` chat | yes | S3 |
| C3 | **Temporal reasoning kind** | 8 kinds + none (folds C2-temporal + comparativeOrdering into one question) | `classifyQueryIntent` chat | yes | S3 |
| C4 | **Duration unit** | days / weeks / months / none | `classifyQueryIntent` chat | yes | S3 |
| C5 | **Entity hints, time window** | free-form strings / ISO dates | `classifyQueryIntent` chat | **no** — stays chat (extraction shape) | — |
| C6 | **Community routing at query time** | which L1 community lane | implicit via ANN + bundles | yes — choice among top-k bundle candidates | S3 (later) |

One Jev call per chat turn carries C1–C4 (and later C6) as parallel questions in the same `state` (the user message + minimal recent-turn context). `entityHints` / `timeWindow` remain on qwen's structured output and are merged with Jev's bounded answers at compose time.

**Latency upside (post-promotion only):** `classifyQueryIntent` currently sits *serially* before retrieval; a Jev answer in ~0.5s vs ~1–3s qwen shaves that off the p95 ≤ 8s retrieval budget. Until promotion, shadow calls run **in parallel** with the existing path — zero added latency.

---

## 5. Architecture

### 5.1 One call, N questions

```ts
runDecisionModel(config, {
  state: normalizedText,           // or user message + recent turns for chat
  questions: {
    category:        { type: 'choice', instructions, criteria: categoryCatalog },
    contentRole:     { type: 'choice', instructions, criteria: { thought_only, split } },
    entityTypes:     { type: 'choice', /* per dominant mention */ … },
    temporalKind:    { type: 'choice', criteria: { none, ordering, … } },
    provenanceStyle: { type: 'choice', criteria: { human, agent, mixed } },
    salienceBand:    { type: 'choice', criteria: { high, medium, low } },
  },
})
```

- Question sets are **declared per surface** in one module (`decision-plane.ts`), built from the **same DB-loaded catalogs** the chat judges use (single source of truth per AC-3/AC-4 of [single-thought-type-axis](./single-thought-type-axis.md) — active kinds only, loaded once before classification).
- Kicked **concurrently** with the primary judge (existing `startCategoryShadow` pattern), settled after the primary decision lands.
- Failures are recorded as first-class error rows (`agree = null`, `decision_error`) — never thrown into capture (existing guarantee, kept for all kinds).

### 5.2 Schema: generalize `decision_shadow_log` (migration — SQL + journal in same change)

Current table is category-specific (`llm_category`, `decision_category`, …). Per repo policy (delete-and-replace, not accretion), **replace** with a kind-generic shape:

```sql
-- drizzle/0NNN_decision_shadow_log_generic.sql
ALTER TABLE "decision_shadow_log"
  ADD COLUMN "decision_kind" text NOT NULL DEFAULT 'category',
  RENAME COLUMN "llm_category" TO "llm_choice";
ALTER TABLE "decision_shadow_log" RENAME COLUMN "decision_category" TO "decision_choice";
-- + journal entry (idx NNN), brain.schema.ts update, RLS policy check, npm run db:migrate
```

- `surface` stays (`capture_service` / `enrich_queued` / `chat_intent` / `qa_intent` / …).
- Existing rows (2, non-live) migrate trivially under `decision_kind='category'`.
- **RLS:** confirm `decision_shadow_log` has its `user_id` policy in `enable_rls.sql`; add if missing (assessment S2 lesson — never rely on app filters alone).
- `/api/admin/decision-shadow` + the capture panel group by `decision_kind`, showing per-kind agreement/confusion pairs.

### 5.3 Cost transparency

Every Jev call logs `reportedCostUsd` to `activity_call_log` like any gateway call (pricing policy: base + 20% markup visible). At ~$0.000014/call this is noise in spend but not exempt from the policy. **Open question O3** on who bears shadow cost.

---

## 6. Phases, acceptance criteria, tests

### S0 — Category shadow (done, in production)

One decision kind, panel live, evidence accumulating.

### S1 — Extend ingest shadow: content role + entity type — **implemented (2026-10-06)**

Shipped: generic `decision_shadow_log` schema (migration 0073 + RLS policy — table previously had none, assessment S2 class), `decision-plane.ts` replacing `category-shadow.ts`, `decision-shadow-query.ts` read model, per-kind panel/admin view, enrich settle with `splitApplied.split.mode` + dominant mention type. Live-verified: one Decisions API call per enrich (~280ms) writing 3 comparable rows (category/content_role/entity_type).

**Scope:** add `contentRole` and `entityType` questions to the enrich shadow call; generic log schema lands here.

- **AC-S1-1** Given an enrich run, when the shadow executes, then one Decisions API call carries all enabled questions and one row per decision kind is written to `decision_shadow_log`.
- **AC-S1-2** Given the shadow is disabled by env, when ingest runs, then zero Jev calls fire and zero rows are written (deterministic disabled state, unchanged).
- **AC-S1-3** Given Jev returns an off-catalog choice (e.g. deactivated entity type), when the row is recorded, then the choice is stored verbatim with `agree = false` — no repair, no silent remap (metadata only; repair logic stays owned by the primary path per AC-1/AC-2 of the single-axis spec).
- **AC-S1-4** Given a Jev call fails/times out, when ingest continues, then the failure is an error row + `console.error` and capture/enrich outcome is byte-identical to a run without shadow.
- **AC-S1-5** Given any shadow row, when inspected, then it contains no thought text, no thought ids, no embeddings (privacy contract of [decision-plane.ts](../../src/lib/server/llm/decision-plane.ts) extends to all kinds).
- **AC-S1-6** Migration: given a fresh DB, when `npm run db:migrate` runs, then the generic schema + journal apply cleanly and RLS holds (`decision_shadow_log` cross-user select denied).

**Tests:** unit — question-set builder (catalogs from DB, active-only), row mapping per kind, disabled-state; migration integration; panel component test extended to grouped kinds. E2E (headed, operator): capture → panel shows ≥2 kinds after enrich.

### S2 — Full ingest plane: resolution choice, relation type, temporal kind, open-loop, salience band, provenance style

Same contract as S1 plus:

- **AC-S2-1** Given a thought with candidate relation pairs, when the shadow runs, then relation-type rows reference the pair deterministically (metadata-only surrogate, no ids leaked).
- **AC-S2-2** Given consolidation reads salience, when a salience-band shadow row exists, then it is **ignored by all consumers** until promotion (shadow rows are write-only diagnostics; a lint/test asserts no production reader).
- **AC-S2-3** Cost: given N ingests with the full plane, then Jev cost per capture stays ≤ 5% of the capture LLM budget (~$0.003–0.006, per [graph-scale-cost](./graph-scale-cost.md)) — verified by `measure:ingest`.

### S3 — Chat plane: message intent + QA intent shadow

- **AC-S3-1** Given a `/chat` turn, when the agent loop runs, then the intent shadow runs **out of band** (never blocks, never alters tool choice) and records `chat_intent` rows.
- **AC-S3-2** Given an `answer_question` call, when `classifyQueryIntent` runs, then scope/temporal-kind/duration-unit Jev answers are recorded beside qwen's, and **qwen's answers remain authoritative** (compose behavior unchanged).
- **AC-S3-3** Given offline Jev (OpenRouter down), when chat runs, then zero user-visible difference; error rows accumulate.
- **AC-S3-4** Privacy: given any chat shadow row, when inspected, then no message body is stored (surface + kind + choices + probabilities only).

**Tests:** unit — intent question builder, merge logic untouched-primary assertion; `/eval` UI stays the operator's end-to-end gate (no CLI eval runs, per policy).

### P — Promotion (per kind, explicitly gated, not in this spec's scope to execute)

Promotion criteria per decision kind (all must hold):

1. **Agreement ≥ 95%** over ≥ 100 comparable rows (window over recent rows, not lifetime).
2. **Calibration check:** among rows where Jev's top probability was p, Jev's choice was correct ≈ p (bin within ±0.1) — a calibrated 0.6 beats an overconfident 0.95.
3. **No open severity defects** on that kind's shadow path.
4. **Explicit operator approval** + requirement update (this file gains a promotion record per kind).
5. Rollout behind per-kind env (`DECISION_ENFORCE_KINDS=category,…`), fail-loud on missing config, **no silent cutover**, qwen stays as the shadow (roles reverse).

---

## 7. Risk assessment

| Risk | Mitigation |
|---|---|
| Shadow call slows ingest | Kicked concurrently; 10s timeout exists; timeout = error row, primary path untouched (AC-S1-4) |
| Second classifier collision (memoryType relapse) | Question sets derived from the **same** DB catalogs as primary judges; no second axis anywhere (§1 non-goal); S1 tests assert catalog single-source |
| Log bloat / privacy | Metadata-only rows, no text/ids/vectors (AC-S1-5, AC-S3-4); RLS enforced |
| Cost creep | One call per ingest/turn, bounded criteria; ≤5% budget assertion (AC-S2-3) |
| Silent behavior drift | Promotion requires P1–P5; shadow rows unread by production consumers (AC-S2-2) |
| Doc drift | Same-session updates to [repo-map/retrieval.md](../repo-map/retrieval.md), [repo-map/ingestion.md](../repo-map/ingestion.md), and this file at each phase |

---

## 8. Open questions for the operator

1. **O1 — Entity-type question granularity:** one choice per *dominant* mention (cheap, lossy) vs per-mention multi-answer (richer, needs Decisions API multi-answer shape). Recommend dominant-mention for S1, revisit.
2. **O2 — Salience band semantics:** is Jev's band a *prior* blended into the deterministic decay math (weight TBD at promotion) or purely a review signal? Recommend review-signal until P-gate.
3. **O3 — Shadow billing:** absorb Jev cost on the platform key (recommended — it's our eval infrastructure) or pass through with the 20% markup like every call?
4. **O4 — Schema:** replace `decision_shadow_log` in place (recommended; 2 disposable rows) or new table + drop old?
5. **O5 — Promotion ambition:** after the P-gate, which kind promotes first? Category is the natural candidate (most data, cheapest, clearest eval signal).
