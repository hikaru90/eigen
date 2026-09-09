# Emotional User Model & GiraffeBench (Spec)

> Settled 2026-09-08 in a design session across empathy-link (sunset), eigen, and eigenEnterprise.
> One ontology, authored once, promoted everywhere. eigen is the product; the benchmark is its quality gate; the standard is the byproduct. Bootstrapped — no raise.

## Thesis

eigen becomes the second brain that knows what you *need*, not just what you *know*. Proving that requires a measurement that does not exist today: LongMemEval tests factual recall; nobody tests whether a memory system correctly infers a user's emotional world. GiraffeBench is that measurement — first as eigen's internal eval gate, later published as an open standard once it flatters us.

Why this beats model training: training delivers the ability to *sound* empathetic. It cannot deliver accountability to a standard — a standard requires an ontology, a fixture schema, and a reproducible grader that exist outside the model. Weights cannot audit themselves.

## Track 1 — eigen: emotional layer on the grounding profile

**Problem.** `user_grounding_profile` (facets: identity, work, values, relationships, psychology, routines, projects + encrypted narrative summary) is a factual self-portrait. The `feeling` thought category and `triggered_by`/`recalls` relations exist, but there is no coherent representation of the user's emotional world to score, show, or improve.

**Decision.** Extend the grounding profile with an NVC (Rosenberg, OFNR) emotional layer:

- New facet group (same JSON-facet pattern as existing keys):
  - `feelings` — recurring and current emotional states (curated vocabulary, see ontology below)
  - `needs` — standing needs and their current satisfaction state
  - `patterns` — recurring emotional/relational dynamics (e.g. "withdraws when criticized")
  - `triggers` — situations/persons that reliably precede strong reactions
- Extraction is LLM-based only ("LLM as judge, no string heuristics" rule holds), drawing on feeling-category thoughts, relations, reflections, and check-in answers. Runs during enrichment and at check-in refresh points; versioned, never silently overwritten.
- User-visible and editable: the profile is the user's model of themselves, not a hidden score. Consent/visibility UX is inherited conceptually from empathy-link's memory screen (view, edit, delete per facet entry).
- Encrypted at rest like the narrative summary. Embeddings-boundary rule unaffected.

This layer is Suite B's scored target: the benchmark grades eigen's ability to reconstruct it.

## Track 2 — GiraffeBench (eigen's eval, graduated later)

**Suite B first — user-model accuracy (novel category).**

Loop: persona ground truth → synthesized thought corpus → eigen ingest → extracted emotional layer → graded profile-vs-persona.

1. **Persona generator.** Synthetic users with full inner lives generated from the memory-model taxonomy (relationship web, values, identity, emotional patterns, triggers — with confidence levels), carried over from empathy-link's Memory model.
2. **Corpus synthesizer.** From each persona, generate a realistic captured-thought stream (hundreds of thoughts, realistic noise: tasks, ideas, small talk mixed with emotionally loaded material).
3. **Scorer.** Facet-level precision/recall of feelings/needs/patterns/triggers against ground truth, plus retrieval-based checks ("does eigen recall the trigger when asked about the conflict?") — NDCG-style, following the existing evals/ harness pattern.
4. **CI gate.** Suite B runs on the eval corpus; emotional-layer quality must not regress release over release.

**Suite A second — OFNR conversational compliance.** Adversarial multi-turn scenarios (300–500, 8–10 conflict domains, 6–10 turns, difficulty tiers up to contempt/stonewalling); agents' responses scored for OFNR structural compliance with penalties for judgment, invalidation, advice-giving; LLM judge + programmatic ontology checks; versioned and seeded for reproducibility. Reuses the same ontology, personas, and grader infrastructure.

**Publishing posture.**

- Now: publish the clean-room bilingual ontology as an installable package (npm) + the persona-fixture schema. This is the standard-seed under the GiraffeBench name. Costs little, keeps the standard alive.
- Later: publish Suite B itself, when results flatter eigen. "We measure what competitors don't" only works if we win the measurement first.

**Checkpoint (anti-zombie).** Success = eigen's emotional layer ships AND Suite B scores measurably improve release over release. No external adoption requirement. If the emotional layer ships but scores never improve, reshape; if it never ships, kill this spec — declared now, no sunk-cost drift.

## Track 3 — eigenEnterprise: NVC module (deferred)

Queued behind Suite B. The ontology and emotional schema are then promoted into a module via the existing contract (manifest + zod-schematized tools + activation row), mirroring the repo's eigen→enterprise promotion pattern.

Candidate JTBD: the owlery email module gains OFNR drafting/checking tools for difficult company communication (feedback, conflict, customer escalation) — permission-gated, approval-gated, audit-logged, no coaching-app voice (per grounding-question-policy G-rule).

## empathy-link sunset

1. Export DB snapshots (users, analyses, memories, chats).
2. Extract IP into this workstream: prompt specifications (messages/en.json, de.json), memory-model taxonomy (types, confidence levels, decay semantics), safety/crisis layer learnings.
3. Quarantine the feelings/needs lists — presumed PuddleDancer-derived; nothing verbatim enters the ontology.
4. Farewell notice + data-export option to users; then stop paid infrastructure.

## Legal hygiene

- Ontology is clean-room: informed by public-domain sources (Plutchik emotion wheel, Max-Neef needs) and NVC concepts as ideas — never verbatim lists from copyrighted materials.
- Referential framing only ("scores compliance with Rosenberg's OFNR framework"); explicit non-affiliation disclaimer.
- Never use "NVC-certified" or any certification language — CNVC holds a certification program and pending marks on educational services.

## Decision log (abridged)

| Decision | Settled |
|---|---|
| Bet | Emotional state (runtime context) + eval/verification; state IS eigen, eval is Suite B |
| Benchmark shape | Two suites, user-model accuracy (B) first, OFNR compliance (A) second |
| Labels | Pure synthetic, disclosed in methodology; no expert certification for v1 |
| Personas | Generated from empathy-link's memory-model taxonomy — the one reused IP |
| Release posture | Internal suites now; ontology package + persona schema published now; suites published only when flattering |
| Revenue | None — bootstrap eigen; the raise path was explicitly abandoned |
| App | empathy-link: snapshot + graceful sunset |
| Enterprise module | Deferred until Suite B works; email/OFNR assist is the lead JTBD |
| Sequencing | eigen-centric; GiraffeBench is eigen eval work, not a fifth product |
