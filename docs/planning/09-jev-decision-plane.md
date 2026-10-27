# Jev decision plane — every bounded decision in ingest and chat (spec, pre-implementation)

**Status:** Operator directive (2026-10-16): Jev is the authoritative engine for every bounded decision ("Jev everywhere"); the chat judge is the shadow/comparison. Ingest kinds are promoted (record below); chat-plane kinds (S3) are the remaining batch.
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
- `/api/admin/decision-shadow` groups by `decision_kind`, showing per-kind agreement/confusion pairs (operator diagnostics; the capture-page panel was removed 2026-10-16).

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

### Promotion record (2026-10-15) — `category` and `content_role` PROMOTED

**Operator decision:** the operator explicitly approved promotion ahead of the P1/P2 evidence gate ("make Jev the default"), waiving the ≥100-row and calibration requirements (P4 satisfied; P1/P2 consciously waived at n=12). P3 holds (no open defects). P5 implemented as specified.

**Evidence at approval (12 captures, `measure:jev` benchmark):** category 12/12 agreement, content_role 12/12, entity_type 8/12; Jev latency ~380–400 ms per call vs ~1.9 s avg per chat-judge call; cost ~1.9% of the chat-judge spend per capture.

**Implemented contract:**

- `DECISION_ENFORCE_KINDS=category,content_role` (absent/blank = shadow only; unknown kinds fail loud; `entity_type` is **rejected** until O1 is resolved).
- **category:** Jev's answer overrides the enrich bundle's category at persist (`categorySource='decision_model'`, confidence = Jev probability, alternatives = remaining probability map). Off-catalog keys throw → ingest retry ladder (exactly 3) → explicit queue failure. No fallback.
- **content_role:** an early standalone Jev call (pre-split, no catalogs needed) decides the mode. `thought_only` ⇒ the split chat call is skipped entirely (~3 s/capture saved). `split` ⇒ the chat call runs **generation only** (`decidedMode` contract in `resolveCaptureContentSplit`) — Jev owns the mode, qwen owns the note text. There is no independent chat mode answer anymore, so enforced content_role rows carry `llm_choice = null` (not comparable, not errored).
- **entity_type:** stays shadow on both sides (67% agreement + dominant-mention-only coverage; the graph sync needs every mention typed — O1 must be revisited first).
- **Failure semantics:** enforced kinds are a hard dependency — an OpenRouter outage degrades ingest exactly like an LLM-gateway outage. Non-enforced kinds keep the never-throw shadow guarantee (AC-S1-4).
- **Observability:** `decision_shadow_log.authoritative_engine` (`chat_judge` | `decision_model`) records which engine owns each row's kind; shadow diagnostics are operator-only via `/api/admin/decision-shadow` (the capture-page panel was removed 2026-10-16).
- **Rollback:** remove kinds from `DECISION_ENFORCE_KINDS` (or clear it) — qwen becomes authoritative again with zero code change.

---

### Promotion record (2026-10-16) — FULL INGEST PROMOTION: `entity_type` (per-mention), `relation_type`, `temporal_kind`

**Operator decision:** explicit blanket directive, quoting intent: "Use Jev everywhere … Jev is the main driver and the other system should be the shadow … Jev is the main driver of this application." This waives the P1/P2 evidence gates for the ingest kinds below (same waiver shape as the 2026-10-15 record, now covering the full ingest plane). P4 satisfied (this record). P5 implemented as specified.

**Evidence at approval:** shadow log, 21 enriches — category 22/22 agreement; entity_type 13/21 agreement with the chat judge at ≥0.9 confidence on every row it ever recorded (43 rows, minimum 0.9 — no calibration signal), including person@0.98 / place@0.95 mis-typings of account-creation mentions; relation_type and temporal_kind promoted with **no shadow evidence** under the explicit waiver. Jev calibration properties per vendor docs (Brier-trained, band-level thresholds, confidence = distribution concentration) motivated the swap on quality grounds independent of agreement counts.

**Implemented contract:**

- `DECISION_ENFORCE_KINDS=category,content_role,entity_type,relation_type,temporal_kind` (rollback: shrink or clear the var).
- **entity_type (O1 resolved):** one Decisions call per enrich, one `choice` question per extracted mention (key `entity_type:m1…mN`, surface quoted in the question instructions, full capture text as `state`, criteria = active entity-type catalog). Jev's answer overrides each mention's type + confidence before graph sync; the bundle's typing is recorded per-mention as the comparison. Mention *surface extraction* stays on the chat judge (generation shape); only the type decision moved. Generic dominant-mention shadow question is suppressed while enforced.
- **relation_type:** relation candidate *generation* stays deterministic (hybrid retrieval + temporal neighbors). The per-pair 8-way typing moves to Jev with a ninth `none` criterion (omit weak pairs). Under enforcement the chat relation call is skipped entirely (content_role precedent: `llm_choice = null` rows). Under shadow (enforcement off) the chat call stays authoritative.
- **temporal_kind:** the `kind` enum per temporal mention is re-decided by Jev after extraction; surfaces, ISO dates, timePrecision, and anchoring math stay extraction/code-owned (vendor guidance: Jev does no date math).
- **Per-item rows:** `decision_shadow_log.subject_ref` (migration 0075) carries the deterministic per-item surrogate (`m1…mN` mentions, `p1…pN` pairs, `t1…tN` temporal mentions) — never text, surfaces, or ids. `authoritative_engine='decision_model'`; `agree` compares against the chat answer when one exists.
- **Edit-path enforcement fix (P5 violation closed):** `/api/capture/edit` re-classification now applies the enforced category answer (`categorySource='decision_model'`); previously it silently kept the chat judge's answer while the shadow row claimed decision-model authority.
- **Failure semantics:** unchanged enforced contract — per-item call errors and off-catalog choices write their evidence rows and throw into the ingest retry ladder (exactly 3); no fallback.
- **Stays on the chat judge (generation/shape, per §2):** interpreted text, cues, entity surfaces, relation candidate generation, temporal surfaces + ISO dates + anchoring, summaries, answers, ontology guidance text. **Rejected for Jev (unchanged):** listwise rerank/orderings, embeddings, date math. **Chat plane (S3, C1–C4 + message intent):** next batch, shadow-first per AC-S3-*.

---

### Promotion record (2026-10-16, batch 2) — CHAT/QA PLANE + GTD: `retrieval_scope`, `query_temporal_kind`, `duration_unit`, `gtd_promotion`

**Operator decision:** continuation of the 2026-10-16 blanket directive ("Jev all the way"), plus two operator additions: the shadow panel is removed from the app UI ("make sure to not show the shadow in the app") and the GTD escalation design was accepted.

**Implemented contract:**

- `DECISION_ENFORCE_KINDS` extended with `retrieval_scope,query_temporal_kind,duration_unit,gtd_promotion` (rollback: shrink the var).
- **Retrieval intent (C2/C3/C4):** `classifyQueryIntent` still runs qwen once (it also produces the extraction-shaped fields — entity hints, time window, temporal flag, comparativeOrdering); when any of the three kinds is enforced, ONE Jev call (surface `qa_intent`) overrides `scope`, temporal reasoning `kind`, and `durationUnit` (`none` → null). A Jev failure rejects the query — enforced semantics, no fallback to qwen's answers.
- **Preview/store consistency (S3 defect):** `interpretThoughtPreview` asks Jev (surface `interpret_preview`) under category enforcement and shows ITS category + calibrated confidence/alternatives in the confirm modal, so the preview the user confirms is the decision that persists. Interpret text/entities/deviation flag stay qwen; strict-retry path remains for the non-enforced mode.
- **GTD promotion:** Jev is the promotion judge (surface `gtd_judge`); `state` = JSON with hub label, entity type, linked-thought summaries, open-task summaries, counts — the guardrail-required judge input. Escalation band: `0.4 ≤ p(true) ≤ 0.6` routes the hub to the existing qwen judge, whose verdict + canonical label win (designed two-engine tiebreak, not a fallback; rows record Jev's answer with `llmChoice=null`). Outside the band Jev decides and `canonicalLabel` = the hub's existing label. Negative regression coverage per guardrail: ingredient, relative, single one-off task, co-mentioned concept fixtures assert non-promotion through the Jev path.
- **Shadow UI removed from the app:** the capture-page decision-shadow panel (incl. the "Jev decides" chip) is deleted; `decision_shadow_log` recording and the operator-only `/api/admin/decision-shadow` endpoint remain.
- **Test hermeticity rule (new):** operator `.env` enforcement must never leak network calls into unit tests — specs exercising decision-consulting code paths mock `resolveDecisionEnforceKinds` (module-mock idiom), never rely on env stubs.
- **Remaining queue (not scheduled):** entity-resolution choice (merge/create among candidates — covers label-variant dedup like Jev/jev), delete-target selection (destructive-action gate design first), message intent C1 (new behavior, shadow-first), open-loop refinement and salience score (need a consumer/storage decision, O2).

---

### Promotion record (2026-10-16, batch 3 — worktree round) — `resolution_choice`, `delete_target`, `message_intent`, `open_loop`, `salience_band`

**Operator decision:** "all, with subagents and worktrees" — the full remaining queue, executed as one wave-0 registry commit plus four parallel git-worktree agents, merged to main. Registry now at 14 enforceable kinds; `DECISION_ENFORCE_KINDS` lists all of them.

**Implemented contract:**

- **resolution_choice:** project-hub resolution asks Jev (surface `resolution`): a `canonical` choice keyed by candidate-hub UUIDs plus `create`, and per-candidate `merge`/`keep` specs; `create` → new hub (isGtdProject=false — promotion belongs to the gtd_promotion judge; canonicalLabel = input label; hubEntityType='project'). Escalation: winning probability < 0.6 runs the existing qwen resolver and its full result wins. Enforcement off: qwen path unchanged.
- **delete_target:** per-candidate `delete`/`keep` questions (surface `delete_gate`); deterministic gate in code — any selected candidate below 0.8 probability throws `[delete-gate] ambiguous delete request` and nothing deletes. NOTE: `resolveDeleteTargets` has no production caller yet — enforcement is wired and safe, awaiting a delete flow (MCP tool or UI) to reach it.
- **message_intent:** each chat turn's message is classified (surface `chat_turn`; memory_question | capture_new | edit_stored | note_operation | project_operation | smalltalk) and injected as a one-line advisory hint into the agent-loop system prompt. Deliberate soft-fail (logged, loop proceeds): this is a NEW advisory signal with no incumbent decision to replace — chat availability outranks intent quality. The only surface where enforcement does not fail loud.
- **open_loop + salience_band:** one Jev call per enrich (open_loop: actionable | mentioned | closed; salience_band: high | medium | low), stored in thought metadata (`openLoop`, `saliencePrior`). Consumer: GTD assignment eligibility gates on `openLoop` — `mentioned`/`closed` thoughts are never auto-assigned to projects; `actionable` and all legacy (absent) thoughts behave as before. salience_prior is a stored review signal (O2 decision); compute-salience math unchanged.
- **Process:** wave-0 widened the registry (14 kinds) + surfaces (`resolution`, `delete_gate`, `chat_turn`) on main; four agents worked in isolated worktrees (`jev/resolution-choice`, `jev/delete-gate`, `jev/message-intent`, `jev/enrich-extended`), committed on their branches, merged cleanly; worktrees and merged branches removed after gates. Full suite 3292 tests green, lint 0 errors, svelte-check 0 errors.
- **Every bounded decision in the spec inventory now has Jev as its authoritative engine.** The chat judge remains for generation/shape only (interpreted text, cues, surfaces, dates, summaries, answers, listwise rerank) and as tiebreaker/escalation judge (GTD band, resolution sub-0.6).

---

### Closing record (2026-10-16, batch 4) — delete flow consumer + O2 resolution

**Operator decision:** "go on then" — the two named closers, same worktree process (two parallel agents, merged).

- **`delete_thoughts_by_request` (MCP):** the delete plane gained its consumer. The tool validates the request at the boundary (non-empty, ≤500 chars), runs the full retrieval chain (multi-query retrieval → candidate build → ≥0.45 pre-filter → Jev per-candidate selection behind the 0.8 confidence gate), and applies the SAME soft-remove (`archiveThoughtForUser`) as `delete_thought` per selected id — no second deletion path. Ambiguous requests propagate the gate error to the caller; nothing deletes below confidence. Chat copy added for the agent-loop tool UI.
- **O2 RESOLVED — salience prior is a one-time seed, not a recurring blend:** `salience_band` seeds the thought's INITIAL `salienceScore` once at enrich (`INITIAL_SALIENCE_BY_PRIOR`: high 1.5, low 0.6; medium/absent keep the 1.0 column default). Rationale: `runSalienceCompute` is set-based SQL whose idempotency contract (same wall-clock → same scores) forbids per-run multipliers; a one-time seed composes with deterministic decay. `compute-salience` is byte-untouched.
- **Full gates:** 492 files / 3303 tests green, lint 0 errors, svelte-check 0 errors.

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
