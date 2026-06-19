# Q&A grounding hardening plan

**Status:** Implemented (2026-06).

**Origin:** A real session where "what am I about?" produced a vague, partly-wrong, uncited answer in ~75s (wrongly claimed "home office" as primary work location; leaked an internal "clusters 3 and 4" artifact; astrology-tone synthesis). Full root-cause diagnosis below.

## Goal

Harden the **whole answer pipeline** so that *every* question — broad, pointed, temporal, self-referential — is answered with the best grounding, retrieval, and honesty the system can technically produce. This is not a fix for one question style. The "what am I about?" failure is the most visible symptom of failure classes that degrade all question types.

## Non-negotiable constraints (from project guardrails)

- **No string heuristics** for semantic decisions ([`.cursor/rules/no-string-heuristics.mdc`](../../.cursor/rules/no-string-heuristics.mdc)). Routing/relevance stays LLM- or embedding-judged.
- **No fallbacks / no silent degradation** ([`AGENTS.md` Failure Policy](../../AGENTS.md)). An honest "insufficient grounded evidence" is a *correct* answer, not a fallback.
- **Embeddings DB-only** ([`embeddings-db-only-boundary.md`](./embeddings-db-only-boundary.md)). No vectors in prompts, tool results, logs.
- **Fix root cause, not workaround** ([`.cursor/rules/fix-root-cause-not-workaround.mdc`](../../.cursor/rules/fix-root-cause-not-workaround.mdc)). Add a unit test per invariant fixed.
- **Generalize** — no thought-id / exact-text special cases.

---

## Root-cause diagnosis (what failed, by severity)

The request forked at `composeAnswer` on `scope === 'global'` and was handed entirely to `searchGlobal` map-reduce, bypassing grounded retrieval, the grounding profile, and citation discipline.

```588:608:src/lib/server/qa/compose-answer.ts
	if (scope === 'global') {
		if (await hasCommunitySummaries(input.userId)) {
			...
			const global = await searchGlobal({ userId: input.userId, query: trimmedQuestion });
			...
			return globalSearchResultToComposed(global);
		}
```

1. **Grounding profile never consulted at answer time.** `user_grounding_profile` (the authoritative self-knowledge, incl. work location) is injected only on the *ingest* side (`classify-thought-category.ts`, `extract-thought-metadata.ts`, `entity-extraction.ts`). It is absent from `compose-answer.ts` and `global.ts`. Root cause of the "home office" error and applies to **all** question types.
2. **`searchGlobal` answers from cluster summaries, not thoughts, with no relevance floor.** [`global.ts`](../../src/lib/server/retrieval/global.ts) takes the nearest ~5 `community_summary` rows with no distance threshold — noise clusters always qualify.
3. **Map step manufactures answers from irrelevant clusters.** Admission gate is only `score > 0 && answer !== "Not relevant"`; a score-35 "barely helps" cluster became evidence.
4. **Reduce step launders low-confidence guesses into confident prose.** Prompt says "be specific / highlight patterns / note tension" with no honesty or confidence-floor instruction.
5. **Global answers are uncitable by construction.** `globalSearchResultToComposed` hard-codes `citations: []`, `retrieved: []`. The "clusters 3 and 4" leak is internal reduce indices surfacing because there is no citation contract.
6. **Performance: ~75s.** Map loops sequentially (5 serial LLM calls) + a 39.5s reduce — slower *and* worse than grounded compose.

Failures #1 and the missing honest-insufficient-evidence path are **pipeline-wide**, not global-only.

---

## Plan of work (phased)

### Phase 1 — Grounding profile in the answer pipeline (highest impact)

- Add `loadGroundingProfileForEnrichment(userId)` load into `composeAnswer`, both branches.
- Inject `groundingProfilePromptBlock(profile)` into the compose system/user prompt as **highest-priority self-knowledge**, clearly labeled as profile context (distinct from cited thoughts).
- Citation rule: facts drawn from the grounding profile cite a dedicated `[id=profile]` token (analogous to `COMPUTED_TIMELINE_CITATION_ID`), so profile-derived claims are attributable and never masquerade as thought citations.
- Tests: `compose-answer.spec.ts` — profile facts (e.g. work location) override stray thought inferences; profile block present in prompt; `[id=profile]` allowed in citation validation.

### Phase 2 — Make `searchGlobal` grounded and honest (or retire it)

Decision point for the user (see Open questions). Two viable directions:

- **2A (retire global map-reduce):** Route all `answer_question` through `retrieveEvidence` + strict compose. Community summaries become *routing signal* into thought retrieval (they already are, via L1 community ANN in `retrieveEvidence`), not the answer source. Simplest path to citations + honesty for every question.
- **2B (harden global map-reduce):** Keep `searchGlobal` for true theme questions but (a) add a cosine **relevance floor** on community candidates, (b) raise the map admission to a **helpfulness threshold**, (c) after map-reduce, **expand `community_bundle.top_thought_ids`** for the surviving communities and pass real thought text to a strict, citing compose step, (d) return real `citations` / `retrieved`.

Recommended: **2A** for correctness and simplicity; revisit a theme-summary *enhancement* later if needed.

### Phase 3 — Honest insufficient-evidence path (pipeline-wide)

- Define an explicit, evidence-gated outcome: when no retrieved thought (or profile fact) clears a relevance bar, the answer is a clear "Your memory doesn't contain enough to answer this" with what *was* found and what's missing — not a synthesized guess. This already exists for the local path ("Not in memory."); extend the contract so it cannot be bypassed by any branch. Conforms to no-fallbacks (honest failure, not silent degradation).
- Tests: empty/low-relevance retrieval yields the honest answer with no invented claims.

### Phase 4 — Community-summary quality (ingest/consolidation side)

- Audit the generator in [`community-summaries.ts`](../../src/lib/server/consolidation/community-summaries.ts) that produced "home office is your primary work location." Summaries should describe what *unifies a cluster*, not assert biographical facts. Constrain the summary prompt so it cannot promote a place node into a life-fact. (LLM-judged; no string rules.)
- Tests: summary generation unit tests assert thematic (not assertive-biographical) output shape.

### Phase 5 — Latency

- If 2B is chosen, parallelize the map step (bounded concurrency via existing [`orchestration-concurrency.ts`](../../src/lib/server/orchestration-concurrency.ts)). If 2A, the serial map cost disappears entirely.

### Phase 6 — Docs + acceptance criteria

- Update [`docs/repo-map/retrieval.md`](../repo-map/retrieval.md) (global vs local routing), [`02-acceptance-criteria.md`](./02-acceptance-criteria.md) (AC-025/AC-026 rewrite to require grounding profile + honesty), and [`ingest-retrieval-timing.md`](./ingest-retrieval-timing.md) (Q&A flow).

---

## Acceptance criteria (Given/When/Then)

- **AC-G1 Grounding in answers:** Given a user with a `work` facet "codes at SPACE Hamburg", when they ask any question about where they work, then the answer uses the profile fact (cited `[id=profile]`) and does not infer a different work location from incidental thoughts.
- **AC-G2 No ungrounded synthesis:** Given retrieval returns no thought above the relevance floor and no relevant profile fact, when composing, then the answer explicitly states insufficient memory — never a confident pattern-claim.
- **AC-G3 Citations always:** Given any answered question, when the answer asserts a fact, then it cites a real `[id=<uuid>]` or `[id=profile]`/`[id=computed]`; internal indices never leak.
- **AC-G4 Generalization:** Criteria hold for arbitrary user corpora, verified by unit tests, not the one session's data.

## Verification

- Unit tests only (per [`no-run-evals.mdc`](../../.cursor/rules/no-run-evals.mdc)): `compose-answer.spec.ts`, `global.spec.ts`, `community-summaries` tests.
- Operator validates end-to-end via the **`/eval` UI** (Questions & answers → Run), not `npm run eval`.

## Open questions for the user

1. **Phase 2 direction:** retire global map-reduce (2A, recommended) or harden it with bundle expansion + citations (2B)?
2. **Profile authority:** should an explicit, recent grounding fact *override* a conflicting stored thought, or should both be surfaced as a noted tension?
